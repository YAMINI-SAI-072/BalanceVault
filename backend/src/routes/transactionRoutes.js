
import express from "express";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { prisma } from "../db.js";
import {
  authenticate,
  requireRole
} from "../middleware/authMiddleware.js";

const router = express.Router();

// Validate transfer request
const transferSchema = z.object({
  fromAccountId: z.string().uuid(),
  toAccountNo: z.string().min(1),
  amount: z.number().int().positive().safe(),
  description: z.string().max(200).optional()
});

// POST /api/transactions/transfer
router.post(
  "/transfer",
  authenticate,
  requireRole("ACCOUNT_HOLDER"),
  async (req, res) => {
    const validation = transferSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({
        message: "Invalid transfer details",
        errors: validation.error.issues
      });
    }

    const {
      fromAccountId,
      toAccountNo,
      amount,
      description
    } = validation.data;

    const amountInPaise = BigInt(amount);

    // Require an idempotency key
    const idempotencyKey = req.headers["idempotency-key"];

    if (
      typeof idempotencyKey !== "string" ||
      idempotencyKey.length < 8 ||
      idempotencyKey.length > 128
    ) {
      return res.status(400).json({
        message: "A valid Idempotency-Key header is required"
      });
    }

    // Identify the exact request
    const requestHash = createHash("sha256")
      .update(
        JSON.stringify({
          fromAccountId,
          toAccountNo,
          amount,
          description: description ?? "Account transfer"
        })
      )
      .digest("hex");

    try {
      const result = await prisma.$transaction(
        async (tx) => {
          // Check whether this request was already processed
          const existingRequest =
            await tx.idempotencyKey.findUnique({
              where: {
                key: idempotencyKey
              }
            });

          if (existingRequest) {
            if (
              existingRequest.userId !== req.user.id ||
              existingRequest.requestHash !== requestHash
            ) {
              throw new Error("IDEMPOTENCY_KEY_REUSED");
            }

            if (existingRequest.response !== null) {
              return {
                replayed: true,
                response: existingRequest.response
              };
            }

            throw new Error("IDEMPOTENCY_REQUEST_INCOMPLETE");
          }

          // Find sender account owned by logged-in user
          const sender = await tx.account.findFirst({
            where: {
              id: fromAccountId,
              userId: req.user.id
            }
          });

          if (!sender) {
            throw new Error("SENDER_ACCOUNT_NOT_FOUND");
          }

          // Find receiver account
          const receiver = await tx.account.findUnique({
            where: {
              accountNo: toAccountNo
            }
          });

          if (!receiver) {
            throw new Error("RECEIVER_ACCOUNT_NOT_FOUND");
          }

          if (sender.id === receiver.id) {
            throw new Error("SAME_ACCOUNT");
          }

          if (
            sender.status !== "ACTIVE" ||
            receiver.status !== "ACTIVE"
          ) {
            throw new Error("ACCOUNT_NOT_ACTIVE");
          }

          // Debit sender only if sufficient balance exists
          const debit = await tx.account.updateMany({
            where: {
              id: sender.id,
              userId: req.user.id,
              status: "ACTIVE",
              balance: {
                gte: amountInPaise
              }
            },
            data: {
              balance: {
                decrement: amountInPaise
              }
            }
          });

          if (debit.count !== 1) {
            throw new Error("INSUFFICIENT_BALANCE");
          }

          // Credit receiver
          const credit = await tx.account.updateMany({
            where: {
              id: receiver.id,
              status: "ACTIVE"
            },
            data: {
              balance: {
                increment: amountInPaise
              }
            }
          });

          if (credit.count !== 1) {
            throw new Error("RECEIVER_NOT_AVAILABLE");
          }

          // Create transaction record
          const transaction = await tx.transaction.create({
            data: {
              type: "TRANSFER",
              status: "COMPLETED",
              amount: amountInPaise,
              reference: randomUUID(),
              description: description ?? "Account transfer"
            }
          });

          // Record both sides of the ledger
          await tx.ledgerEntry.createMany({
            data: [
              {
                transactionId: transaction.id,
                accountId: sender.id,
                entryType: "DEBIT",
                amount: amountInPaise
              },
              {
                transactionId: transaction.id,
                accountId: receiver.id,
                entryType: "CREDIT",
                amount: amountInPaise
              }
            ]
          });

          // Record audit event
          await tx.auditLog.create({
            data: {
              userId: req.user.id,
              action: "TRANSFER_COMPLETED",
              details: {
                transactionId: transaction.id,
                senderAccountId: sender.id,
                receiverAccountId: receiver.id,
                amount: amountInPaise.toString()
              }
            }
          });

          // Save the successful response with the transfer
          const responseBody = {
            message: "Transfer completed successfully",
            transaction: {
              id: transaction.id,
              reference: transaction.reference,
              amount: transaction.amount.toString(),
              status: transaction.status
            }
          };

          await tx.idempotencyKey.create({
            data: {
              key: idempotencyKey,
              userId: req.user.id,
              requestHash,
              response: responseBody
            }
          });

          return {
            replayed: false,
            response: responseBody
          };
        },
        {
          isolationLevel:
            Prisma.TransactionIsolationLevel.Serializable
        }
      );

      return res
        .status(result.replayed ? 200 : 201)
        .json(result.response);

    } catch (error) {
      // Idempotency errors
      if (error.message === "IDEMPOTENCY_KEY_REUSED") {
        return res.status(409).json({
          message:
            "This idempotency key was already used for a different request"
        });
      }

      if (error.message === "IDEMPOTENCY_REQUEST_INCOMPLETE") {
        return res.status(409).json({
          message:
            "Previous request is incomplete. Please use a new key."
        });
      }

      // Business validation errors
      const messages = {
        SENDER_ACCOUNT_NOT_FOUND: [
          404,
          "Sender account not found"
        ],
        RECEIVER_ACCOUNT_NOT_FOUND: [
          404,
          "Receiver account not found"
        ],
        SAME_ACCOUNT: [
          400,
          "Cannot transfer to the same account"
        ],
        ACCOUNT_NOT_ACTIVE: [
          409,
          "Both accounts must be active"
        ],
        INSUFFICIENT_BALANCE: [
          400,
          "Insufficient balance"
        ],
        RECEIVER_NOT_AVAILABLE: [
          409,
          "Receiver account is unavailable"
        ]
      };

      if (messages[error.message]) {
        const [status, message] = messages[error.message];

        return res.status(status).json({
          message
        });
      }

      // Duplicate idempotency key or unique constraint conflict
      if (error.code === "P2002") {
        return res.status(409).json({
          message:
            "Request may already have been processed. Retry using the same idempotency key."
        });
      }

      // Concurrent transaction conflict
      if (error.code === "P2034") {
        return res.status(409).json({
          message:
            "Transfer conflict. Retry using the same idempotency key."
        });
      }

      console.error("Transfer error:", error);

      return res.status(500).json({
        message: "Could not complete transfer"
      });
    }
  }
);

// GET /api/transactions/my
router.get(
  "/my",
  authenticate,
  requireRole("ACCOUNT_HOLDER"),
  async (req, res) => {
    try {
      const entries = await prisma.ledgerEntry.findMany({
        where: {
          account: {
            userId: req.user.id
          }
        },
        include: {
          transaction: true,
          account: {
            select: {
              accountNo: true
            }
          }
        },
        orderBy: {
          createdAt: "desc"
        }
      });

      return res.status(200).json({
        message: "Transaction history retrieved successfully",
        count: entries.length,
        transactions: entries.map((entry) => ({
          entryId: entry.id,
          transactionId: entry.transactionId,
          reference: entry.transaction.reference,
          type: entry.transaction.type,
          status: entry.transaction.status,
          entryType: entry.entryType,
          amount: entry.amount.toString(),
          accountNo: entry.account.accountNo,
          description: entry.transaction.description,
          createdAt: entry.createdAt
        }))
      });

    } catch (error) {
      console.error("Transaction history error:", error);

      return res.status(500).json({
        message: "Could not retrieve transaction history"
      });
    }
  }
);

export default router;

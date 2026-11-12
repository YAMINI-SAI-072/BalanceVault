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

// GET /api/admin/audit-logs
router.get(
  "/audit-logs",
  authenticate,
  requireRole("ADMIN", "AUDITOR"),
  async (req, res) => {
    try {
      const logs = await prisma.auditLog.findMany({
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true
            }
          }
        },
        orderBy: {
          createdAt: "desc"
        },
        take: 100
      });

      return res.status(200).json({
        message: "Audit logs retrieved successfully",
        count: logs.length,
        logs
      });
    } catch (error) {
      console.error("Audit log error:", error);

      return res.status(500).json({
        message: "Could not retrieve audit logs"
      });
    }
  }
);

// GET /api/admin/users
router.get(
  "/users",
  authenticate,
  requireRole("ADMIN"),
  async (req, res) => {
    try {
      const users = await prisma.user.findMany({
        select: {
          id: true,
          name: true,
          email: true,
          role: true,
          createdAt: true
        },
        orderBy: {
          createdAt: "desc"
        }
      });

      return res.status(200).json({
        message: "Users retrieved successfully",
        count: users.length,
        users
      });
    } catch (error) {
      console.error("Admin users error:", error);

      return res.status(500).json({
        message: "Could not retrieve users"
      });
    }
  }
);

// PATCH /api/admin/accounts/:accountId/status
router.patch(
  "/accounts/:accountId/status",
  authenticate,
  requireRole("ADMIN"),
  async (req, res) => {
    const { accountId } = req.params;
    const { status } = req.body;

    if (!["ACTIVE", "FROZEN"].includes(status)) {
      return res.status(400).json({
        message: "Status must be ACTIVE or FROZEN"
      });
    }

    try {
      const result = await prisma.$transaction(async (tx) => {
        const account = await tx.account.findUnique({
          where: { id: accountId }
        });

        if (!account) {
          throw new Error("ACCOUNT_NOT_FOUND");
        }

        const updatedAccount = await tx.account.update({
          where: { id: accountId },
          data: { status }
        });

        await tx.auditLog.create({
          data: {
            userId: req.user.id,
            action: status === "FROZEN"
              ? "ACCOUNT_FROZEN"
              : "ACCOUNT_UNFROZEN",
            details: {
              accountId,
              previousStatus: account.status,
              newStatus: status
            }
          }
        });

        return updatedAccount;
      });

      return res.status(200).json({
        message: `Account status updated to ${status}`,
        account: {
          id: result.id,
          accountNo: result.accountNo,
          status: result.status
        }
      });
    } catch (error) {
      if (error.message === "ACCOUNT_NOT_FOUND") {
        return res.status(404).json({
          message: "Account not found"
        });
      }

      console.error("Account status update error:", error);
      return res.status(500).json({
        message: "Could not update account status"
      });
    }
  }
);

// GET /api/admin/accounts
router.get(
  "/accounts",
  authenticate,
  requireRole("ADMIN"),
  async (req, res) => {
    try {
      const accounts = await prisma.account.findMany({
        include: {
          user: {
            select: {
              id: true,
              name: true,
              email: true,
              role: true
            }
          }
        },
        orderBy: {
          createdAt: "desc"
        }
      });

      return res.status(200).json({
        message: "All accounts retrieved successfully",
        count: accounts.length,
        accounts: accounts.map((account) => ({
          id: account.id,
          accountNo: account.accountNo,
          balance: account.balance.toString(),
          status: account.status,
          createdAt: account.createdAt,
          updatedAt: account.updatedAt,
          accountHolder: account.user
        }))
      });
    } catch (error) {
      console.error("Admin accounts error:", error);

      return res.status(500).json({
        message: "Could not retrieve accounts"
      });
    }
  }
);
// POST /api/admin/accounts/:accountId/deposit
router.post(
  "/accounts/:accountId/deposit",
  authenticate,
  requireRole("ADMIN"),
  async (req, res) => {
    const depositSchema = z.object({
      amount: z.number().int().positive().safe(),
      description: z.string().max(200).optional()
    });

    const validation = depositSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({
        message: "Invalid deposit details",
        errors: validation.error.issues
      });
    }

    const { accountId } = req.params;
    const { amount, description } = validation.data;
    const amountInPaise = BigInt(amount);

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

    const requestHash = createHash("sha256")
      .update(
        JSON.stringify({
          accountId,
          amount,
          description: description ?? "Admin demo deposit"
        })
      )
      .digest("hex");

    try {
      const result = await prisma.$transaction(
        async (tx) => {
          const existingRequest =
            await tx.idempotencyKey.findUnique({
              where: { key: idempotencyKey }
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

          const account = await tx.account.findUnique({
            where: { id: accountId }
          });

          if (!account) {
            throw new Error("ACCOUNT_NOT_FOUND");
          }

          if (account.status !== "ACTIVE") {
            throw new Error("ACCOUNT_NOT_ACTIVE");
          }

          const updated = await tx.account.updateMany({
            where: {
              id: accountId,
              status: "ACTIVE"
            },
            data: {
              balance: {
                increment: amountInPaise
              }
            }
          });

          if (updated.count !== 1) {
            throw new Error("ACCOUNT_NOT_ACTIVE");
          }

          const transaction = await tx.transaction.create({
            data: {
              type: "DEPOSIT",
              status: "COMPLETED",
              amount: amountInPaise,
              reference: randomUUID(),
              description: description ?? "Admin demo deposit"
            }
          });

          await tx.ledgerEntry.create({
            data: {
              transactionId: transaction.id,
              accountId,
              entryType: "CREDIT",
              amount: amountInPaise
            }
          });

          const updatedAccount = await tx.account.findUnique({
            where: { id: accountId }
          });

          await tx.auditLog.create({
            data: {
              userId: req.user.id,
              action: "ADMIN_DEPOSIT_COMPLETED",
              details: {
                transactionId: transaction.id,
                accountId,
                amount: amountInPaise.toString(),
                adminId: req.user.id
              }
            }
          });

          const responseBody = {
            message: "Demo deposit completed successfully",
            transaction: {
              id: transaction.id,
              reference: transaction.reference,
              type: transaction.type,
              amount: transaction.amount.toString(),
              status: transaction.status
            },
            account: {
              id: updatedAccount.id,
              accountNo: updatedAccount.accountNo,
              balance: updatedAccount.balance.toString()
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
      if (error.message === "IDEMPOTENCY_KEY_REUSED") {
        return res.status(409).json({
          message: "Idempotency key already used for another request"
        });
      }

      if (error.message === "IDEMPOTENCY_REQUEST_INCOMPLETE") {
        return res.status(409).json({
          message: "Previous request incomplete. Use a new key."
        });
      }

      if (error.message === "ACCOUNT_NOT_FOUND") {
        return res.status(404).json({
          message: "Account not found"
        });
      }

      if (error.message === "ACCOUNT_NOT_ACTIVE") {
        return res.status(409).json({
          message: "Only active accounts can receive deposits"
        });
      }

      if (error.code === "P2002" || error.code === "P2034") {
        return res.status(409).json({
          message: "Deposit conflict. Retry using the same idempotency key."
        });
      }

      console.error("Admin deposit error:", error);

      return res.status(500).json({
        message: "Could not complete deposit"
      });
    }
  }
);
export default router;


import express from "express";
import { randomBytes } from "crypto";
import { prisma } from "../db.js";
import {
  authenticate,
  requireRole
} from "../middleware/authMiddleware.js";

const router = express.Router();

// Create an account for the currently logged-in user
router.post(
  "/",
  authenticate,
  requireRole("ACCOUNT_HOLDER"),
  async (req, res) => {
    try {
      const accountNo =
        "BV" + randomBytes(6).toString("hex").toUpperCase();

      // Create account and audit record together
      const account = await prisma.$transaction(async (tx) => {
        const newAccount = await tx.account.create({
          data: {
            accountNo,
            userId: req.user.id,
            balance: 0n,
            status: "ACTIVE"
          }
        });

        await tx.auditLog.create({
          data: {
            userId: req.user.id,
            action: "ACCOUNT_CREATED",
            details: {
              accountId: newAccount.id,
              accountNo: newAccount.accountNo
            }
          }
        });

        return newAccount;
      });

      return res.status(201).json({
        message: "Account created successfully",
        account: {
          id: account.id,
          accountNo: account.accountNo,
          balance: account.balance.toString(),
          status: account.status,
          createdAt: account.createdAt
        }
      });

    } catch (error) {
      console.error("Account creation error:", error);

      return res.status(500).json({
        message: "Could not create account"
      });
    }
  }
);

router.get(
  "/my",
  authenticate,
  requireRole("ACCOUNT_HOLDER"),
  async (req, res) => {
    try {
      const accounts = await prisma.account.findMany({
        where: {
          userId: req.user.id
        },
        orderBy: {
          createdAt: "desc"
        }
      });

      return res.status(200).json({
        message: "Accounts retrieved successfully",
        count: accounts.length,
        accounts: accounts.map(account => ({
          id: account.id,
          accountNo: account.accountNo,
          balance: account.balance.toString(),
          status: account.status,
          createdAt: account.createdAt
        }))
      });

    } catch (error) {
      console.error("Fetch accounts error:", error);

      return res.status(500).json({
        message: "Could not retrieve accounts"
      });
    }
  }
);

export default router;

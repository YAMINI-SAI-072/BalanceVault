
import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";

import { prisma } from "./db.js";

import authRoutes from "./routes/authRoutes.js";
import adminRoutes from "./routes/adminRoutes.js";
import accountRoutes from "./routes/accountRoutes.js";
import transactionRoutes from "./routes/transactionRoutes.js";

import {
  apiRateLimit,
  authRateLimit
} from "./middleware/rateLimit.js";

const app = express();

// 1. Security middleware
app.use(helmet());

app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5173"
  })
);

app.use(express.json());

// 2. Redis rate limiting
app.use("/api", apiRateLimit);
app.use("/api/auth", authRateLimit);

// 3. API routes
app.use("/api/auth", authRoutes);
app.use("/api/accounts", accountRoutes);
app.use("/api/transactions", transactionRoutes);
app.use("/api/admin", adminRoutes);

// 4. Basic API health check
app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    service: "balancevault-api",
    message: "Backend is running successfully!"
  });
});

// 5. Database health check
app.get("/health/db", async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;

    res.status(200).json({
      status: "ok",
      database: "connected"
    });
  } catch (error) {
    console.error("Database connection failed:", error);

    res.status(500).json({
      status: "error",
      database: "disconnected"
    });
  }
});

// 6. Readiness check
app.get("/ready", async (req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;

    res.status(200).json({
      status: "ready",
      database: "connected"
    });
  } catch (error) {
    console.error("Readiness check failed:", error);

    res.status(503).json({
      status: "not_ready",
      database: "disconnected"
    });
  }
});

// 7. Start server
const PORT = Number(process.env.PORT || 5000);

app.listen(PORT, () => {
  console.log(
    `BalanceVault API running at http://localhost:${PORT}`
  );
});

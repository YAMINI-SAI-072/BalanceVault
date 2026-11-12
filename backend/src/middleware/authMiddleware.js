
import jwt from "jsonwebtoken";
import { prisma } from "../db.js";

// Verify the JWT and identify the current user
export async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({
        message: "Authentication required"
      });
    }

    const token = authHeader.split(" ")[1];

    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    if (!decoded || typeof decoded !== "object" || !decoded.userId) {
      return res.status(401).json({
        message: "Invalid token"
      });
    }

    // Read the current role from the database.
    // This prevents an outdated JWT role from granting permissions.
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true
      }
    });

    if (!user) {
      return res.status(401).json({
        message: "User no longer exists"
      });
    }

    req.user = user;
    next();

  } catch (error) {
    return res.status(401).json({
      message: "Invalid or expired token"
    });
  }
}

// Check whether the current user has an allowed role
export function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        message: "Authentication required"
      });
    }

    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        message: "You do not have permission to access this resource"
      });
    }

    next();
  };
}

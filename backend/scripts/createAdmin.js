
import "dotenv/config";
import bcrypt from "bcryptjs";
import { prisma } from "../src/db.js";

async function createAdmin() {
  const name = process.env.ADMIN_NAME;
  const email = process.env.ADMIN_EMAIL?.toLowerCase();
  const password = process.env.ADMIN_PASSWORD;

  if (!name || !email || !password || password.length < 12) {
    throw new Error(
      "Set ADMIN_NAME, ADMIN_EMAIL and an ADMIN_PASSWORD of at least 12 characters in .env"
    );
  }

  const existingUser = await prisma.user.findUnique({
    where: { email }
  });

  if (existingUser) {
    throw new Error(
      "This email already exists. Use a different email for the first admin."
    );
  }

  const passwordHash = await bcrypt.hash(password, 12);

  const admin = await prisma.user.create({
    data: {
      name,
      email,
      passwordHash,
      role: "ADMIN"
    },
    select: {
      id: true,
      name: true,
      email: true,
      role: true
    }
  });

  console.log("First admin created successfully:", admin);
}

createAdmin()
  .catch((error) => {
    console.error("Admin creation failed:", error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

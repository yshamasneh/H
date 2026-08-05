import dotenv from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import argon2 from "argon2";
import { PrismaClient, UserRole } from "../src/generated/prisma/client";

dotenv.config({ path: "../../.env" });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to seed the database");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl })
});

async function main(): Promise<void> {
  const passwordHash = await argon2.hash("Test@12345", {
    type: argon2.argon2id,
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1
  });

  await prisma.user.upsert({
    where: { phone: "+970590000000" },
    create: {
      fullName: "test",
      phone: "+970590000000",
      passwordHash,
      role: UserRole.CUSTOMER,
      phoneVerifiedAt: new Date(),
      isActive: true
    },
    update: {
      fullName: "test",
      passwordHash,
      role: UserRole.CUSTOMER,
      phoneVerifiedAt: new Date(),
      isActive: true
    }
  });
  console.log("Seeded local customer: +970590000000");

  await prisma.user.upsert({
    where: { phone: "+970590000001" },
    create: {
      fullName: "admin",
      phone: "+970590000001",
      passwordHash,
      role: UserRole.ADMIN,
      phoneVerifiedAt: new Date(),
      isActive: true
    },
    update: {
      fullName: "admin",
      passwordHash,
      role: UserRole.ADMIN,
      phoneVerifiedAt: new Date(),
      isActive: true
    }
  });
  console.log("Seeded local admin: +970590000001");
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exitCode = 1;
  });

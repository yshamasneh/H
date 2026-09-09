/**
 * Creates the first SUPER_ADMIN account in a database that has no administrator yet.
 *
 * `prisma db seed` refuses to run in production (see seed.ts), and creating an admin
 * through the API requires an already-authenticated admin with MANAGE_ADMINS — a chicken-
 * and-egg problem for a brand-new deployment. This script is the one safe way out of that:
 * it hashes the password with the exact same argon2id parameters the running app uses
 * (`hashPassword` from `src/auth/crypto.util`, imported directly rather than reimplemented,
 * so the two can never drift), assigns the seeded SUPER_ADMIN platform role, and refuses to
 * run at all if any administrator account already exists.
 *
 * Usage:
 *   npx tsx prisma/bootstrap-admin.ts --phone +970591234567 --password 'Str0ng!Passw0rd' --name "Ops Admin"
 *   npx tsx prisma/bootstrap-admin.ts                      # prompts interactively for anything missing
 *
 * Run from apps/api, or via the root convenience script: `npm run bootstrap:admin`.
 */
import { createInterface } from "node:readline/promises";
import dotenv from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, UserRole } from "../src/generated/prisma/client";
import { hashPassword } from "../src/auth/crypto.util";
import { normalizePhoneNumber } from "../src/auth/phone.util";
import { supportedCountryCodes, type SupportedCountryCode } from "../src/auth/auth.dto";

dotenv.config({ path: "../../.env" });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to bootstrap the first admin.");
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl })
});

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const existingAdmin = await prisma.user.findFirst({ where: { role: UserRole.ADMIN } });
  if (existingAdmin) {
    throw new Error(
      `Refusing to bootstrap: an administrator account already exists (phone ${existingAdmin.phone}). ` +
        "Create additional admins through POST /admin/users/admins once logged in."
    );
  }

  const superAdminRole = await prisma.role.findUnique({ where: { key: "SUPER_ADMIN" } });
  if (!superAdminRole) {
    throw new Error(
      "The SUPER_ADMIN system role does not exist yet. Run `npm run prisma:deploy` (apply migrations) first."
    );
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const fullName = (args.name ?? (await rl.question("Full name: "))).trim();
    if (fullName.length < 2) {
      throw new Error("Full name must be at least 2 characters.");
    }

    const rawPhone = args.phone ?? (await rl.question("Phone number (E.164, e.g. +970591234567): "));
    const phone = normalizePhoneNumber(detectCountryCode(rawPhone), rawPhone.trim());

    const password = args.password ?? (await promptHidden(rl, "Password (min 8 characters): "));
    if (password.length < 8 || password.length > 72) {
      throw new Error("Password must be between 8 and 72 characters.");
    }

    if (await prisma.user.findUnique({ where: { phone } })) {
      throw new Error(`A user with phone ${phone} already exists.`);
    }

    const passwordHash = await hashPassword(password);
    const created = await prisma.user.create({
      data: {
        fullName,
        phone,
        passwordHash,
        role: UserRole.ADMIN,
        platformRoleId: superAdminRole.id,
        phoneVerifiedAt: new Date(),
        isActive: true
      }
    });

    console.log(`Created the first SUPER_ADMIN: ${created.fullName} (${created.phone}).`);
    console.log("Sign in from the admin console with this phone number and password.");
  } finally {
    rl.close();
  }
}

function detectCountryCode(phone: string): SupportedCountryCode {
  const trimmed = phone.trim();
  const match = supportedCountryCodes.find((code) => trimmed.startsWith(code));
  if (!match) {
    throw new Error(`Phone number must start with one of: ${supportedCountryCodes.join(", ")}`);
  }
  return match;
}

function parseArgs(argv: string[]): { phone?: string; password?: string; name?: string } {
  const result: { phone?: string; password?: string; name?: string } = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if ((arg === "--phone" || arg === "-p") && next) {
      result.phone = next;
      i += 1;
    } else if ((arg === "--password" || arg === "-w") && next) {
      result.password = next;
      i += 1;
    } else if ((arg === "--name" || arg === "-n") && next) {
      result.name = next;
      i += 1;
    }
  }
  return result;
}

/** Prompts for a password without echoing it to the terminal. */
async function promptHidden(rl: ReturnType<typeof createInterface>, query: string): Promise<string> {
  const output = process.stdout;
  const stdin = process.stdin;
  if (!stdin.isTTY) {
    // Not an interactive terminal (e.g. piped input) — fall back to a plain prompt.
    return rl.question(query);
  }
  output.write(query);
  return new Promise<string>((resolve) => {
    let value = "";
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    const onData = (char: string): void => {
      if (char === "\n" || char === "\r" || char === "") {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener("data", onData);
        output.write("\n");
        resolve(value);
        return;
      }
      if (char === "") {
        // Ctrl+C
        process.exit(1);
      }
      if (char === "" || char === "\b") {
        value = value.slice(0, -1);
        return;
      }
      value += char;
    };
    stdin.on("data", onData);
  });
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    await prisma.$disconnect();
    process.exitCode = 1;
  });

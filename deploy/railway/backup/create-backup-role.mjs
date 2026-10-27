// Creates (or rotates the password of) the read-only database role the backup job logs in as,
// and stores its password straight into the "backup" service's BACKUP_PGPASSWORD Railway variable.
// Run from the repository root on an operator machine, with the Railway CLI linked to project jovo:
//   node deploy/railway/backup/create-backup-role.mjs
// It reads the Postgres service's admin credentials from Railway in-process and connects through
// the Postgres TCP proxy (or ADMIN_DATABASE_URL if set). Nothing secret is printed: the password is
// generated here, sent to PostgreSQL only as a SCRAM-SHA-256 verifier (so the plaintext never
// reaches the server or its logs), and piped to `railway variable set --stdin`.
import { spawn } from "node:child_process";
import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";
import { pathToFileURL } from "node:url";
import pg from "pg";

export const backupRoleName = "jovo_backup";

/** The verifier PostgreSQL stores for SCRAM-SHA-256 passwords (RFC 5802 / RFC 7677). */
export function scramSha256Verifier(password, salt = randomBytes(16), iterations = 4096) {
  const salted = pbkdf2Sync(Buffer.from(password, "utf8"), salt, iterations, 32, "sha256");
  const clientKey = createHmac("sha256", salted).update("Client Key").digest();
  const storedKey = createHash("sha256").update(clientKey).digest();
  const serverKey = createHmac("sha256", salted).update("Server Key").digest();
  return `SCRAM-SHA-256$${iterations}:${salt.toString("base64")}$${storedKey.toString("base64")}:${serverKey.toString("base64")}`;
}

/** Statements that create the role, or bring an existing one back to exactly these rights. */
export function backupRoleStatements(database, verifier) {
  const role = `"${backupRoleName}"`;
  const literal = `'${verifier.replaceAll("'", "''")}'`;
  return [
    `DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '${backupRoleName}') THEN CREATE ROLE ${role}; END IF; END $$`,
    `ALTER ROLE ${role} WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS INHERIT CONNECTION LIMIT 3 PASSWORD ${literal}`,
    // pg_read_all_data (PostgreSQL 14+) is SELECT on every table and sequence and USAGE on every
    // schema, which is what pg_dump needs, and nothing that writes.
    `GRANT pg_read_all_data TO ${role}`,
    `GRANT CONNECT ON DATABASE "${database.replaceAll('"', '""')}" TO ${role}`,
    `ALTER ROLE ${role} SET default_transaction_read_only = on`
  ];
}

async function main() {
  const adminUrl = process.env.ADMIN_DATABASE_URL || (await adminUrlFromRailway());
  const database = decodeURIComponent(new URL(adminUrl).pathname.replace(/^\//, ""));
  const password = randomBytes(36).toString("base64url");
  const client = new pg.Client({ connectionString: adminUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    for (const statement of backupRoleStatements(database, scramSha256Verifier(password))) {
      await client.query(statement);
    }
  } finally {
    await client.end();
  }
  await pipeToRailway(["variable", "set", "BACKUP_PGPASSWORD", "--stdin", "--service", "backup", "--skip-deploys"], password);
  console.log(`Role ${backupRoleName} is ready (read-only, SCRAM password, at most 3 connections); BACKUP_PGPASSWORD was set on the backup service.`);
}

async function adminUrlFromRailway() {
  const variables = JSON.parse(await captureRailway(["variable", "list", "--service", "Postgres", "--json"]));
  for (const key of ["PGUSER", "PGPASSWORD", "PGDATABASE", "RAILWAY_TCP_PROXY_DOMAIN", "RAILWAY_TCP_PROXY_PORT"]) {
    if (!variables[key]) throw new Error(`The Postgres service has no ${key}; is the TCP proxy still enabled? Set ADMIN_DATABASE_URL instead.`);
  }
  return `postgresql://${encodeURIComponent(variables.PGUSER)}:${encodeURIComponent(variables.PGPASSWORD)}@${variables.RAILWAY_TCP_PROXY_DOMAIN}:${variables.RAILWAY_TCP_PROXY_PORT}/${variables.PGDATABASE}?sslmode=require`;
}

function captureRailway(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("railway", args, { stdio: ["ignore", "pipe", "ignore"], shell: false });
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code) => (code === 0 ? resolve(stdout) : reject(new Error(`railway ${args[0]} ${args[1]} failed (exit ${code}).`))));
  });
}

function pipeToRailway(args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn("railway", args, { stdio: ["pipe", "ignore", "ignore"], shell: false });
    child.once("error", reject);
    child.once("exit", (code) => (code === 0 ? resolve() : reject(new Error(`railway ${args.slice(0, 3).join(" ")} failed (exit ${code}).`))));
    child.stdin.end(input);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message.replace(/postgres(?:ql)?:\/\/\S+/g, "postgresql://***") : error);
    process.exitCode = 1;
  });
}

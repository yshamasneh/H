import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { argumentValue, databaseConnection, loadEnvironmentFile, postgresRunner } from "./database-command.mjs";

loadEnvironmentFile();
const fileArgument = argumentValue("file");
if (!fileArgument) throw new Error("Pass the backup path with --file=path/to/backup.dump.");
const backupPath = path.resolve(fileArgument);
await access(backupPath);
await verifyChecksumWhenPresent(backupPath);
const runner = await postgresRunner("pg_restore");
console.log(`Using ${runner.describe}.`);
await runner.withFile("input", backupPath, (archivePath) => runner.exec("pg_restore", ["--list", archivePath]));

if (process.argv.includes("--verify-only")) {
  console.log(`Backup archive and checksum are valid: ${backupPath}`);
  process.exit(0);
}

const restoreUrl = process.env.RESTORE_DATABASE_URL;
if (!restoreUrl) throw new Error("RESTORE_DATABASE_URL is required for a restore. DATABASE_URL is intentionally ignored.");
const connection = databaseConnection(restoreUrl);
const confirmation = argumentValue("confirm-restore");
if (confirmation !== connection.database) {
  throw new Error(`Destructive restore blocked. Re-run with --confirm-restore=${connection.database} after verifying the target.`);
}

await runner.withFile("input", backupPath, (archivePath) =>
  runner.exec(
    "pg_restore",
    [
      ...runner.connectionArgs(connection),
      "--clean",
      "--if-exists",
      "--exit-on-error",
      "--no-owner",
      "--no-privileges",
      archivePath
    ],
    connection.environment
  )
);
console.log(`Restore completed into database ${connection.database}.`);

async function verifyChecksumWhenPresent(filePath) {
  const checksumPath = `${filePath}.sha256`;
  let expected;
  try {
    expected = (await readFile(checksumPath, "utf8")).trim().split(/\s+/, 1)[0];
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  const actual = await sha256(filePath);
  if (actual !== expected) throw new Error("Backup checksum verification failed.");
}

function sha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(filePath).on("error", reject).on("data", (chunk) => hash.update(chunk)).on("end", () => resolve(hash.digest("hex")));
  });
}

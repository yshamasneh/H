import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { argumentValue, databaseConnection, loadEnvironmentFile, postgresRunner } from "./database-command.mjs";

loadEnvironmentFile();
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required. Set it in .env at the repository root or in the environment.");
const connection = databaseConnection(databaseUrl);
const runner = await postgresRunner("pg_dump");
const outputDirectory = path.resolve(argumentValue("output-dir") ?? process.env.BACKUP_DIRECTORY ?? "backups");
const retentionDays = positiveInteger(process.env.BACKUP_RETENTION_DAYS ?? "14", "BACKUP_RETENTION_DAYS");
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const finalPath = path.join(outputDirectory, `tasawaq-${timestamp}.dump`);
const partialPath = `${finalPath}.partial`;

await mkdir(outputDirectory, { recursive: true });
console.log(`Using ${runner.describe}.`);
await runner.withFile("output", partialPath, (dumpPath) =>
  runner.exec(
    "pg_dump",
    [
      ...runner.connectionArgs(connection),
      "--format=custom",
      "--compress=9",
      "--no-owner",
      "--no-privileges",
      "--file",
      dumpPath
    ],
    connection.environment
  )
);
await rename(partialPath, finalPath);
const checksum = await sha256(finalPath);
await writeFile(`${finalPath}.sha256`, `${checksum}  ${path.basename(finalPath)}\n`, "utf8");
await removeExpiredBackups(outputDirectory, retentionDays);
console.log(`Backup completed: ${finalPath}`);
console.log(`SHA-256: ${checksum}`);

async function removeExpiredBackups(directory, days) {
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1_000;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (!entry.isFile() || !/^tasawaq-.*\.dump(?:\.sha256)?$/.test(entry.name)) continue;
    const filePath = path.join(directory, entry.name);
    if ((await stat(filePath)).mtimeMs < cutoff) await unlink(filePath);
  }
}

function sha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(filePath).on("error", reject).on("data", (chunk) => hash.update(chunk)).on("end", () => resolve(hash.digest("hex")));
  });
}

function positiveInteger(raw, name) {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer.`);
  return value;
}

// JOVO daily database backup: the Railway cron service "backup" runs this and exits.
//
// 1. Opens a REPEATABLE READ, READ ONLY transaction as the read-only role jovo_backup over
//    Railway's private network, exports its snapshot and counts every table's rows in it.
// 2. pg_dump --snapshot dumps exactly that snapshot, so the counts describe the dump precisely.
// 3. Both the dump and a manifest (counts, sizes, checksum, versions) are encrypted with the age
//    PUBLIC key(s) in BACKUP_AGE_RECIPIENTS; the private key never comes near Railway.
// 4. Both are uploaded under new names to the external bucket with a key that can only write.
//    Retention is the bucket's lifecycle rule (delete after 30 days); a write-only key cannot
//    delete, which is also what stops a stolen key from wiping the backups.
// 5. healthchecks.io is pinged at start, on success and on failure.
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import pg from "pg";
import {
  ageEncrypt,
  ageRecipients,
  backupObjectKeys,
  backupS3Client,
  countRows,
  fileSize,
  ping,
  redact,
  requiredEnv,
  run,
  sha256File
} from "./lib.mjs";

const healthcheckUrl = process.env.BACKUP_HEALTHCHECK_URL?.trim() || "";
const startedAt = new Date();
await ping(healthcheckUrl, "start");
const workDirectory = await mkdtemp(path.join(tmpdir(), "jovo-backup-"));

try {
  const summary = await backup(workDirectory);
  const message = `ok ${summary.dumpKey} tables=${summary.tables} rows=${summary.rows} bytes=${summary.encryptedBytes} seconds=${summary.seconds}`;
  console.log(message);
  await ping(healthcheckUrl, "success", message);
} catch (error) {
  const message = redact(error instanceof Error ? error.message : String(error));
  console.error(`Backup failed: ${message}`);
  await ping(healthcheckUrl, "fail", message);
  process.exitCode = 1;
} finally {
  await rm(workDirectory, { recursive: true, force: true });
}

async function backup(directory) {
  const recipients = ageRecipients(requiredEnv("BACKUP_AGE_RECIPIENTS"));
  const bucket = requiredEnv("BACKUP_S3_BUCKET");
  const s3 = backupS3Client();
  const connection = {
    host: requiredEnv("BACKUP_PGHOST"),
    port: Number(process.env.BACKUP_PGPORT || 5432),
    database: requiredEnv("BACKUP_PGDATABASE"),
    user: requiredEnv("BACKUP_PGUSER"),
    password: requiredEnv("BACKUP_PGPASSWORD")
  };
  // Railway's private network is already encrypted (WireGuard) and private hostnames do not match
  // the database's certificate, so TLS is not required here. BACKUP_PGSSLMODE can still ask for it.
  const sslMode = process.env.BACKUP_PGSSLMODE?.trim() || "disable";
  const client = new pg.Client({ ...connection, ssl: sslMode === "disable" ? false : { rejectUnauthorized: sslMode === "verify-full" } });
  const dumpPath = path.join(directory, "jovo.dump");
  let manifest;
  await client.connect();
  try {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const snapshot = (await client.query("select pg_export_snapshot() as id")).rows[0].id;
    const tables = await countRows(client);
    const serverVersion = (await client.query("show server_version")).rows[0].server_version;
    await run(
      "pg_dump",
      [
        "--host", connection.host,
        "--port", String(connection.port),
        "--username", connection.user,
        "--dbname", connection.database,
        "--snapshot", snapshot,
        "--format=custom",
        "--compress=9",
        "--no-owner",
        "--no-privileges",
        "--file", dumpPath
      ],
      { ...process.env, PGPASSWORD: connection.password, PGSSLMODE: sslMode === "disable" ? "disable" : "require" }
    );
    manifest = {
      format: "jovo-backup/1",
      createdAt: startedAt.toISOString(),
      database: connection.database,
      serverVersion,
      tables,
      totalRows: Object.values(tables).reduce((sum, count) => sum + count, 0),
      dumpBytes: await fileSize(dumpPath),
      dumpSha256: await sha256File(dumpPath)
    };
    await client.query("COMMIT");
  } finally {
    await client.end().catch(() => {});
  }

  const manifestPath = path.join(directory, "manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const keys = backupObjectKeys(process.env.BACKUP_S3_PREFIX || "jovo", startedAt);
  const encryptedDump = `${dumpPath}.age`;
  const encryptedManifest = `${manifestPath}.age`;
  await ageEncrypt(dumpPath, encryptedDump, recipients);
  await ageEncrypt(manifestPath, encryptedManifest, recipients);
  await rm(dumpPath, { force: true });

  for (const [key, file, contentType] of [
    [keys.dump, encryptedDump, "application/octet-stream"],
    [keys.manifest, encryptedManifest, "application/octet-stream"]
  ]) {
    await s3.send(
      new PutObjectCommand({ Bucket: bucket, Key: key, Body: await readFile(file), ContentType: contentType })
    );
  }

  return {
    dumpKey: keys.dump,
    tables: Object.keys(manifest.tables).length,
    rows: manifest.totalRows,
    encryptedBytes: await fileSize(encryptedDump),
    seconds: Math.round((Date.now() - startedAt.getTime()) / 1000)
  };
}

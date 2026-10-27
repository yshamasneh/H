// Shared pieces of the JOVO database backup job (backup.mjs), its restore (restore.mjs) and its
// restore test (restore-test.mjs). docs/railway-setup.md, "Backups", describes the whole design.
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { S3Client } from "@aws-sdk/client-s3";

export function requiredEnv(name, environment = process.env) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

/** The external backup bucket. BACKUP_S3_* only, so it can never be mistaken for image storage. */
export function backupS3Client(environment = process.env) {
  return new S3Client({
    endpoint: requiredEnv("BACKUP_S3_ENDPOINT", environment),
    region: environment.BACKUP_S3_REGION?.trim() || "auto",
    forcePathStyle: environment.BACKUP_S3_FORCE_PATH_STYLE === "true",
    credentials: {
      accessKeyId: requiredEnv("BACKUP_S3_ACCESS_KEY_ID", environment),
      secretAccessKey: requiredEnv("BACKUP_S3_SECRET_ACCESS_KEY", environment)
    }
  });
}

/**
 * Object names for one run. Every run writes new names (never overwrites), which a write-only key
 * requires, and the date folders let a bucket lifecycle rule or a person find a day quickly.
 */
export function backupObjectKeys(prefix, date) {
  const stamp = date.toISOString().replace(/[:.]/g, "-");
  const folder = `${trimSlashes(prefix)}/${stamp.slice(0, 4)}/${stamp.slice(5, 7)}`;
  return {
    dump: `${folder}/jovo-${stamp}.dump.age`,
    manifest: `${folder}/jovo-${stamp}.manifest.json.age`
  };
}

export function manifestKeyFor(dumpKey) {
  if (!dumpKey.endsWith(".dump.age")) throw new Error(`Not a backup dump object: ${dumpKey}`);
  return dumpKey.replace(/\.dump\.age$/, ".manifest.json.age");
}

/** Newest dump among listed object keys; names sort by time because they embed an ISO stamp. */
export function latestDumpKey(keys) {
  return keys.filter((key) => key.endsWith(".dump.age")).sort().at(-1) ?? null;
}

/** Exact row count of every ordinary table in the public schema, inside the caller's transaction. */
export async function countRows(client) {
  const tables = await client.query(
    "select tablename from pg_catalog.pg_tables where schemaname = 'public' order by tablename"
  );
  const counts = {};
  for (const { tablename } of tables.rows) {
    const result = await client.query(`select count(*)::bigint as n from public.${quoteIdentifier(tablename)}`);
    counts[tablename] = Number(result.rows[0].n);
  }
  return counts;
}

/** Tables whose counts differ, or that exist on only one side. Empty means the restore matches. */
export function compareCounts(expected, actual) {
  const differences = [];
  for (const table of new Set([...Object.keys(expected), ...Object.keys(actual)])) {
    if (expected[table] !== actual[table]) {
      differences.push({ table, expected: expected[table] ?? null, actual: actual[table] ?? null });
    }
  }
  return differences.sort((a, b) => a.table.localeCompare(b.table));
}

export function quoteIdentifier(name) {
  return `"${String(name).replaceAll('"', '""')}"`;
}

/** age recipients from BACKUP_AGE_RECIPIENTS: public keys only, separated by commas or whitespace. */
export function ageRecipients(value) {
  const recipients = String(value ?? "").split(/[\s,]+/).filter(Boolean);
  if (recipients.length === 0) throw new Error("BACKUP_AGE_RECIPIENTS must contain at least one age public key.");
  for (const recipient of recipients) {
    if (recipient.startsWith("AGE-SECRET-KEY-")) {
      throw new Error("BACKUP_AGE_RECIPIENTS contains an age SECRET key. Only the public key (age1...) belongs here.");
    }
    if (!/^age1[0-9a-z]{58}$/.test(recipient)) throw new Error("BACKUP_AGE_RECIPIENTS entries must be age public keys (age1...).");
  }
  return recipients;
}

export function ageEncrypt(inputPath, outputPath, recipients) {
  return run("age", [...recipients.flatMap((recipient) => ["-r", recipient]), "-o", outputPath, inputPath]);
}

export function ageDecrypt(inputPath, outputPath, identityPath) {
  return run("age", ["-d", "-i", identityPath, "-o", outputPath, inputPath]);
}

/**
 * healthchecks.io: `/start` when a run begins, the bare URL on success, `/fail` on failure. A ping
 * that cannot be delivered never fails the backup itself; the check's own grace period then raises
 * the alarm instead.
 */
export async function ping(checkUrl, outcome, body = "", fetchImplementation = fetch) {
  if (!checkUrl) return false;
  const suffix = outcome === "start" ? "/start" : outcome === "fail" ? "/fail" : "";
  try {
    const response = await fetchImplementation(`${checkUrl.replace(/\/+$/, "")}${suffix}`, {
      method: "POST",
      body: redact(String(body)).slice(0, 10_000),
      signal: AbortSignal.timeout(10_000)
    });
    return response.ok;
  } catch {
    return false;
  }
}

/** Strips anything shaped like a credential before text leaves the job (logs, pings). */
export function redact(text) {
  return String(text)
    .replace(/(postgres(?:ql)?:\/\/[^:/\s]+:)[^@\s]+@/gi, "$1***@")
    .replace(/AGE-SECRET-KEY-[0-9A-Z]+/g, "AGE-SECRET-KEY-***")
    .replace(/(^|[\s"'(,{])([A-Za-z0-9_]*(?:password|secret|token|key)[A-Za-z0-9_]*["']?\s*[=:]\s*["']?)[^\s,;"'}]+/gi, "$1$2***");
}

export function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(filePath).on("error", reject).on("data", (chunk) => hash.update(chunk)).on("end", () => resolve(hash.digest("hex")));
  });
}

export async function fileSize(filePath) {
  return (await stat(filePath)).size;
}

/** Runs a tool without a shell; stderr is captured (redacted) for the error, never echoed raw. */
export function run(command, args, environment = process.env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "inherit", "pipe"], shell: false, env: environment });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk).slice(-4_000);
    });
    child.once("error", (error) => reject(new Error(`${command} could not start: ${error.message}`)));
    child.once("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} failed (exit ${code}): ${redact(stderr.trim())}`));
    });
  });
}

function trimSlashes(value) {
  return String(value ?? "").replace(/^\/+|\/+$/g, "") || "jovo";
}

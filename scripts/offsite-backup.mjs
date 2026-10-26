/**
 * Daily backup of the Railway deployment to storage outside Railway (docs/railway-setup.md,
 * "Backups"). Railway's own volume backups live with the volume and can only be restored into the
 * same project, so they do not protect against losing the project or the account.
 *
 *  1. Dumps the database with scripts/backup-database.mjs (custom format, SHA-256 sidecar,
 *     BACKUP_RETENTION_DAYS pruning) into <BACKUP_DIRECTORY>/database.
 *  2. Re-reads the new archive with pg_restore --list, so a truncated dump fails today, not on
 *     the day it is needed.
 *  3. When BACKUP_S3_* is set, mirrors the public image bucket into <BACKUP_DIRECTORY>/images:
 *     new and changed objects are downloaded, nothing local is ever deleted, so an image removed
 *     (or wiped) in the bucket survives here.
 *
 * Settings, from the environment only (never pass secrets as arguments):
 *   BACKUP_DATABASE_URL   the Postgres TCP-proxy URL, with ?sslmode=require
 *   BACKUP_DIRECTORY      where backups go, e.g. a folder on another disk or a synced drive
 *   PG_DOCKER_IMAGE       optional, e.g. postgres:18 when pg_dump 18+ is not installed locally
 *   BACKUP_S3_ENDPOINT, BACKUP_S3_ACCESS_KEY_ID, BACKUP_S3_SECRET_ACCESS_KEY, BACKUP_S3_BUCKET,
 *   BACKUP_S3_REGION (default auto), BACKUP_S3_FORCE_PATH_STYLE (default false)
 */
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pipeline } from "node:stream/promises";

const repositoryRoot = path.resolve(import.meta.dirname, "..");
const databaseUrl = required("BACKUP_DATABASE_URL");
const backupDirectory = path.resolve(required("BACKUP_DIRECTORY"));
const databaseDirectory = path.join(backupDirectory, "database");

await runNode("backup-database.mjs", [`--output-dir=${databaseDirectory}`], { DATABASE_URL: databaseUrl });
const newest = (await readdir(databaseDirectory)).filter((name) => /^tasawaq-.*\.dump$/.test(name)).sort().at(-1);
if (!newest) throw new Error("The database backup did not produce a .dump file.");
await runNode("restore-database.mjs", [`--file=${path.join(databaseDirectory, newest)}`, "--verify-only"], {});

if (process.env.BACKUP_S3_BUCKET) {
  await mirrorImages(path.join(backupDirectory, "images"));
} else {
  console.log("BACKUP_S3_BUCKET is not set: image mirroring skipped.");
}
console.log(`Off-site backup finished in ${backupDirectory}`);

async function mirrorImages(directory) {
  const { GetObjectCommand, ListObjectsV2Command, S3Client } = await import("@aws-sdk/client-s3");
  const bucket = required("BACKUP_S3_BUCKET");
  const client = new S3Client({
    endpoint: required("BACKUP_S3_ENDPOINT"),
    region: process.env.BACKUP_S3_REGION || "auto",
    forcePathStyle: process.env.BACKUP_S3_FORCE_PATH_STYLE === "true",
    credentials: { accessKeyId: required("BACKUP_S3_ACCESS_KEY_ID"), secretAccessKey: required("BACKUP_S3_SECRET_ACCESS_KEY") }
  });
  const manifestPath = path.join(directory, "manifest.json");
  await mkdir(directory, { recursive: true });
  const manifest = await readFile(manifestPath, "utf8").then(JSON.parse, () => ({}));
  let listed = 0;
  let downloaded = 0;
  let continuationToken;
  do {
    const page = await client.send(new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: continuationToken }));
    for (const object of page.Contents ?? []) {
      if (!object.Key || object.Key.endsWith("/")) continue;
      listed += 1;
      if (manifest[object.Key]?.etag === object.ETag) continue;
      const target = path.resolve(directory, "objects", ...object.Key.split("/"));
      if (!target.startsWith(path.join(directory, "objects") + path.sep)) throw new Error(`Unsafe object key: ${object.Key}`);
      await mkdir(path.dirname(target), { recursive: true });
      const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: object.Key }));
      await pipeline(response.Body, createWriteStream(`${target}.partial`));
      await rename(`${target}.partial`, target);
      manifest[object.Key] = { etag: object.ETag, size: object.Size, lastModified: object.LastModified?.toISOString() };
      downloaded += 1;
    }
    continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (continuationToken);
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`Images: ${listed} in bucket ${bucket}, ${downloaded} downloaded, ${Object.keys(manifest).length} kept locally.`);
}

function runNode(script, args, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(repositoryRoot, "scripts", script), ...args], {
      stdio: "inherit",
      env: { ...process.env, ...environment }
    });
    child.once("error", reject);
    child.once("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${script} failed (exit ${code}).`))));
  });
}

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

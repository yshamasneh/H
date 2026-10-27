// Fetching and decrypting one backup, shared by restore.mjs and restore-test.mjs. These run on
// the operator's machine (see docs/railway-setup.md), with a key that can read the bucket and the
// age identity file; neither is ever given to the Railway backup service.
import { createWriteStream } from "node:fs";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { ageDecrypt, backupS3Client, latestDumpKey, manifestKeyFor, requiredEnv, sha256File } from "./lib.mjs";

export function argumentValue(name, argv = process.argv) {
  const prefix = `--${name}=`;
  return argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
}

/** Downloads (or reuses local files), decrypts and checks one backup. Returns the plain paths. */
export async function fetchBackup(directory, argv = process.argv) {
  const identity = argumentValue("identity", argv) ?? requiredEnv("BACKUP_AGE_IDENTITY_FILE");
  let encryptedDump = argumentValue("file", argv);
  let encryptedManifest = encryptedDump ? manifestPathFor(encryptedDump) : undefined;
  let source = encryptedDump;

  if (!encryptedDump) {
    const s3 = backupS3Client();
    const bucket = requiredEnv("BACKUP_S3_BUCKET");
    const key = argumentValue("key", argv) ?? (await newestKey(s3, bucket, process.env.BACKUP_S3_PREFIX || "jovo"));
    if (!key) throw new Error("No backup found in the bucket.");
    source = `s3://${bucket}/${key}`;
    encryptedDump = path.join(directory, "backup.dump.age");
    encryptedManifest = path.join(directory, "backup.manifest.json.age");
    await download(s3, bucket, key, encryptedDump);
    await download(s3, bucket, manifestKeyFor(key), encryptedManifest);
  }

  const dumpPath = path.join(directory, "backup.dump");
  const manifestPath = path.join(directory, "manifest.json");
  await ageDecrypt(encryptedDump, dumpPath, identity);
  await ageDecrypt(encryptedManifest, manifestPath, identity);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const checksum = await sha256File(dumpPath);
  if (checksum !== manifest.dumpSha256) {
    await rm(dumpPath, { force: true });
    throw new Error("The decrypted dump does not match the checksum in its manifest.");
  }
  return { source, dumpPath, manifest };
}

async function newestKey(s3, bucket, prefix) {
  const keys = [];
  let token;
  do {
    const page = await s3.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: `${prefix.replace(/\/+$/, "")}/`, ContinuationToken: token }));
    for (const object of page.Contents ?? []) if (object.Key) keys.push(object.Key);
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return latestDumpKey(keys);
}

async function download(s3, bucket, key, target) {
  const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  await pipeline(response.Body, createWriteStream(target));
}

function manifestPathFor(dumpPath) {
  if (!dumpPath.endsWith(".dump.age")) throw new Error("--file must point at a .dump.age file next to its .manifest.json.age");
  return dumpPath.replace(/\.dump\.age$/, ".manifest.json.age");
}

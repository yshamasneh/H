// Restores one encrypted JOVO backup into a target database. Destructive for the target: it is
// refused unless --confirm-restore names the target database, and it only ever reads
// RESTORE_DATABASE_URL. Usage (docs/railway-setup.md):
//   node restore.mjs --identity=/keys/age.txt [--key=<object key> | --file=<.dump.age>] --confirm-restore=<db>
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { argumentValue, fetchBackup } from "./fetch-backup.mjs";
import { redact, requiredEnv, run } from "./lib.mjs";

const target = new URL(requiredEnv("RESTORE_DATABASE_URL"));
const targetDatabase = decodeURIComponent(target.pathname.replace(/^\//, ""));
if (argumentValue("confirm-restore") !== targetDatabase) {
  throw new Error(`Destructive restore blocked. Re-run with --confirm-restore=${targetDatabase} after checking the target.`);
}
const directory = await mkdtemp(path.join(tmpdir(), "jovo-restore-"));
try {
  const { source, dumpPath, manifest } = await fetchBackup(directory);
  console.log(`Restoring ${source} (taken ${manifest.createdAt}, ${manifest.totalRows} rows) into ${target.hostname}/${targetDatabase}.`);
  await run("pg_restore", ["--clean", "--if-exists", "--exit-on-error", "--no-owner", "--no-privileges", "--dbname", target.toString(), dumpPath]);
  console.log("Restore completed.");
} catch (error) {
  console.error(redact(error instanceof Error ? error.message : String(error)));
  process.exitCode = 1;
} finally {
  await rm(directory, { recursive: true, force: true });
}

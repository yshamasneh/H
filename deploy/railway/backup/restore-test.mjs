// Proves a backup can be restored: restores it into a scratch database and compares every table's
// row count with the counts recorded in the same snapshot as the dump (the manifest). Exits 1 on any
// difference. The scratch database is wiped first, so its name must contain "scratch" or
// "restore", and RESTORE_TEST_DATABASE_URL is the only URL it reads.
//   node restore-test.mjs --identity=/keys/age.txt [--key=<object key> | --file=<.dump.age>]
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import pg from "pg";
import { fetchBackup } from "./fetch-backup.mjs";
import { compareCounts, countRows, redact, requiredEnv, run } from "./lib.mjs";

const scratchUrl = new URL(requiredEnv("RESTORE_TEST_DATABASE_URL"));
const scratchDatabase = decodeURIComponent(scratchUrl.pathname.replace(/^\//, ""));
if (!/scratch|restore/i.test(scratchDatabase)) {
  throw new Error(`Refusing to use "${scratchDatabase}": the scratch database's name must contain "scratch" or "restore".`);
}

const directory = await mkdtemp(path.join(tmpdir(), "jovo-restore-test-"));
try {
  const { source, dumpPath, manifest } = await fetchBackup(directory);
  await resetScratchSchema(scratchUrl);
  await run("pg_restore", ["--exit-on-error", "--no-owner", "--no-privileges", "--dbname", scratchUrl.toString(), dumpPath]);
  const client = new pg.Client({ connectionString: scratchUrl.toString() });
  await client.connect();
  const restored = await countRows(client).finally(() => client.end());
  const differences = compareCounts(manifest.tables, restored);
  const tables = Object.keys(manifest.tables).length;
  if (differences.length > 0) {
    console.error(`Restore test FAILED for ${source}: ${differences.length} table(s) differ.`);
    for (const difference of differences) console.error(`  ${difference.table}: expected ${difference.expected}, restored ${difference.actual}`);
    process.exitCode = 1;
  } else {
    console.log(`Restore test passed for ${source} (taken ${manifest.createdAt}): ${tables} tables, ${manifest.totalRows} rows, every count matches.`);
  }
} catch (error) {
  console.error(`Restore test FAILED: ${redact(error instanceof Error ? error.message : String(error))}`);
  process.exitCode = 1;
} finally {
  await rm(directory, { recursive: true, force: true });
}

async function resetScratchSchema(url) {
  const client = new pg.Client({ connectionString: url.toString() });
  await client.connect();
  try {
    await client.query("drop schema if exists public cascade");
    await client.query("create schema public");
  } finally {
    await client.end();
  }
}

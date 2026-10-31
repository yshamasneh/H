/**
 * Catalogue importer CLI (run 3, task 3). Operator guide: docs/release-readiness/catalogue-import-guide.md
 *
 * Dry-run is the default; nothing is written without --apply. Refuses any database that is not
 * localhost unless --production and the matching --confirm token are both given.
 *
 *   npx tsx scripts/catalogue-import.ts --restaurant-id <uuid> --file catalogue.csv [--images images.csv]
 *       [--image-base-url https://cdn.example/products] [--report-dir ./import-reports] [--apply]
 *   npx tsx scripts/catalogue-import.ts --restaurant-id <uuid> --file catalogue.csv --print-confirmation-token
 *
 * Exit codes: 0 done (reports may still list skipped rows), 1 invalid arguments, 2 refused target or crash.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import path from "node:path";
import dotenv from "dotenv";
import {
  applyCatalogue,
  assertTargetAllowed,
  checkImageMapping,
  confirmationToken,
  parseCatalogue,
  readRecords,
  type ImageMapping,
  type ImportDatabase
} from "../src/catalogue/catalogue-import";

dotenv.config({ path: "../../.env" });

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}
const flag = (name: string) => process.argv.includes(name);

async function main(): Promise<number> {
  const file = argument("--file");
  const restaurantId = argument("--restaurant-id");
  if (!file || !restaurantId) {
    console.error("Usage: catalogue-import.ts --restaurant-id <uuid> --file <catalogue.csv|json> [--images <map.csv>] [--image-base-url <url>] [--report-dir <dir>] [--apply]");
    return 1;
  }
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is not set.");
    return 1;
  }
  const content = readFileSync(file);
  const fileSha256 = createHash("sha256").update(content).digest("hex");
  if (flag("--print-confirmation-token")) {
    // Computed offline: no database connection is made.
    console.log(confirmationToken(databaseUrl, restaurantId, fileSha256));
    return 0;
  }
  assertTargetAllowed({ databaseUrl, production: flag("--production"), confirm: argument("--confirm"), restaurantId, fileSha256 });

  const dryRun = !flag("--apply");
  const reportDir = argument("--report-dir") ?? `./catalogue-import-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  mkdirSync(reportDir, { recursive: true });
  const logFile = path.join(reportDir, "log.jsonl");
  const log = (entry: Record<string, unknown>) => appendFileSync(logFile, `${JSON.stringify(entry)}\n`);
  log({ at: new Date().toISOString(), event: "START", file, fileSha256, restaurantId, dryRun });

  const format = file.toLowerCase().endsWith(".json") ? "json" : "csv";
  const parsed = parseCatalogue(readRecords(content.toString("utf8"), format));
  writeFileSync(path.join(reportDir, "invalid-rows.json"), JSON.stringify(parsed.errors, null, 2));
  writeFileSync(path.join(reportDir, "restricted-not-imported.json"), JSON.stringify(parsed.restricted, null, 2));

  let images = new Map<string, ImageMapping>();
  const imagesFile = argument("--images");
  if (imagesFile) {
    const mappings = readRecords(readFileSync(imagesFile, "utf8"), "csv").map((record) => ({
      sourceId: String(record.sourceId ?? "").trim(),
      file: path.resolve(path.dirname(imagesFile), String(record.file ?? "").trim()),
      sha256: String(record.sha256 ?? "").trim()
    }));
    const checked = checkImageMapping(mappings, (target) => (existsSync(target) ? readFileSync(target) : null));
    images = checked.valid;
    writeFileSync(path.join(reportDir, "image-problems.json"), JSON.stringify(checked.problems, null, 2));
  }

  const { PrismaClient } = await import("../src/generated/prisma/client");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  try {
    const store = await prisma.restaurant.findUnique({ where: { id: restaurantId }, select: { id: true, name: true } });
    if (!store) {
      console.error("No store with that id.");
      return 1;
    }
    const report = await applyCatalogue(prisma as unknown as ImportDatabase, {
      restaurantId,
      rows: parsed.rows,
      images,
      imageBaseUrl: argument("--image-base-url") ?? null,
      dryRun,
      log
    });
    const conflicts = [...parsed.conflicts, ...report.outcomes.filter((outcome) => outcome.outcome.endsWith("_CONFLICT"))];
    writeFileSync(path.join(reportDir, "conflicts.json"), JSON.stringify(conflicts, null, 2));
    writeFileSync(path.join(reportDir, "outcomes.json"), JSON.stringify(report, null, 2));
    log({ at: new Date().toISOString(), event: "END", counts: report.counts });
    console.log(`${dryRun ? "DRY RUN (nothing written)" : "APPLIED"} for ${store.name}`);
    console.log(`Invalid rows: ${parsed.errors.length}. Restricted (not imported): ${parsed.restricted.length}. Duplicate barcodes in file: ${parsed.conflicts.length}.`);
    console.log(`Outcomes: ${JSON.stringify(report.counts)}. New categories: ${report.categoriesCreated.length}.`);
    console.log(`Reports and log: ${reportDir}`);
    return 0;
  } finally {
    await prisma.$disconnect();
  }
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error((error as Error).message);
    process.exit(2);
  }
);

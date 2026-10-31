/**
 * Restricted-product report for an exported catalogue (store audit H6). Offline and read-only: it
 * reads a CSV file and never connects to a database or changes any product.
 *
 * Usage (from apps/api):
 *   npx tsx scripts/restricted-catalogue-report.ts --file <catalogue-export.csv> [--out <report.csv>]
 *
 * The CSV needs a `name` column; `sku`, `category`, `brand` and `description` are used when present
 * (the import template's column names). Exit code 2 when any BLOCKED row is found, so it can gate a
 * release checklist; 0 otherwise (REVIEW rows are listed but do not fail).
 */
import { readFile, writeFile } from "node:fs/promises";
import { buildCatalogueReport, reportToCsv } from "../src/catalogue/restricted-catalogue-report";

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main(): Promise<void> {
  const file = argument("--file");
  if (!file) throw new Error("Usage: restricted-catalogue-report.ts --file <catalogue.csv> [--out <report.csv>]");
  const report = buildCatalogueReport(await readFile(file, "utf8"));

  console.log(`Screened ${report.totalRows} product row(s).`);
  console.log(`BLOCKED (tobacco/nicotine/vaping/alcohol): ${report.blocked.length}`);
  for (const row of report.blocked) console.log(`  line ${row.line} sku ${row.sku}: ${row.name} [${row.category}] — ${row.matches.join(", ")}`);
  console.log(`REVIEW (ambiguous, decide by hand): ${report.review.length}`);
  for (const row of report.review) console.log(`  line ${row.line} sku ${row.sku}: ${row.name} [${row.category}] — ${row.matches.join(", ")}`);

  const out = argument("--out");
  if (out) {
    await writeFile(out, reportToCsv(report), "utf8");
    console.log(`Report written to ${out}`);
  }
  if (report.blocked.length > 0) process.exitCode = 2;
}

main().catch((error: unknown) => {
  console.error((error as Error).message);
  process.exitCode = 1;
});

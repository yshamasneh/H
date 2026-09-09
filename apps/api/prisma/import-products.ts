/**
 * Bulk-imports a supermarket/restaurant catalogue from a CSV file, entirely through the same
 * validation rules the API itself enforces (cost price required, sku/barcode uniqueness, field
 * length/range limits) — see the "Validation" section below for the exact rules.
 *
 * Two-pass, fail-closed:
 *   1. Read the whole file and validate every row, against both the file itself (duplicate SKUs
 *      or barcodes within the file) and the current database state (barcode already used by a
 *      *different* product). Nothing is written in this pass.
 *   2. Only if every row is valid, import all of them inside one database transaction: any
 *      unexpected failure rolls the whole import back rather than leaving the catalogue half
 *      updated.
 *
 * Re-running the same file is safe and idempotent: a row whose `sku` already exists for this
 * business is updated in place; a new `sku` creates a new product. Nothing is ever deleted.
 *
 * Usage:
 *   npx tsx prisma/import-products.ts --restaurant-id <uuid> --file products.csv
 *   npx tsx prisma/import-products.ts --owner-phone +970590000004 --file products.csv
 *   npx tsx prisma/import-products.ts --owner-phone +970590000004 --file products.csv --dry-run
 *
 * Run from apps/api, or via the root convenience script: `npm run import:products -- <args>`.
 * See prisma/product-import-template.csv for the expected columns and a filled-in example.
 */
import { readFile } from "node:fs/promises";
import dotenv from "dotenv";
import { PrismaPg } from "@prisma/adapter-pg";
import { BusinessType, PrismaClient, type Prisma } from "../src/generated/prisma/client";

dotenv.config({ path: "../../.env" });

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to import products.");
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });

// Mirrors CreateMenuItemDto / UpdateMenuItemDto (apps/api/src/restaurants/restaurants.dto.ts) so
// a row that would be rejected by the API is rejected here too, before anything is written.
const LIMITS = {
  name: { min: 1, max: 120 },
  description: { max: 500 },
  priceMinor: { min: 0, max: 100_000_000 },
  costPriceMinor: { min: 0, max: 100_000_000 },
  sku: { max: 80 },
  brand: { max: 120 },
  unitLabel: { min: 1, max: 60 },
  stockQuantity: { min: 0, max: 10_000_000 },
  barcode: { max: 80 },
  reorderLevel: { min: 0, max: 10_000_000 }
} as const;

const REQUIRED_COLUMNS = ["sku", "name", "category", "price", "costPrice"] as const;
const KNOWN_COLUMNS = [
  ...REQUIRED_COLUMNS,
  "description",
  "brand",
  "unitLabel",
  "barcode",
  "stockQuantity",
  "isVariableWeight",
  "isFeatured",
  "reorderLevel"
] as const;

type ParsedRow = {
  line: number; // 1-based, counting the header as line 1
  sku: string;
  name: string;
  category: string;
  priceMinor: number;
  costPriceMinor: number;
  description: string | null;
  brand: string | null;
  unitLabel: string;
  barcode: string | null;
  stockQuantity: number | null;
  isVariableWeight: boolean;
  isFeatured: boolean;
  reorderLevel: number | null;
};

type RowError = { line: number; sku: string; errors: string[] };

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.file) {
    throw new Error("Usage: import-products.ts --restaurant-id <uuid> | --owner-phone <phone> --file <path.csv> [--dry-run]");
  }

  const restaurant = await resolveRestaurant(args);
  console.log(`Importing into: ${restaurant.name} (${restaurant.businessType}, ${restaurant.id})`);

  const raw = await readFile(args.file, "utf8");
  const table = parseCsv(raw);
  if (table.length === 0) {
    throw new Error("The CSV file is empty.");
  }

  const header = table[0]!.map((cell) => cell.trim());
  assertHeader(header);

  const dataLines = table.slice(1);
  const { rows, errors } = validateRows(header, dataLines);

  // Cross-check against the database (barcode collisions with a different, existing product) —
  // still read-only, still before any write.
  errors.push(...(await validateAgainstDatabase(restaurant.id, rows)));

  if (errors.length > 0) {
    printErrors(errors);
    throw new Error(
      `Import aborted: ${errors.length} row(s) failed validation. Nothing was written. Fix the file and re-run.`
    );
  }

  console.log(`Validated ${rows.length} row(s), 0 errors.`);
  if (args.dryRun) {
    console.log("Dry run: no changes were made.");
    return;
  }

  const summary = await importRows(restaurant.id, rows);
  console.log(
    `Imported ${rows.length} product(s): ${summary.created} created, ${summary.updated} updated, ` +
      `${summary.categoriesCreated} new categor${summary.categoriesCreated === 1 ? "y" : "ies"} created.`
  );
}

async function resolveRestaurant(
  args: ReturnType<typeof parseArgs>
): Promise<{ id: string; name: string; businessType: BusinessType }> {
  if (args.restaurantId) {
    const restaurant = await prisma.restaurant.findUnique({
      where: { id: args.restaurantId },
      select: { id: true, name: true, businessType: true }
    });
    if (!restaurant) throw new Error(`No business found with id ${args.restaurantId}.`);
    return restaurant;
  }
  if (args.ownerPhone) {
    const owner = await prisma.user.findUnique({
      where: { phone: args.ownerPhone },
      select: { restaurant: { select: { id: true, name: true, businessType: true } } }
    });
    if (!owner?.restaurant) throw new Error(`No business owned by ${args.ownerPhone}.`);
    return owner.restaurant;
  }
  throw new Error("Provide either --restaurant-id <uuid> or --owner-phone <phone>.");
}

function assertHeader(header: string[]): void {
  const missing = REQUIRED_COLUMNS.filter((column) => !header.includes(column));
  if (missing.length > 0) {
    throw new Error(`The CSV is missing required column(s): ${missing.join(", ")}.`);
  }
  const unknown = header.filter((column) => !(KNOWN_COLUMNS as readonly string[]).includes(column));
  if (unknown.length > 0) {
    throw new Error(`The CSV has unrecognised column(s): ${unknown.join(", ")}. Known columns: ${KNOWN_COLUMNS.join(", ")}.`);
  }
}

/** Pass 1: structural + in-file validation. Read-only — no database access. */
function validateRows(header: string[], dataLines: string[][]): { rows: ParsedRow[]; errors: RowError[] } {
  const rows: ParsedRow[] = [];
  const errors: RowError[] = [];
  const seenSkus = new Map<string, number>(); // sku -> first line seen
  const seenBarcodes = new Map<string, number>();

  dataLines.forEach((cells, index) => {
    const line = index + 2; // header is line 1
    if (cells.length === 1 && cells[0]?.trim() === "") return; // skip trailing blank lines

    const get = (column: string): string => {
      const columnIndex = header.indexOf(column);
      return columnIndex === -1 ? "" : (cells[columnIndex] ?? "").trim();
    };

    const rowErrors: string[] = [];
    const sku = get("sku");
    if (!sku) rowErrors.push("sku is required");
    else if (sku.length > LIMITS.sku.max) rowErrors.push(`sku exceeds ${LIMITS.sku.max} characters`);

    const name = get("name");
    if (!name) rowErrors.push("name is required");
    else if (name.length > LIMITS.name.max) rowErrors.push(`name exceeds ${LIMITS.name.max} characters`);

    const category = get("category");
    if (!category) rowErrors.push("category is required");

    const priceMinor = parseMoney(get("price"), "price", rowErrors);
    const costPriceMinor = parseMoney(get("costPrice"), "costPrice", rowErrors);
    if (costPriceMinor !== null && priceMinor !== null && costPriceMinor > priceMinor) {
      rowErrors.push("costPrice is greater than price — check for a units mistake");
    }

    const description = get("description") || null;
    if (description && description.length > LIMITS.description.max) {
      rowErrors.push(`description exceeds ${LIMITS.description.max} characters`);
    }
    const brand = get("brand") || null;
    if (brand && brand.length > LIMITS.brand.max) rowErrors.push(`brand exceeds ${LIMITS.brand.max} characters`);
    const unitLabel = get("unitLabel") || "item";
    if (unitLabel.length > LIMITS.unitLabel.max) rowErrors.push(`unitLabel exceeds ${LIMITS.unitLabel.max} characters`);
    const barcode = get("barcode") || null;
    if (barcode && barcode.length > LIMITS.barcode.max) rowErrors.push(`barcode exceeds ${LIMITS.barcode.max} characters`);

    const stockQuantity = parseOptionalInt(get("stockQuantity"), "stockQuantity", LIMITS.stockQuantity, rowErrors);
    const reorderLevel = parseOptionalInt(get("reorderLevel"), "reorderLevel", LIMITS.reorderLevel, rowErrors);
    const isVariableWeight = parseBoolean(get("isVariableWeight"), "isVariableWeight", rowErrors);
    const isFeatured = parseBoolean(get("isFeatured"), "isFeatured", rowErrors);

    if (sku) {
      const firstLine = seenSkus.get(sku);
      if (firstLine) rowErrors.push(`duplicate sku, already used on line ${firstLine}`);
      else seenSkus.set(sku, line);
    }
    if (barcode) {
      const firstLine = seenBarcodes.get(barcode);
      if (firstLine) rowErrors.push(`duplicate barcode, already used on line ${firstLine}`);
      else seenBarcodes.set(barcode, line);
    }

    if (rowErrors.length > 0) {
      errors.push({ line, sku: sku || "(missing)", errors: rowErrors });
      return;
    }

    rows.push({
      line,
      sku,
      name,
      category,
      priceMinor: priceMinor!,
      costPriceMinor: costPriceMinor!,
      description,
      brand,
      unitLabel,
      barcode,
      stockQuantity,
      isVariableWeight,
      isFeatured,
      reorderLevel
    });
  });

  return { rows, errors };
}

/** Pass 1b: the one check that needs the database — a barcode already claimed by a different product. */
async function validateAgainstDatabase(restaurantId: string, rows: ParsedRow[]): Promise<RowError[]> {
  const barcodes = rows.map((row) => row.barcode).filter((barcode): barcode is string => Boolean(barcode));
  if (barcodes.length === 0) return [];

  const existing = await prisma.menuItem.findMany({
    where: { restaurantId, barcode: { in: barcodes } },
    select: { sku: true, barcode: true }
  });
  const barcodeOwner = new Map(existing.map((item) => [item.barcode, item.sku]));

  const errors: RowError[] = [];
  for (const row of rows) {
    if (!row.barcode) continue;
    const owner = barcodeOwner.get(row.barcode);
    if (owner && owner !== row.sku) {
      errors.push({
        line: row.line,
        sku: row.sku,
        errors: [`barcode ${row.barcode} is already used by a different product (sku ${owner}) in this store`]
      });
    }
  }
  return errors;
}

/** Pass 2: everything or nothing, in one transaction. */
async function importRows(
  restaurantId: string,
  rows: ParsedRow[]
): Promise<{ created: number; updated: number; categoriesCreated: number }> {
  return prisma.$transaction(
    async (tx) => {
      const { categoryIds, createdCount: categoriesCreated } = await ensureCategories(tx, restaurantId, rows);
      let created = 0;
      let updated = 0;

      for (const row of rows) {
        const categoryId = categoryIds.get(row.category.toLowerCase().trim())!;
        const result = await tx.menuItem.upsert({
          where: { restaurantId_sku: { restaurantId, sku: row.sku } },
          create: {
            restaurantId,
            categoryId,
            name: row.name,
            description: row.description,
            priceMinor: row.priceMinor,
            costPriceMinor: row.costPriceMinor,
            sku: row.sku,
            brand: row.brand,
            unitLabel: row.unitLabel,
            barcode: row.barcode,
            stockQuantity: row.stockQuantity,
            isVariableWeight: row.isVariableWeight,
            isFeatured: row.isFeatured,
            reorderLevel: row.reorderLevel,
            isAvailable: true
          },
          update: {
            categoryId,
            name: row.name,
            description: row.description,
            priceMinor: row.priceMinor,
            costPriceMinor: row.costPriceMinor,
            brand: row.brand,
            unitLabel: row.unitLabel,
            barcode: row.barcode,
            stockQuantity: row.stockQuantity,
            isVariableWeight: row.isVariableWeight,
            isFeatured: row.isFeatured,
            reorderLevel: row.reorderLevel
          },
          select: { createdAt: true, updatedAt: true }
        });
        // A fresh upsert has createdAt === updatedAt (to the millisecond, from the same INSERT);
        // an update always moves updatedAt later.
        if (result.createdAt.getTime() === result.updatedAt.getTime()) created += 1;
        else updated += 1;
      }

      return { created, updated, categoriesCreated };
    },
    { timeout: 120_000 }
  );
}

async function ensureCategories(
  tx: Prisma.TransactionClient,
  restaurantId: string,
  rows: ParsedRow[]
): Promise<{ categoryIds: Map<string, string>; createdCount: number }> {
  const existing = await tx.menuCategory.findMany({ where: { restaurantId }, select: { id: true, name: true, sortOrder: true } });
  const categoryIds = new Map(existing.map((category) => [category.name.toLowerCase().trim(), category.id]));
  let nextSortOrder = existing.reduce((max, category) => Math.max(max, category.sortOrder), -1) + 1;

  const wantedNames = new Set(rows.map((row) => row.category.toLowerCase().trim()));
  let createdCount = 0;
  for (const lowerName of wantedNames) {
    if (categoryIds.has(lowerName)) continue;
    const original = rows.find((row) => row.category.toLowerCase().trim() === lowerName)!.category.trim();
    const created = await tx.menuCategory.create({
      data: { restaurantId, name: original, sortOrder: nextSortOrder, isActive: true }
    });
    nextSortOrder += 1;
    createdCount += 1;
    categoryIds.set(lowerName, created.id);
  }

  return { categoryIds, createdCount };
}

function parseMoney(value: string, field: string, errors: string[]): number | null {
  if (!value) {
    errors.push(`${field} is required`);
    return null;
  }
  if (!/^\d+(\.\d{1,2})?$/.test(value)) {
    errors.push(`${field} must be a plain decimal number with up to 2 decimal places, e.g. 12.50 (got "${value}")`);
    return null;
  }
  const minor = Math.round(Number(value) * 100);
  if (minor < LIMITS.priceMinor.min || minor > LIMITS.priceMinor.max) {
    errors.push(`${field} is out of range`);
    return null;
  }
  return minor;
}

function parseOptionalInt(
  value: string,
  field: string,
  limits: { min: number; max: number },
  errors: string[]
): number | null {
  if (!value) return null;
  if (!/^\d+$/.test(value)) {
    errors.push(`${field} must be a whole number (got "${value}")`);
    return null;
  }
  const parsed = Number(value);
  if (parsed < limits.min || parsed > limits.max) {
    errors.push(`${field} is out of range`);
    return null;
  }
  return parsed;
}

function parseBoolean(value: string, field: string, errors: string[]): boolean {
  if (!value) return false;
  const normalized = value.toLowerCase();
  if (["true", "1", "yes"].includes(normalized)) return true;
  if (["false", "0", "no"].includes(normalized)) return false;
  errors.push(`${field} must be true/false (got "${value}")`);
  return false;
}

function printErrors(errors: RowError[]): void {
  console.error(`\n${errors.length} row(s) failed validation:\n`);
  for (const error of errors) {
    console.error(`  line ${error.line} (sku ${error.sku}): ${error.errors.join("; ")}`);
  }
  console.error("");
}

/** A tiny RFC4180 CSV parser: quoted fields, "" escapes a literal quote, commas/newlines inside quotes. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const source = text.replace(/\r\n/g, "\n").replace(/﻿/, ""); // strip BOM if present

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i]!;
    if (inQuotes) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((cells) => !(cells.length === 1 && cells[0] === ""));
}

function parseArgs(argv: string[]): {
  restaurantId?: string;
  ownerPhone?: string;
  file?: string;
  dryRun: boolean;
} {
  const result: { restaurantId?: string; ownerPhone?: string; file?: string; dryRun: boolean } = { dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = argv[i + 1];
    if (arg === "--restaurant-id" && next) {
      result.restaurantId = next;
      i += 1;
    } else if (arg === "--owner-phone" && next) {
      result.ownerPhone = next;
      i += 1;
    } else if (arg === "--file" && next) {
      result.file = next;
      i += 1;
    } else if (arg === "--dry-run") {
      result.dryRun = true;
    }
  }
  return result;
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    await prisma.$disconnect();
    process.exitCode = 1;
  });

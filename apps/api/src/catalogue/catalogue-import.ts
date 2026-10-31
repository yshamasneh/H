import { createHash } from "node:crypto";
import { classifyRestricted } from "./restricted-products.rules";
import { parseCsv } from "./restricted-catalogue-report";

/**
 * Run 3, task 3: the reusable catalogue importer (pure part). The CLI is
 * `apps/api/scripts/catalogue-import.ts`; the operator guide is
 * `docs/release-readiness/catalogue-import-guide.md`.
 *
 * Rules:
 * - Every product carries a stable `sourceId` (the supplier's or our own id), used to find it again.
 * - Barcodes, SKUs and source ids are kept as strings exactly as written (leading zeros kept).
 * - Prices are parsed as exact decimals ("12.5" → 1250 agorot); anything with more than two
 *   decimals, a sign, or an exponent is refused instead of being rounded.
 * - Tobacco, nicotine, vaping and alcohol rows are never imported; they go to the restricted report.
 * - Two rows with the same barcode, or a barcode already used by a different product in the
 *   store, go to the conflict report; nothing is overwritten.
 * - New products are created PENDING_REVIEW and stay hidden until an administrator approves them.
 * - A product edited by hand since the last import (its importable fields no longer hash to the
 *   stored importChecksum) is never overwritten; it is reported as MANUALLY_EDITED.
 */
export type ImportRow = {
  line: number;
  sourceId: string;
  name: string;
  category: string;
  priceMinor: number;
  costPriceMinor: number | null;
  barcode: string | null;
  sku: string | null;
  brand: string | null;
  description: string | null;
  unitLabel: string;
};

export type RowError = { line: number; sourceId: string; errors: string[] };
export type RestrictedRow = { line: number; sourceId: string; name: string; matches: string[] };
export type Conflict = { line: number; sourceId: string; barcode: string; reason: "DUPLICATE_IN_FILE" | "BARCODE_USED_BY_OTHER_PRODUCT"; otherSourceId?: string | null; otherProductId?: string };

export type ParseResult = { rows: ImportRow[]; errors: RowError[]; restricted: RestrictedRow[]; conflicts: Conflict[] };

const maxName = 200;
const maxText = 2000;

export function parseExactMinor(raw: string): number | null {
  const value = raw.trim();
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

function text(value: unknown): string {
  if (value === null || value === undefined) return "";
  // JSON numbers are refused for identifiers by validateRecord; here everything is read as a string.
  return String(value).trim();
}

/** Reads CSV (header row) or JSON (an array of objects) into plain string records. */
export function readRecords(content: string, format: "csv" | "json"): Array<Record<string, unknown>> {
  if (format === "json") {
    const parsed: unknown = JSON.parse(content);
    if (!Array.isArray(parsed)) throw new Error("A JSON catalogue must be an array of product objects.");
    return parsed as Array<Record<string, unknown>>;
  }
  const table = parseCsv(content.replace(/^﻿/, ""));
  const [header, ...body] = table;
  if (!header) return [];
  const keys = header.map((key) => key.trim());
  return body
    .filter((cells) => cells.some((cell) => cell.trim() !== ""))
    .map((cells) => Object.fromEntries(keys.map((key, index) => [key, cells[index] ?? ""])));
}

export function parseCatalogue(records: Array<Record<string, unknown>>, firstLine = 2): ParseResult {
  const result: ParseResult = { rows: [], errors: [], restricted: [], conflicts: [] };
  const seenSource = new Map<string, number>();
  const seenBarcode = new Map<string, { line: number; sourceId: string }>();
  records.forEach((record, index) => {
    const line = firstLine + index;
    const errors: string[] = [];
    // Identifiers must arrive as strings: a JSON number would already have lost leading zeros.
    for (const key of ["sourceId", "barcode", "sku"]) {
      if (typeof record[key] === "number") errors.push(`${key} must be a string (quote it) so leading zeros are kept`);
    }
    const sourceId = text(record.sourceId);
    const name = text(record.name);
    const category = text(record.category);
    const barcode = text(record.barcode) || null;
    const sku = text(record.sku) || null;
    const priceRaw = text(record.price);
    const costRaw = text(record.costPrice);
    if (!sourceId) errors.push("sourceId is required");
    else if (seenSource.has(sourceId)) errors.push(`duplicate sourceId, first on line ${seenSource.get(sourceId)}`);
    if (!name) errors.push("name is required");
    if (name.length > maxName) errors.push(`name is longer than ${maxName} characters`);
    if (!category) errors.push("category is required");
    const priceMinor = parseExactMinor(priceRaw);
    if (priceMinor === null || priceMinor <= 0) errors.push(`price "${priceRaw}" is not an exact positive amount with at most 2 decimals`);
    const costPriceMinor = costRaw ? parseExactMinor(costRaw) : null;
    if (costRaw && costPriceMinor === null) errors.push(`costPrice "${costRaw}" is not an exact amount with at most 2 decimals`);
    if (barcode && !/^[0-9A-Za-z-]{4,64}$/.test(barcode)) errors.push(`barcode "${barcode}" has unexpected characters`);
    const description = text(record.description) || null;
    if (description && description.length > maxText) errors.push(`description is longer than ${maxText} characters`);
    if (sourceId) seenSource.set(sourceId, line);
    if (errors.length > 0) {
      result.errors.push({ line, sourceId: sourceId || "(missing)", errors });
      return;
    }
    const brand = text(record.brand) || null;
    const screening = classifyRestricted(name, brand, description, category);
    if (screening.verdict === "BLOCKED") {
      result.restricted.push({ line, sourceId, name, matches: screening.matches });
      return;
    }
    if (barcode) {
      const first = seenBarcode.get(barcode);
      if (first) {
        result.conflicts.push({ line, sourceId, barcode, reason: "DUPLICATE_IN_FILE", otherSourceId: first.sourceId });
        return;
      }
      seenBarcode.set(barcode, { line, sourceId });
    }
    result.rows.push({
      line,
      sourceId,
      name,
      category,
      priceMinor: priceMinor!,
      costPriceMinor,
      barcode,
      sku,
      brand,
      description,
      unitLabel: text(record.unitLabel) || "item"
    });
  });
  return result;
}

/** The fields the importer owns, hashed so a later hand edit can be recognised. */
export function importChecksum(fields: {
  name: string;
  categoryId: string;
  priceMinor: number;
  costPriceMinor: number | null;
  barcode: string | null;
  sku: string | null;
  brand: string | null;
  description: string | null;
  unitLabel: string;
  imageUrl: string | null;
}): string {
  const canonical = JSON.stringify([
    fields.name, fields.categoryId, fields.priceMinor, fields.costPriceMinor, fields.barcode, fields.sku,
    fields.brand, fields.description, fields.unitLabel, fields.imageUrl
  ]);
  return createHash("sha256").update(canonical).digest("hex");
}

export type ImageMapping = { sourceId: string; file: string; sha256: string };
export type ImageCheck = { sourceId: string; file: string; ok: boolean; reason?: string };

/** Image-mapping CSV: sourceId,file,sha256. The hash must match the file's bytes exactly. */
export function checkImageMapping(
  mappings: ImageMapping[],
  readBytes: (file: string) => Buffer | null
): { valid: Map<string, ImageMapping>; problems: ImageCheck[] } {
  const valid = new Map<string, ImageMapping>();
  const problems: ImageCheck[] = [];
  for (const mapping of mappings) {
    const bytes = readBytes(mapping.file);
    if (!bytes) {
      problems.push({ sourceId: mapping.sourceId, file: mapping.file, ok: false, reason: "file not found" });
      continue;
    }
    const actual = createHash("sha256").update(bytes).digest("hex");
    if (actual !== mapping.sha256.trim().toLowerCase()) {
      problems.push({ sourceId: mapping.sourceId, file: mapping.file, ok: false, reason: `sha256 mismatch (file is ${actual})` });
      continue;
    }
    valid.set(mapping.sourceId, mapping);
  }
  return { valid, problems };
}

/** Only these database hosts are accepted without the production flag and confirmation token. */
export function isLocalDatabaseUrl(databaseUrl: string): boolean {
  try {
    const host = new URL(databaseUrl).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  } catch {
    return false;
  }
}

/**
 * The confirmation token for a production run. It binds the exact target (host and database), the
 * store and the exact input file, so a token printed for one file cannot be reused for another.
 * It is not a secret: it proves intent, not identity.
 */
export function confirmationToken(databaseUrl: string, restaurantId: string, fileSha256: string): string {
  const url = new URL(databaseUrl);
  const digest = createHash("sha256").update([url.hostname, url.pathname, restaurantId, fileSha256].join("|")).digest("hex");
  return `IMPORT-${digest.slice(0, 12).toUpperCase()}`;
}

export function assertTargetAllowed(input: { databaseUrl: string; production: boolean; confirm?: string; restaurantId: string; fileSha256: string }): void {
  if (isLocalDatabaseUrl(input.databaseUrl)) return;
  if (!input.production) {
    throw new Error("Refusing to run against a non-local database. Pass --production and --confirm <token> for an approved production run.");
  }
  const expected = confirmationToken(input.databaseUrl, input.restaurantId, input.fileSha256);
  if (input.confirm !== expected) {
    throw new Error("The --confirm token does not match this database, store and file. Print it with --print-confirmation-token.");
  }
}

export type RowOutcome =
  | "CREATED"
  | "UPDATED"
  | "UNCHANGED"
  | "MANUALLY_EDITED"
  | "BARCODE_CONFLICT"
  | "SKU_CONFLICT"
  | "FAILED";

export type ApplyReport = {
  dryRun: boolean;
  outcomes: Array<{ line: number; sourceId: string; outcome: RowOutcome; productId?: string; detail?: string }>;
  categoriesCreated: string[];
  counts: Record<RowOutcome, number>;
};

/** The subset of the Prisma client the importer uses (a PrismaService works). */
export type ImportDatabase = {
  menuCategory: {
    findMany(args: unknown): Promise<Array<{ id: string; name: string; sortOrder: number }>>;
    create(args: unknown): Promise<{ id: string; name: string; sortOrder: number }>;
  };
  menuItem: {
    findUnique(args: unknown): Promise<ImportedItem | null>;
    findFirst(args: unknown): Promise<{ id: string; importSourceId: string | null } | null>;
    create(args: unknown): Promise<{ id: string }>;
    update(args: unknown): Promise<{ id: string }>;
  };
  $transaction<T>(fn: (tx: ImportDatabase) => Promise<T>): Promise<T>;
};

type ImportedItem = {
  id: string;
  name: string;
  categoryId: string;
  priceMinor: number;
  costPriceMinor: number | null;
  barcode: string | null;
  sku: string | null;
  brand: string | null;
  description: string | null;
  unitLabel: string;
  imageUrl: string | null;
  importChecksum: string | null;
};

export async function applyCatalogue(
  db: ImportDatabase,
  input: {
    restaurantId: string;
    rows: ImportRow[];
    images?: Map<string, ImageMapping>;
    imageBaseUrl?: string | null;
    dryRun: boolean;
    log?: (entry: Record<string, unknown>) => void;
    /** Test seam: throw after this many rows were written, to prove a retry is safe. */
    failAfterWrites?: number;
  }
): Promise<ApplyReport> {
  const log = input.log ?? (() => undefined);
  const report: ApplyReport = {
    dryRun: input.dryRun,
    outcomes: [],
    categoriesCreated: [],
    counts: { CREATED: 0, UPDATED: 0, UNCHANGED: 0, MANUALLY_EDITED: 0, BARCODE_CONFLICT: 0, SKU_CONFLICT: 0, FAILED: 0 }
  };
  const categories = await db.menuCategory.findMany({ where: { restaurantId: input.restaurantId }, select: { id: true, name: true, sortOrder: true } });
  const categoryByName = new Map(categories.map((category) => [category.name.trim().toLowerCase(), category.id]));
  let nextSort = categories.reduce((max, category) => Math.max(max, category.sortOrder), -1) + 1;
  let writes = 0;

  const record = (row: ImportRow, outcome: RowOutcome, productId?: string, detail?: string) => {
    report.outcomes.push({ line: row.line, sourceId: row.sourceId, outcome, productId, detail });
    report.counts[outcome] += 1;
    log({ at: new Date().toISOString(), line: row.line, sourceId: row.sourceId, outcome, productId, detail, dryRun: input.dryRun });
  };

  for (const row of input.rows) {
    try {
      let categoryId = categoryByName.get(row.category.toLowerCase());
      if (!categoryId) {
        if (input.dryRun) {
          categoryId = `(new:${row.category})`;
        } else {
          const created = await db.menuCategory.create({ data: { restaurantId: input.restaurantId, name: row.category, sortOrder: nextSort, isActive: true } });
          categoryId = created.id;
          nextSort += 1;
        }
        categoryByName.set(row.category.toLowerCase(), categoryId);
        report.categoriesCreated.push(row.category);
        log({ at: new Date().toISOString(), category: row.category, outcome: "CATEGORY_CREATED", dryRun: input.dryRun });
      }
      const existing = await db.menuItem.findUnique({ where: { restaurantId_importSourceId: { restaurantId: input.restaurantId, importSourceId: row.sourceId } } });
      if (row.barcode) {
        const other = await db.menuItem.findFirst({ where: { restaurantId: input.restaurantId, barcode: row.barcode, ...(existing ? { NOT: { id: existing.id } } : {}) }, select: { id: true, importSourceId: true } });
        if (other) {
          record(row, "BARCODE_CONFLICT", existing?.id, `barcode ${row.barcode} already belongs to product ${other.id}${other.importSourceId ? ` (sourceId ${other.importSourceId})` : ""}`);
          continue;
        }
      }
      if (row.sku) {
        const other = await db.menuItem.findFirst({ where: { restaurantId: input.restaurantId, sku: row.sku, ...(existing ? { NOT: { id: existing.id } } : {}) }, select: { id: true, importSourceId: true } });
        if (other) {
          record(row, "SKU_CONFLICT", existing?.id, `sku ${row.sku} already belongs to product ${other.id}`);
          continue;
        }
      }
      const image = input.images?.get(row.sourceId);
      const imageUrl = image && input.imageBaseUrl ? `${input.imageBaseUrl.replace(/\/+$/, "")}/${image.file.split(/[\\/]/).pop()}` : existing?.imageUrl ?? null;
      const fields = {
        name: row.name,
        categoryId,
        priceMinor: row.priceMinor,
        costPriceMinor: row.costPriceMinor,
        barcode: row.barcode,
        sku: row.sku,
        brand: row.brand,
        description: row.description,
        unitLabel: row.unitLabel,
        imageUrl
      };
      const checksum = importChecksum(fields);
      if (existing) {
        if (existing.importChecksum && importChecksum(existing) !== existing.importChecksum) {
          record(row, "MANUALLY_EDITED", existing.id, "edited by hand since the last import; left unchanged");
          continue;
        }
        if (existing.importChecksum === checksum) {
          record(row, "UNCHANGED", existing.id);
          continue;
        }
        if (!input.dryRun) {
          await db.$transaction((tx) => tx.menuItem.update({ where: { id: existing.id }, data: { ...fields, importChecksum: checksum } }));
          writes += 1;
        }
        record(row, "UPDATED", existing.id);
      } else {
        let productId: string | undefined;
        if (!input.dryRun) {
          const created = await db.$transaction((tx) =>
            tx.menuItem.create({
              data: { ...fields, restaurantId: input.restaurantId, importSourceId: row.sourceId, importChecksum: checksum, reviewStatus: "PENDING_REVIEW", isAvailable: true }
            })
          );
          productId = created.id;
          writes += 1;
        }
        record(row, "CREATED", productId);
      }
      if (input.failAfterWrites !== undefined && writes >= input.failAfterWrites) {
        throw new Error("Simulated failure after a partial import (test seam).");
      }
    } catch (error) {
      if ((error as Error).message.startsWith("Simulated failure")) throw error;
      record(row, "FAILED", undefined, (error as Error).message);
    }
  }
  return report;
}

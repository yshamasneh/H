/**
 * Validates and imports product images through the public API and its short-lived Blob SAS flow.
 *
 * Safety properties:
 * - dry-run validates the complete mapping, every local file, the authenticated store, and every
 *   SKU before requesting a SAS URL or writing anything;
 * - credentials are accepted only through IMAGE_IMPORT_ACCESS_TOKEN and are never logged;
 * - an image is published before its product is updated, and is deleted again if the update fails;
 * - existing external URLs are never deleted;
 * - an existing healthy managed image is skipped, making interrupted runs safely resumable.
 *
 * Usage from the repository root:
 *   npm run import:product-images -- --api-url https://example/api/v1 \
 *     --restaurant-id <uuid> --storage-account <account> \
 *     --mapping products/products_image_mapping.csv \
 *     --expected-count 130 --dry-run
 *
 * Remove --dry-run only after the reported counts are exact. Set IMAGE_IMPORT_ACCESS_TOKEN in the
 * process environment; never pass a token on the command line.
 */
import { readFile, stat } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";

const allowedHeaders = ["sku", "image_path", "product_name", "category"] as const;
const maxBytes = 5 * 1024 * 1024;

type MappingRow = {
  line: number;
  sku: string;
  imagePath: string;
  absoluteImagePath: string;
  contentType: "image/jpeg" | "image/png" | "image/webp";
  size: number;
};

type MenuItem = {
  id: string;
  sku: string | null;
  imageUrl: string | null;
};

type UploadTicket = {
  uploadId: string;
  uploadUrl: string;
  headers: Record<string, string>;
};

type CompletedUpload = { imageUrl: string };

type Args = {
  apiUrl: string;
  restaurantId: string;
  storageAccount: string;
  mapping: string;
  expectedCount: number | null;
  dryRun: boolean;
};

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const token = process.env.IMAGE_IMPORT_ACCESS_TOKEN?.trim();
  if (!token) throw new Error("IMAGE_IMPORT_ACCESS_TOKEN is required and must be supplied through the environment.");

  const apiUrl = normalizeApiUrl(args.apiUrl);
  const mappingPath = resolve(args.mapping);
  const rows = await validateMapping(mappingPath, args.expectedCount);
  const authorization = { Authorization: `Bearer ${token}` };

  const profile = await apiJson<{ id: string; name: string }>(`${apiUrl}/restaurant/me`, {
    headers: authorization
  });
  if (profile.id !== args.restaurantId) {
    throw new Error(`Authenticated store ${profile.id} does not match requested store ${args.restaurantId}.`);
  }

  const menuItems = await apiJson<MenuItem[]>(`${apiUrl}/restaurant/me/menu/items`, {
    headers: authorization
  });
  const itemBySku = indexProducts(menuItems);
  const missingSkus = rows.map((row) => row.sku).filter((sku) => !itemBySku.has(sku));
  const mappedSkus = new Set(rows.map((row) => row.sku));
  const unmappedProducts = menuItems.filter((item) => item.sku && !mappedSkus.has(item.sku));
  if (missingSkus.length > 0 || unmappedProducts.length > 0 || menuItems.length !== rows.length) {
    throw new Error(
      `SKU reconciliation failed: ${missingSkus.length} mapping SKU(s) missing in the API, ` +
        `${unmappedProducts.length} API product(s) missing in the mapping, ` +
        `${rows.length} mapping row(s), ${menuItems.length} API product(s). No image was uploaded.`
    );
  }

  const alreadyManaged = rows.filter((row) =>
    isManagedImage(itemBySku.get(row.sku)!.imageUrl, args.restaurantId, args.storageAccount)
  );
  const toUpload = rows.length - alreadyManaged.length;
  console.log(
    JSON.stringify({
      mode: args.dryRun ? "dry-run" : "import",
      restaurantId: profile.id,
      restaurantName: profile.name,
      mappingRows: rows.length,
      uniqueSkus: new Set(rows.map((row) => row.sku)).size,
      uniqueImages: new Set(rows.map((row) => row.absoluteImagePath.toLowerCase())).size,
      filesValidated: rows.length,
      apiProducts: menuItems.length,
      matchedSkus: rows.length,
      missingSkus: 0,
      duplicateSkus: 0,
      duplicateImages: 0,
      alreadyManaged: alreadyManaged.length,
      productsToUpload: toUpload,
      errors: 0
    })
  );

  if (args.dryRun) {
    console.log("Dry run complete: no SAS URL was requested, no image was uploaded, and no product was updated.");
    return;
  }

  let uploaded = 0;
  let updated = 0;
  let skipped = 0;
  for (const [index, row] of rows.entries()) {
    const item = itemBySku.get(row.sku)!;
    if (
      isManagedImage(item.imageUrl, args.restaurantId, args.storageAccount) &&
      (await publicImageWorks(item.imageUrl!))
    ) {
      skipped += 1;
      console.log(`[${index + 1}/${rows.length}] ${row.sku}: skipped healthy managed image.`);
      continue;
    }

    const ticket = await apiJson<UploadTicket>(`${apiUrl}/uploads/image-upload-url`, {
      method: "POST",
      headers: { ...authorization, "content-type": "application/json" },
      body: JSON.stringify({
        purpose: "PRODUCT",
        restaurantId: args.restaurantId,
        contentType: row.contentType,
        size: row.size
      })
    });
    const bytes = await readFile(row.absoluteImagePath);
    const put = await fetch(ticket.uploadUrl, {
      method: "PUT",
      // Use the exact signed upload headers returned by the API. Adding a differently-cased
      // Content-Type key can make fetch coalesce two values, which Blob Storage then persists as
      // an invalid content type and the completion endpoint correctly rejects.
      headers: ticket.headers,
      body: bytes
    });
    if (!put.ok) throw new Error(`Blob upload failed for SKU ${row.sku} with HTTP ${put.status}.`);

    const completed = await apiJson<CompletedUpload>(`${apiUrl}/uploads/complete`, {
      method: "POST",
      headers: { ...authorization, "content-type": "application/json" },
      body: JSON.stringify({
        uploadId: ticket.uploadId,
        purpose: "PRODUCT",
        restaurantId: args.restaurantId,
        contentType: row.contentType
      })
    });
    uploaded += 1;

    try {
      await apiJson(`${apiUrl}/restaurant/me/menu/items/${item.id}`, {
        method: "PATCH",
        headers: { ...authorization, "content-type": "application/json" },
        body: JSON.stringify({ imageUrl: completed.imageUrl })
      });
      updated += 1;
    } catch (error) {
      await deleteManagedImage(apiUrl, authorization, args.restaurantId, completed.imageUrl).catch(() => undefined);
      throw new Error(`Product update failed for SKU ${row.sku}; the newly published image was cleaned up.`, {
        cause: error
      });
    }

    if (
      isManagedImage(item.imageUrl, args.restaurantId, args.storageAccount) &&
      item.imageUrl !== completed.imageUrl
    ) {
      await deleteManagedImage(apiUrl, authorization, args.restaurantId, item.imageUrl!).catch(() => undefined);
    }
    console.log(`[${index + 1}/${rows.length}] ${row.sku}: uploaded and linked.`);
  }

  console.log(JSON.stringify({ uploaded, updated, skipped, errors: 0 }));
}

async function validateMapping(mappingPath: string, expectedCount: number | null): Promise<MappingRow[]> {
  const raw = await readFile(mappingPath, "utf8");
  const table = parseCsv(raw);
  if (table.length < 2) throw new Error("The image mapping CSV is empty.");
  const header = table[0]!.map((cell) => cell.trim());
  if (header.length !== allowedHeaders.length || allowedHeaders.some((column, index) => header[index] !== column)) {
    throw new Error(`The mapping header must be exactly: ${allowedHeaders.join(",")}.`);
  }

  const baseDirectory = resolve(mappingPath, "..");
  const rows: MappingRow[] = [];
  const seenSkus = new Map<string, number>();
  const seenImages = new Map<string, number>();
  const errors: string[] = [];
  for (const [index, cells] of table.slice(1).entries()) {
    const line = index + 2;
    if (cells.length === 1 && !cells[0]?.trim()) continue;
    if (cells.length !== allowedHeaders.length) {
      errors.push(`line ${line}: expected ${allowedHeaders.length} columns, found ${cells.length}`);
      continue;
    }
    const sku = cells[0]!.trim();
    const imagePath = cells[1]!.trim().replaceAll("\\", "/");
    if (!sku) errors.push(`line ${line}: SKU is empty`);
    if (!imagePath) errors.push(`line ${line}: image_path is empty`);
    if (seenSkus.has(sku)) errors.push(`line ${line}: duplicate SKU (first seen on line ${seenSkus.get(sku)})`);
    else seenSkus.set(sku, line);
    if (seenImages.has(imagePath.toLowerCase())) {
      errors.push(`line ${line}: duplicate image_path (first seen on line ${seenImages.get(imagePath.toLowerCase())})`);
    } else seenImages.set(imagePath.toLowerCase(), line);
    if (isAbsolute(imagePath)) {
      errors.push(`line ${line}: image_path must be relative to the mapping file`);
      continue;
    }
    const absoluteImagePath = resolve(baseDirectory, imagePath);
    const relativePath = relative(baseDirectory, absoluteImagePath);
    if (relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
      errors.push(`line ${line}: image_path escapes the mapping directory`);
      continue;
    }
    try {
      const details = await stat(absoluteImagePath);
      if (!details.isFile()) throw new Error("not a file");
      if (details.size < 1 || details.size > maxBytes) throw new Error(`size ${details.size} is outside 1-${maxBytes}`);
      const bytes = await readFile(absoluteImagePath);
      const contentType = detectContentType(bytes, extname(absoluteImagePath));
      rows.push({ line, sku, imagePath, absoluteImagePath, contentType, size: details.size });
    } catch (error) {
      errors.push(`line ${line}: invalid image file (${error instanceof Error ? error.message : "unknown error"})`);
    }
  }
  if (expectedCount !== null && rows.length !== expectedCount) {
    errors.push(`expected ${expectedCount} valid row(s), found ${rows.length}`);
  }
  if (errors.length > 0) {
    throw new Error(`Image mapping validation failed with ${errors.length} error(s):\n${errors.slice(0, 20).join("\n")}`);
  }
  return rows;
}

function indexProducts(items: MenuItem[]): Map<string, MenuItem> {
  const indexed = new Map<string, MenuItem>();
  const duplicates: string[] = [];
  for (const item of items) {
    const sku = item.sku?.trim();
    if (!sku) continue;
    if (indexed.has(sku)) duplicates.push(sku);
    else indexed.set(sku, item);
  }
  if (duplicates.length > 0) throw new Error(`The API returned duplicate SKU(s): ${duplicates.join(", ")}.`);
  return indexed;
}

function detectContentType(bytes: Buffer, extension: string): MappingRow["contentType"] {
  const lower = extension.toLowerCase();
  if (lower === ".jpg" || lower === ".jpeg") {
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  } else if (lower === ".png") {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    if (signature.every((value, index) => bytes[index] === value)) return "image/png";
  } else if (
    lower === ".webp" &&
    bytes.length >= 12 &&
    bytes.toString("ascii", 0, 4) === "RIFF" &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  ) return "image/webp";
  throw new Error(`extension/signature mismatch for ${extension || "a file without an extension"}`);
}

async function deleteManagedImage(
  apiUrl: string,
  authorization: Record<string, string>,
  restaurantId: string,
  imageUrl: string
): Promise<void> {
  await apiJson(`${apiUrl}/uploads/image`, {
    method: "DELETE",
    headers: { ...authorization, "content-type": "application/json" },
    body: JSON.stringify({ purpose: "PRODUCT", restaurantId, imageUrl })
  });
}

async function publicImageWorks(imageUrl: string): Promise<boolean> {
  try {
    const response = await fetch(imageUrl, { method: "HEAD" });
    return response.ok && response.headers.get("content-type")?.toLowerCase().startsWith("image/") === true;
  } catch {
    return false;
  }
}

function isManagedImage(imageUrl: string | null, restaurantId: string, storageAccount: string): boolean {
  if (!imageUrl) return false;
  try {
    const url = new URL(imageUrl);
    return (
      url.protocol === "https:" &&
      url.hostname === `${storageAccount}.blob.core.windows.net` &&
      url.pathname.startsWith(`/product-images/restaurants/${restaurantId}/products/`) &&
      !url.search
    );
  } catch {
    return false;
  }
}

async function apiJson<T = unknown>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    let code = "UNKNOWN";
    try {
      const payload = (await response.json()) as { code?: string };
      code = payload.code ?? code;
    } catch {}
    throw new Error(`API request failed with HTTP ${response.status} (${code}).`);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function parseArgs(values: string[]): Args {
  const parsed: Args = {
    apiUrl: "",
    restaurantId: "",
    storageAccount: "",
    mapping: "",
    expectedCount: null,
    dryRun: false
  };
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index]!;
    if (value === "--dry-run") parsed.dryRun = true;
    else if (value === "--api-url") parsed.apiUrl = requireValue(values, ++index, value);
    else if (value === "--restaurant-id") parsed.restaurantId = requireValue(values, ++index, value);
    else if (value === "--storage-account") parsed.storageAccount = requireValue(values, ++index, value);
    else if (value === "--mapping") parsed.mapping = requireValue(values, ++index, value);
    else if (value === "--expected-count") {
      const count = Number(requireValue(values, ++index, value));
      if (!Number.isInteger(count) || count < 1) throw new Error("--expected-count must be a positive integer.");
      parsed.expectedCount = count;
    } else throw new Error(`Unknown argument: ${value}`);
  }
  if (!parsed.apiUrl || !parsed.restaurantId || !parsed.storageAccount || !parsed.mapping) {
    throw new Error("Provide --api-url, --restaurant-id, --storage-account, and --mapping.");
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(parsed.restaurantId)) {
    throw new Error("--restaurant-id must be a UUID.");
  }
  if (!/^[a-z0-9]{3,24}$/.test(parsed.storageAccount)) {
    throw new Error("--storage-account must be a valid lowercase Azure Storage account name.");
  }
  return parsed;
}

function requireValue(values: string[], index: number, flag: string): string {
  const value = values[index]?.trim();
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value.`);
  return value;
}

function normalizeApiUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("--api-url must use HTTPS.");
  return url.toString().replace(/\/$/, "");
}

function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]!;
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.endsWith("\r") ? field.slice(0, -1) : field);
      rows.push(row);
      row = [];
      field = "";
    } else field += character;
  }
  if (quoted) throw new Error("The mapping CSV contains an unterminated quoted field.");
  if (field.length > 0 || row.length > 0) {
    row.push(field.endsWith("\r") ? field.slice(0, -1) : field);
    rows.push(row);
  }
  return rows;
}

void main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Product image import failed.");
  process.exitCode = 1;
});

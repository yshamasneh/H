/**
 * Uploads a local folder of catalogue pictures straight into the public S3-compatible image bucket
 * (IMAGE_STORAGE_DRIVER=s3: Cloudflare R2, a Railway Bucket, AWS S3) and writes a copy of the
 * product-import CSV with `imageUrl` filled in, ready for `npm run import:products`.
 *
 * It does not touch the database. The order is: create the store, run this script, then import
 * the CSV it wrote.
 *
 * Safety properties:
 * - dry-run (the default until --upload is passed) validates the mapping, every local file and
 *   the product CSV, and reports exactly what would be uploaded, without any network call;
 * - every file is checked for size (5 MB, the API's own limit) and for a JPEG/PNG/WebP signature
 *   that matches its extension, the same rules the upload API applies;
 * - object names are `restaurants/<id>/products/<sha256>.<ext>`: the prefix the API's ownership
 *   check expects (so an image can later be deleted through the API), and content-addressed, so
 *   a re-run skips what is already uploaded and an interrupted run resumes safely;
 * - a product that already has an imageUrl in the CSV keeps it unless --replace-existing is given;
 * - credentials come only from the environment (the API's own S3_* names) and are never logged.
 *
 * Usage from apps/api:
 *   npm run upload:catalogue-images -- --restaurant-id <uuid> \
 *     --mapping ../../products/products_image_mapping.csv \
 *     --products ../../products/products_seed.csv \
 *     --out ../../products/products_seed.with-images.csv
 *   ...then the same command with --upload once the dry-run counts are right.
 *
 * Required environment for --upload: S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY,
 * S3_PUBLIC_BUCKET, S3_PUBLIC_BASE_URL; optional S3_REGION (auto), S3_FORCE_PATH_STYLE (false).
 * S3_PUBLIC_BASE_URL is also needed for a dry-run, because it decides the URLs written to the CSV.
 */
import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { HeadObjectCommand, PutObjectCommand, S3Client, S3ServiceException } from "@aws-sdk/client-s3";
import { checkImageUrl, imageUrlProblemMessage } from "../src/common/image-url.util";

const maxBytes = 5 * 1024 * 1024;
const cacheControl = "public, max-age=31536000, immutable";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ContentType = "image/jpeg" | "image/png" | "image/webp";
type MappedImage = { line: number; sku: string; absolutePath: string; contentType: ContentType; objectName: string; size: number };
type Args = {
  restaurantId: string;
  mapping: string;
  products: string;
  out: string;
  upload: boolean;
  replaceExisting: boolean;
  concurrency: number;
};

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const publicBase = publicBaseUrl();
  const images = await readMapping(args.mapping, args.restaurantId);
  const products = parseCsv(await readFile(args.products, "utf8"));
  if (products.length < 2) throw new Error("The product CSV has no rows.");
  const header = products[0]!.map((cell) => cell.trim());
  const skuColumn = header.indexOf("sku");
  if (skuColumn < 0) throw new Error("The product CSV has no `sku` column.");
  let imageColumn = header.indexOf("imageUrl");
  if (imageColumn < 0) {
    header.push("imageUrl");
    imageColumn = header.length - 1;
  }
  const rows = products.slice(1).map((cells) => {
    const padded = [...cells];
    while (padded.length < header.length) padded.push("");
    return padded;
  });

  const rowBySku = new Map<string, string[]>();
  for (const row of rows) {
    const sku = row[skuColumn]!.trim();
    if (rowBySku.has(sku)) throw new Error(`The product CSV repeats SKU ${sku}.`);
    if (sku) rowBySku.set(sku, row);
  }
  const unknown = images.filter((image) => !rowBySku.has(image.sku));
  if (unknown.length > 0) {
    throw new Error(`${unknown.length} mapped SKU(s) are not in the product CSV, e.g. ${unknown.slice(0, 5).map((image) => image.sku).join(", ")}.`);
  }

  const toApply = images.filter((image) => args.replaceExisting || !rowBySku.get(image.sku)![imageColumn]!.trim());
  const kept = images.length - toApply.length;
  const totalBytes = toApply.reduce((sum, image) => sum + image.size, 0);
  console.log(
    `${images.length} mapped image(s); ${toApply.length} to apply (${(totalBytes / 1024 / 1024).toFixed(1)} MB), ` +
      `${kept} product(s) keep their existing imageUrl; ${rows.length - images.length} product(s) have no mapped image.`
  );

  if (!args.upload) {
    for (const image of toApply.slice(0, 3)) console.log(`  ${image.sku} -> ${publicUrl(publicBase, image.objectName)}`);
    console.log("Dry run: nothing was uploaded or written. Re-run with --upload.");
    return;
  }

  const client = s3Client();
  const bucket = required("S3_PUBLIC_BUCKET");
  let uploaded = 0;
  let skipped = 0;
  const queue = [...toApply];
  await Promise.all(
    Array.from({ length: args.concurrency }, async () => {
      for (let image = queue.shift(); image; image = queue.shift()) {
        if (await exists(client, bucket, image.objectName)) {
          skipped += 1;
        } else {
          await client.send(
            new PutObjectCommand({
              Bucket: bucket,
              Key: image.objectName,
              Body: await readFile(image.absolutePath),
              ContentType: image.contentType,
              CacheControl: cacheControl
            })
          );
          uploaded += 1;
          if (uploaded % 100 === 0) console.log(`  ${uploaded} uploaded...`);
        }
        rowBySku.get(image.sku)![imageColumn] = publicUrl(publicBase, image.objectName);
      }
    })
  );
  await writeFile(args.out, `﻿${[header, ...rows].map(toCsvLine).join("\r\n")}\r\n`, "utf8");
  console.log(`Uploaded ${uploaded}, already present ${skipped}. Wrote ${args.out}.`);
  console.log(`Next: npm run import:products -- --restaurant-id ${args.restaurantId} --file ${args.out} --dry-run`);
}

async function readMapping(mappingPath: string, restaurantId: string): Promise<MappedImage[]> {
  const table = parseCsv(await readFile(mappingPath, "utf8"));
  const header = table[0]?.map((cell) => cell.trim()) ?? [];
  const skuColumn = header.indexOf("sku");
  const pathColumn = header.indexOf("image_path");
  if (skuColumn < 0 || pathColumn < 0) throw new Error("The mapping CSV needs `sku` and `image_path` columns.");
  const baseDirectory = resolve(mappingPath, "..");
  const errors: string[] = [];
  const seen = new Set<string>();
  const images: MappedImage[] = [];
  for (const [index, cells] of table.slice(1).entries()) {
    const line = index + 2;
    const sku = cells[skuColumn]?.trim() ?? "";
    const imagePath = (cells[pathColumn]?.trim() ?? "").replaceAll("\\", "/");
    if (!sku || !imagePath) {
      errors.push(`line ${line}: sku and image_path are required`);
      continue;
    }
    if (seen.has(sku)) errors.push(`line ${line}: duplicate SKU ${sku}`);
    seen.add(sku);
    const absolutePath = resolve(baseDirectory, imagePath);
    const fromBase = relative(baseDirectory, absolutePath);
    if (isAbsolute(imagePath) || fromBase === ".." || fromBase.startsWith(`..${sep}`)) {
      errors.push(`line ${line}: image_path must stay inside the mapping file's folder`);
      continue;
    }
    try {
      const details = await stat(absolutePath);
      if (!details.isFile() || details.size < 1 || details.size > maxBytes) throw new Error(`size must be 1-${maxBytes} bytes`);
      const bytes = await readFile(absolutePath);
      const contentType = detectContentType(bytes, extname(absolutePath));
      const digest = createHash("sha256").update(bytes).digest("hex");
      const extension = contentType === "image/jpeg" ? "jpg" : contentType === "image/png" ? "png" : "webp";
      images.push({ line, sku, absolutePath, contentType, size: details.size, objectName: `restaurants/${restaurantId}/products/${digest}.${extension}` });
    } catch (error) {
      errors.push(`line ${line}: ${imagePath}: ${error instanceof Error ? error.message : "unreadable"}`);
    }
  }
  if (errors.length > 0) throw new Error(`Mapping validation failed with ${errors.length} error(s):\n${errors.slice(0, 20).join("\n")}`);
  return images;
}

function detectContentType(bytes: Buffer, extension: string): ContentType {
  const lower = extension.toLowerCase();
  if ((lower === ".jpg" || lower === ".jpeg") && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (lower === ".png" && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((value, index) => bytes[index] === value)) return "image/png";
  if (lower === ".webp" && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  throw new Error("not a JPEG, PNG or WebP file matching its extension");
}

function publicBaseUrl(): URL {
  const base = new URL(required("S3_PUBLIC_BASE_URL"));
  if (!base.pathname.endsWith("/")) base.pathname += "/";
  const problem = checkImageUrl(base.toString());
  if (problem) throw new Error(`S3_PUBLIC_BASE_URL: ${imageUrlProblemMessage(problem)}`);
  return base;
}

function publicUrl(base: URL, objectName: string): string {
  return `${base.origin}${base.pathname}${objectName.split("/").map(encodeURIComponent).join("/")}`;
}

function s3Client(): S3Client {
  return new S3Client({
    endpoint: required("S3_ENDPOINT"),
    region: process.env.S3_REGION || "auto",
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    credentials: { accessKeyId: required("S3_ACCESS_KEY_ID"), secretAccessKey: required("S3_SECRET_ACCESS_KEY") }
  });
}

async function exists(client: S3Client, bucket: string, key: string): Promise<boolean> {
  try {
    await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (error) {
    if (error instanceof S3ServiceException && error.$metadata.httpStatusCode === 404) return false;
    throw error;
  }
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function toCsvLine(cells: string[]): string {
  return cells.map((cell) => (/[",\r\n]/.test(cell) ? `"${cell.replaceAll('"', '""')}"` : cell)).join(",");
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const source = text.replace(/\r\n/g, "\n").replace(/^﻿/, "");
  for (let i = 0; i < source.length; i += 1) {
    const char = source[i]!;
    if (inQuotes) {
      if (char === '"' && source[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
    } else if (char === '"') {
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

function parseArgs(values: string[]): Args {
  const value = (name: string): string | undefined => {
    const index = values.indexOf(`--${name}`);
    return index >= 0 ? values[index + 1] : undefined;
  };
  const restaurantId = value("restaurant-id") ?? "";
  const mapping = value("mapping");
  const products = value("products");
  const out = value("out");
  if (!uuidPattern.test(restaurantId) || !mapping || !products || !out) {
    throw new Error(
      "Usage: upload-catalogue-images.ts --restaurant-id <uuid> --mapping <mapping.csv> --products <products.csv> --out <output.csv> [--upload] [--replace-existing] [--concurrency 4]"
    );
  }
  if (resolve(out) === resolve(products)) throw new Error("--out must be a new file, not the product CSV itself.");
  const concurrency = Number(value("concurrency") ?? 4);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 16) throw new Error("--concurrency must be 1-16.");
  return {
    restaurantId,
    mapping,
    products,
    out,
    upload: values.includes("--upload"),
    replaceExisting: values.includes("--replace-existing"),
    concurrency
  };
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

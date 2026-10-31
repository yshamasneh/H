import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { PrismaPg } from "@prisma/adapter-pg";
import { applyCatalogue, parseCatalogue, readRecords, type ImportDatabase } from "../catalogue/catalogue-import";
import { BusinessType, PrismaClient, RestaurantStatus, UserRole } from "../generated/prisma/client";

/**
 * Run 3, task 3 against an isolated PostgreSQL test database with synthetic fixtures only:
 * dry-run writes nothing, products arrive PENDING_REVIEW with exact prices and string barcodes,
 * a partial failure can be retried without duplicates, a hand-edited product is never overwritten,
 * a barcode owned by another product is a conflict, and the CLI refuses a non-local database.
 */
const runDatabaseE2e = process.env.RUN_DATABASE_E2E === "true";
const ownerPhone = "+970594680001";
const apiRoot = path.resolve(__dirname, "..", "..");

const fixture = [
  "sourceId,name,category,price,costPrice,barcode,sku,brand,description",
  "IMP-001,حليب تجريبي,ألبان تجريبية,6.50,4.75,0072940009991,,,",
  "IMP-002,خبز تجريبي,مخبوزات تجريبية,3,2,,,,",
  "IMP-003,Test conflict,ألبان تجريبية,5,4,0000000011111,,,",
  "IMP-004,Test vodka 70cl,مشروبات تجريبية,40,30,,,,"
].join("\n");

test("catalogue importer on PostgreSQL", { skip: !runDatabaseE2e, timeout: 180_000 }, async (context) => {
  const databaseUrl = process.env.DATABASE_URL ?? "";
  assert.ok(new URL(databaseUrl).pathname.toLowerCase().includes("test"), "requires a database whose name contains 'test'");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const db = prisma as unknown as ImportDatabase;
  context.after(async () => {
    await cleanup(prisma);
    await prisma.$disconnect();
  });
  await cleanup(prisma);

  const owner = await prisma.user.create({ data: { fullName: "Import owner", phone: ownerPhone, passwordHash: "x", role: UserRole.RESTAURANT, isActive: true } });
  const store = await prisma.restaurant.create({
    data: { ownerUserId: owner.id, name: "Import Market", businessType: BusinessType.SUPERMARKET, status: RestaurantStatus.APPROVED, isOpen: true, phone: ownerPhone, addressLine: "Test" }
  });
  const otherCategory = await prisma.menuCategory.create({ data: { restaurantId: store.id, name: "Existing", sortOrder: 0, isActive: true } });
  const handMade = await prisma.menuItem.create({
    data: { restaurantId: store.id, categoryId: otherCategory.id, name: "Hand-made product", priceMinor: 100, costPriceMinor: 50, barcode: "0000000011111" }
  });
  const parsed = parseCatalogue(readRecords(fixture, "csv"));
  assert.deepEqual(parsed.restricted.map((row) => row.sourceId), ["IMP-004"], "the restricted row never reaches the database step");
  const count = () => prisma.menuItem.count({ where: { restaurantId: store.id } });

  await context.test("dry-run is the default behaviour and writes nothing", async () => {
    const before = await count();
    const report = await applyCatalogue(db, { restaurantId: store.id, rows: parsed.rows, dryRun: true });
    assert.equal(report.counts.CREATED, 2);
    assert.equal(report.counts.BARCODE_CONFLICT, 1);
    assert.equal(await count(), before);
    assert.equal(await prisma.menuCategory.count({ where: { restaurantId: store.id } }), 1);
  });

  await context.test("a run that fails part-way can be retried safely, with no duplicates", async () => {
    await assert.rejects(applyCatalogue(db, { restaurantId: store.id, rows: parsed.rows, dryRun: false, failAfterWrites: 1 }), /Simulated failure/);
    assert.equal(await count(), 2, "one product written before the failure");
    const retry = await applyCatalogue(db, { restaurantId: store.id, rows: parsed.rows, dryRun: false });
    assert.deepEqual(retry.counts, { CREATED: 1, UPDATED: 0, UNCHANGED: 1, MANUALLY_EDITED: 0, BARCODE_CONFLICT: 1, SKU_CONFLICT: 0, FAILED: 0 });
    assert.equal(await count(), 3);
    const again = await applyCatalogue(db, { restaurantId: store.id, rows: parsed.rows, dryRun: false });
    assert.equal(again.counts.UNCHANGED, 2, "a third run changes nothing");
  });

  await context.test("imported products are pending review with exact prices and string barcodes", async () => {
    const milk = await prisma.menuItem.findUniqueOrThrow({ where: { restaurantId_importSourceId: { restaurantId: store.id, importSourceId: "IMP-001" } } });
    assert.equal(milk.reviewStatus, "PENDING_REVIEW");
    assert.equal(milk.priceMinor, 650);
    assert.equal(milk.costPriceMinor, 475);
    assert.equal(milk.barcode, "0072940009991");
    const bread = await prisma.menuItem.findUniqueOrThrow({ where: { restaurantId_importSourceId: { restaurantId: store.id, importSourceId: "IMP-002" } } });
    assert.equal(bread.barcode, null);
    assert.equal((await prisma.menuItem.findUniqueOrThrow({ where: { id: handMade.id } })).name, "Hand-made product", "the conflicting barcode owner is untouched");
  });

  await context.test("a hand-edited product is never overwritten; an unedited one is updated", async () => {
    const changed = parseCatalogue(readRecords(fixture.replace("6.50,4.75", "7.00,4.75").replace("خبز تجريبي,مخبوزات تجريبية,3,2", "خبز تجريبي,مخبوزات تجريبية,3.25,2"), "csv")).rows;
    await prisma.menuItem.update({ where: { restaurantId_importSourceId: { restaurantId: store.id, importSourceId: "IMP-001" } }, data: { name: "حليب (معدّل يدويًا)" } });
    const report = await applyCatalogue(db, { restaurantId: store.id, rows: changed, dryRun: false });
    const byId = Object.fromEntries(report.outcomes.map((outcome) => [outcome.sourceId, outcome.outcome]));
    assert.equal(byId["IMP-001"], "MANUALLY_EDITED");
    assert.equal(byId["IMP-002"], "UPDATED");
    const milk = await prisma.menuItem.findUniqueOrThrow({ where: { restaurantId_importSourceId: { restaurantId: store.id, importSourceId: "IMP-001" } } });
    assert.equal(milk.priceMinor, 650);
    assert.equal(milk.name, "حليب (معدّل يدويًا)");
  });

  await context.test("the CLI dry-runs on localhost and refuses a non-local database", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "catalogue-import-"));
    const file = path.join(dir, "catalogue.csv");
    writeFileSync(file, fixture);
    const run = (url: string, extra: string[] = []) =>
      spawnSync(process.execPath, ["--import", "tsx", "scripts/catalogue-import.ts", "--restaurant-id", store.id, "--file", file, "--report-dir", path.join(dir, "reports"), ...extra], {
        cwd: apiRoot,
        env: { ...process.env, DATABASE_URL: url },
        encoding: "utf8"
      });
    const local = run(databaseUrl);
    assert.equal(local.status, 0, local.stderr);
    assert.match(local.stdout, /DRY RUN/);
    const remote = run("postgresql://user@db.example.invalid:5432/production");
    assert.equal(remote.status, 2);
    assert.match(remote.stderr, /Refusing to run against a non-local database/);
    const wrongToken = run("postgresql://user@db.example.invalid:5432/production", ["--production", "--confirm", "IMPORT-NOPE"]);
    assert.match(wrongToken.stderr, /does not match/);
  });
});

async function cleanup(prisma: PrismaClient): Promise<void> {
  const owner = await prisma.user.findUnique({ where: { phone: ownerPhone } });
  if (!owner) return;
  const stores = await prisma.restaurant.findMany({ where: { ownerUserId: owner.id }, select: { id: true } });
  const storeIds = stores.map((store) => store.id);
  await prisma.menuItem.deleteMany({ where: { restaurantId: { in: storeIds } } });
  await prisma.menuCategory.deleteMany({ where: { restaurantId: { in: storeIds } } });
  await prisma.restaurant.deleteMany({ where: { id: { in: storeIds } } });
  await prisma.user.delete({ where: { id: owner.id } });
}

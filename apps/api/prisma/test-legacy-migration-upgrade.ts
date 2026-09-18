import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { copyFileSync, cpSync, mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import { Client } from "pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { inspectPartnerAccountInvariants } from "../src/accounting/partner-account-invariants";

const cutoffMigration = "20260911000000_add_store_show_location_to_customer";
const expectedFinalMigrations = [
  "20260918000000_add_push_delivery_outbox",
  "20260918010000_seed_required_partner_accounts"
];
const apiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repositoryRoot = path.resolve(apiRoot, "..", "..");
const migrationsRoot = path.join(apiRoot, "prisma", "migrations");
const prismaCli = path.join(repositoryRoot, "node_modules", "prisma", "build", "index.js");
const require = createRequire(import.meta.url);

const ids = {
  customer: "00000000-0000-4000-8000-000000000101",
  owner: "00000000-0000-4000-8000-000000000102",
  driver: "00000000-0000-4000-8000-000000000103",
  session: "00000000-0000-4000-8000-000000000201",
  restaurant: "00000000-0000-4000-8000-000000000301",
  membership: "00000000-0000-4000-8000-000000000302",
  category: "00000000-0000-4000-8000-000000000401",
  item: "00000000-0000-4000-8000-000000000402",
  movement: "00000000-0000-4000-8000-000000000403",
  order: "00000000-0000-4000-8000-000000000501",
  orderItem: "00000000-0000-4000-8000-000000000502",
  history: "00000000-0000-4000-8000-000000000503",
  delivery: "00000000-0000-4000-8000-000000000504",
  notification: "00000000-0000-4000-8000-000000000601",
  pushToken: "00000000-0000-4000-8000-000000000602",
  ownerAccount: "00000000-0000-4000-8000-000000000701",
  financialRecord: "00000000-0000-4000-8000-000000000702",
  earning: "00000000-0000-4000-8000-000000000703"
} as const;

const legacyTables = [
  "User",
  "RefreshSession",
  "Restaurant",
  "BusinessMember",
  "MenuCategory",
  "MenuItem",
  "InventoryMovement",
  "Order",
  "OrderItem",
  "OrderStatusHistory",
  "Delivery",
  "Notification",
  "PushToken",
  "PartnerAccount",
  "OrderFinancialRecord",
  "PartnerEarning"
] as const;

function safeBaseUrl(): URL {
  const value = process.env.LEGACY_MIGRATION_TEST_DATABASE_URL;
  if (!value) throw new Error("LEGACY_MIGRATION_TEST_DATABASE_URL is required");
  if (process.env.NODE_ENV === "production") throw new Error("Legacy migration testing is forbidden in production mode");

  const parsed = new URL(value);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) throw new Error("Only PostgreSQL test URLs are accepted");
  if (!['127.0.0.1', 'localhost'].includes(parsed.hostname)) {
    throw new Error("Legacy migration testing is restricted to local PostgreSQL hosts");
  }
  const databaseName = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  if (!/test/i.test(databaseName) || /^(postgres|template0|template1)$/i.test(databaseName)) {
    throw new Error("The source database name must explicitly contain 'test'");
  }
  return parsed;
}

function databaseUrlFor(base: URL, databaseName: string): string {
  const target = new URL(base);
  target.pathname = `/${databaseName}`;
  target.searchParams.set("schema", "public");
  return target.toString();
}

function quotedIdentifier(value: string): string {
  assert.match(value, /^[A-Za-z0-9_]+$/);
  return `"${value}"`;
}

function runPrismaDeploy(databaseUrl: string, configPath: string, cwd: string): void {
  const result = spawnSync(process.execPath, [prismaCli, "migrate", "deploy", "--config", configPath], {
    cwd,
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: "inherit",
    shell: false
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error("Prisma migrate deploy failed");
}

function createLegacyMigrationConfig(temporaryRoot: string): string {
  const subsetRoot = path.join(temporaryRoot, "migrations");
  mkdirSync(subsetRoot, { recursive: true });
  copyFileSync(path.join(migrationsRoot, "migration_lock.toml"), path.join(subsetRoot, "migration_lock.toml"));

  const migrationNames = readdirSync(migrationsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name <= cutoffMigration)
    .map((entry) => entry.name)
    .sort();
  assert.ok(migrationNames.includes(cutoffMigration), "legacy cutoff migration is missing");
  assert.ok(!migrationNames.some((name) => expectedFinalMigrations.includes(name)), "final migrations leaked into legacy stage");

  for (const migrationName of migrationNames) {
    cpSync(path.join(migrationsRoot, migrationName), path.join(subsetRoot, migrationName), { recursive: true });
  }

  const schemaPath = path.join(temporaryRoot, "schema.prisma");
  copyFileSync(path.join(apiRoot, "prisma", "schema.prisma"), schemaPath);
  const configPath = path.join(temporaryRoot, "prisma.config.ts");
  const prismaConfigUrl = pathToFileURL(require.resolve("prisma/config")).href;
  writeFileSync(
    configPath,
    `import { defineConfig } from ${JSON.stringify(prismaConfigUrl)};\n` +
      `export default defineConfig({\n` +
      `  schema: ${JSON.stringify(schemaPath)},\n` +
      `  migrations: { path: ${JSON.stringify(subsetRoot)} },\n` +
      `  datasource: { url: process.env.DATABASE_URL }\n` +
      `});\n`,
    "utf8"
  );
  return configPath;
}

async function seedRepresentativeLegacyData(databaseUrl: string): Promise<void> {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  try {
    await prisma.$transaction(async (tx) => {
      const businessRole = await tx.role.findUniqueOrThrow({ where: { key: "BUSINESS_ADMIN" } });
      const rateSet = await tx.financialRateSet.findUniqueOrThrow({ where: { version: 1 } });

      await tx.user.createMany({
        data: [
          { id: ids.customer, fullName: "Legacy Customer", phone: "+970599000101", passwordHash: "legacy-hash", role: "CUSTOMER", phoneVerifiedAt: new Date("2026-01-01T00:00:00Z") },
          { id: ids.owner, fullName: "Legacy Owner", phone: "+970599000102", passwordHash: "legacy-hash", role: "RESTAURANT", phoneVerifiedAt: new Date("2026-01-01T00:00:00Z") },
          { id: ids.driver, fullName: "Legacy Driver", phone: "+970599000103", passwordHash: "legacy-hash", role: "DRIVER", phoneVerifiedAt: new Date("2026-01-01T00:00:00Z") }
        ]
      });
      await tx.refreshSession.create({ data: { id: ids.session, userId: ids.customer, tokenHash: "legacy-session-hash", expiresAt: new Date("2027-01-01T00:00:00Z") } });
      await tx.restaurant.create({
        data: {
          id: ids.restaurant,
          ownerUserId: ids.owner,
          name: "Legacy Market",
          businessType: "SUPERMARKET",
          phone: "+970599000102",
          status: "APPROVED",
          isOpen: true,
          addressLine: "Legacy test address",
          latitude: 31.9,
          longitude: 35.2,
          showLocationToCustomer: true
        }
      });
      await tx.businessMember.create({ data: { id: ids.membership, businessId: ids.restaurant, userId: ids.owner, roleId: businessRole.id } });
      await tx.menuCategory.create({ data: { id: ids.category, restaurantId: ids.restaurant, name: "Legacy Pantry", sortOrder: 1 } });
      await tx.menuItem.create({
        data: {
          id: ids.item,
          restaurantId: ids.restaurant,
          categoryId: ids.category,
          name: "Legacy Rice",
          priceMinor: 1200,
          costPriceMinor: 800,
          sku: "LEGACY-RICE-1",
          stockQuantity: 11
        }
      });
      await tx.order.create({
        data: {
          id: ids.order,
          customerId: ids.customer,
          restaurantId: ids.restaurant,
          status: "DELIVERED",
          paymentMethod: "CASH",
          deliveryLabel: "Home",
          deliveryAddressLine: "Legacy delivery address",
          subtotalMinor: 1200,
          deliveryFeeMinor: 1000,
          financialRateSetId: rateSet.id,
          totalMinor: 2200
        }
      });
      await tx.orderItem.create({
        data: {
          id: ids.orderItem,
          orderId: ids.order,
          menuItemId: ids.item,
          nameSnapshot: "Legacy Rice",
          priceMinorSnapshot: 1200,
          costPriceMinorSnapshot: 800,
          quantity: 1
        }
      });
      await tx.inventoryMovement.create({
        data: {
          id: ids.movement,
          restaurantId: ids.restaurant,
          menuItemId: ids.item,
          actorUserId: ids.owner,
          orderId: ids.order,
          type: "ORDER_RESERVATION",
          quantityDelta: -1,
          stockAfter: 11,
          reason: "Representative legacy reservation"
        }
      });
      await tx.orderStatusHistory.create({ data: { id: ids.history, orderId: ids.order, toStatus: "DELIVERED", changedByUserId: ids.driver } });
      await tx.delivery.create({ data: { id: ids.delivery, orderId: ids.order, driverId: ids.driver, status: "DELIVERED", deliveredAt: new Date("2026-02-01T12:00:00Z") } });
      await tx.notification.create({
        data: {
          id: ids.notification,
          userId: ids.owner,
          businessId: ids.restaurant,
          type: "ORDER_STATUS_CHANGED",
          title: "Legacy notification",
          body: "Historical fixture",
          relatedEntityId: ids.order
        }
      });
      await tx.pushToken.create({ data: { id: ids.pushToken, userId: ids.owner, token: "ExponentPushToken[legacy-migration-fixture]", platform: "android" } });
      await tx.partnerAccount.create({
        data: { id: ids.ownerAccount, key: "OWNER_A", name: "Legacy owner name preserved", kind: "PLATFORM_OWNER" }
      });
      await tx.orderFinancialRecord.create({
        data: {
          id: ids.financialRecord,
          orderId: ids.order,
          businessId: ids.restaurant,
          rateSetId: rateSet.id,
          vertical: "SUPERMARKET",
          outcome: "DELIVERED",
          isPromotionalBusiness: false,
          itemSubtotalMinor: 1200,
          deliveryFeeMinor: 1000,
          cashCollectedMinor: 2200,
          goodsCostMinor: 800,
          marginMinor: 400
        }
      });
      await tx.partnerEarning.create({
        data: {
          id: ids.earning,
          sourceType: "ORDER",
          sourceId: ids.financialRecord,
          orderFinancialRecordId: ids.financialRecord,
          payeeType: "PARTNER",
          payeeKey: `PARTNER:${ids.ownerAccount}`,
          partnerAccountId: ids.ownerAccount,
          component: "SUPERMARKET_MARGIN_SHARE",
          amountMinor: 300,
          occurredAt: new Date("2026-02-01T12:00:00Z")
        }
      });
    });
  } finally {
    await prisma.$disconnect();
  }
}

async function tableCounts(client: Client): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of legacyTables) {
    const result = await client.query(`SELECT COUNT(*)::int AS count FROM ${quotedIdentifier(table)}`);
    counts[table] = Number(result.rows[0]?.count ?? 0);
  }
  return counts;
}

async function migrationNames(client: Client): Promise<string[]> {
  const result = await client.query(
    `SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY migration_name`
  );
  return result.rows.map((row) => String(row.migration_name));
}

async function verifyUpgradedData(client: Client, before: Record<string, number>): Promise<void> {
  const after = await tableCounts(client);
  for (const table of legacyTables) {
    const expected = table === "PartnerAccount" ? before[table] + 2 : before[table];
    assert.equal(after[table], expected, `${table} count changed unexpectedly`);
  }

  const relationships = await client.query(
    `SELECT
      (SELECT "userId" FROM "RefreshSession" WHERE id = $1) AS session_user,
      (SELECT "ownerUserId" FROM "Restaurant" WHERE id = $2) AS owner_user,
      (SELECT "menuItemId" FROM "OrderItem" WHERE id = $3) AS item_id,
      (SELECT "orderId" FROM "Delivery" WHERE id = $4) AS delivery_order,
      (SELECT "relatedEntityId" FROM "Notification" WHERE id = $5) AS notification_order`,
    [ids.session, ids.restaurant, ids.orderItem, ids.delivery, ids.notification]
  );
  assert.equal(relationships.rows[0]?.session_user, ids.customer);
  assert.equal(relationships.rows[0]?.owner_user, ids.owner);
  assert.equal(relationships.rows[0]?.item_id, ids.item);
  assert.equal(relationships.rows[0]?.delivery_order, ids.order);
  assert.equal(relationships.rows[0]?.notification_order, ids.order);

  const historicalJobs = await client.query(`SELECT COUNT(*)::int AS count FROM "PushDelivery"`);
  assert.equal(historicalJobs.rows[0]?.count, 0, "historical notifications unexpectedly created push jobs");

  const tokenState = await client.query(
    `SELECT COUNT(*)::int AS total, COUNT(DISTINCT token)::int AS unique_tokens,
            MIN("userId"::text) AS owner
     FROM "PushToken" WHERE id = $1`,
    [ids.pushToken]
  );
  assert.equal(tokenState.rows[0]?.total, 1);
  assert.equal(tokenState.rows[0]?.unique_tokens, 1);
  assert.equal(tokenState.rows[0]?.owner, ids.owner);

  const balance = await client.query(
    `SELECT COALESCE(SUM("amountMinor"), 0)::int AS balance FROM "PartnerEarning" WHERE "partnerAccountId" = $1`,
    [ids.ownerAccount]
  );
  assert.equal(balance.rows[0]?.balance, 300, "legacy financial balance changed");

  const accounts = await client.query(
    `SELECT id::text, key, name, kind::text, "isActive", "businessId"::text, "userId"::text
     FROM "PartnerAccount" WHERE key IN ('OWNER_A', 'OWNER_B', 'DELIVERY_OPS') ORDER BY key`
  );
  assert.equal(accounts.rowCount, 3);
  assert.equal(new Set(accounts.rows.map((row) => row.key)).size, 3);
  const ownerA = accounts.rows.find((row) => row.key === "OWNER_A");
  assert.equal(ownerA?.id, ids.ownerAccount);
  assert.equal(ownerA?.name, "Legacy owner name preserved");
  assert.ok(accounts.rows.every((row) => row.isActive === true && row.businessId === null && row.userId === null));
  const readiness = inspectPartnerAccountInvariants(accounts.rows.map((row) => ({
    id: row.id,
    key: row.key,
    kind: row.kind,
    isActive: row.isActive,
    businessId: row.businessId
  })));
  assert.equal(readiness.ready, true, `partner readiness failed: ${readiness.issues.map((issue) => issue.code).join(",")}`);
}

async function main(): Promise<void> {
  const baseUrl = safeBaseUrl();
  const databaseName = `jovo_legacy_test_${Date.now()}_${randomUUID().replace(/-/g, "").slice(0, 8)}`;
  const databaseUrl = databaseUrlFor(baseUrl, databaseName);
  const temporaryRoot = mkdtempSync(path.join(tmpdir(), "jovo-legacy-migrations-"));
  const admin = new Client({ connectionString: baseUrl.toString() });
  let databaseCreated = false;
  let target: Client | undefined;

  try {
    await admin.connect();
    await admin.query(`CREATE DATABASE ${quotedIdentifier(databaseName)} TEMPLATE template0`);
    databaseCreated = true;

    const legacyConfig = createLegacyMigrationConfig(temporaryRoot);
    runPrismaDeploy(databaseUrl, legacyConfig, temporaryRoot);
    await seedRepresentativeLegacyData(databaseUrl);

    target = new Client({ connectionString: databaseUrl });
    await target.connect();
    const legacyMigrationNames = await migrationNames(target);
    assert.equal(legacyMigrationNames.at(-1), cutoffMigration);
    assert.ok(expectedFinalMigrations.every((name) => !legacyMigrationNames.includes(name)));
    const before = await tableCounts(target);

    runPrismaDeploy(databaseUrl, path.join(apiRoot, "prisma.config.ts"), apiRoot);
    const finalMigrationNames = await migrationNames(target);
    assert.ok(expectedFinalMigrations.every((name) => finalMigrationNames.includes(name)));
    await verifyUpgradedData(target, before);

    const afterFirstDeploy = await tableCounts(target);
    runPrismaDeploy(databaseUrl, path.join(apiRoot, "prisma.config.ts"), apiRoot);
    assert.deepEqual(await tableCounts(target), afterFirstDeploy, "idempotent deploy changed legacy row counts");
    assert.deepEqual(await migrationNames(target), finalMigrationNames, "idempotent deploy changed migration history");

    console.log(JSON.stringify({
      result: "passed",
      cutoffMigration,
      legacyMigrationCount: legacyMigrationNames.length,
      finalMigrationCount: finalMigrationNames.length,
      representativeRowsPreserved: Object.values(before).reduce((sum, count) => sum + count, 0),
      historicalPushJobs: 0,
      requiredPartnerAccounts: 3,
      readiness: "ready",
      idempotentRedeploy: true
    }, null, 2));
  } finally {
    if (target) await target.end().catch(() => undefined);
    if (databaseCreated) {
      await admin.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1`, [databaseName]).catch(() => undefined);
      await admin.query(`DROP DATABASE ${quotedIdentifier(databaseName)}`);
    }
    await admin.end().catch(() => undefined);
    rmSync(temporaryRoot, { recursive: true, force: true });
  }
}

void main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "unknown error";
  const sanitized = message.replace(/(?:postgres(?:ql)?):\/\/[^\s]+/gi, "[database-url-redacted]");
  console.error(`Legacy migration test failed: ${sanitized}`);
  process.exitCode = 1;
});

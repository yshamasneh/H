import process from "node:process";
import pg from "pg";
import { argumentValue, loadEnvironmentFile } from "./database-command.mjs";

/**
 * Three questions the accounting layer cannot answer about itself.
 *
 * Every guarantee inside the ledger is enforced by the database — unique indexes stop double
 * counting, CHECK constraints stop over-settlement, triggers stop history being rewritten. What
 * none of them can see is a fact that is *missing* or an input that was *wrong*, because in both
 * cases the rows that do exist are perfectly consistent with each other. The admin overview's
 * ledger-imbalance figure reads zero in all three situations below.
 *
 * Deliberately plain SQL over `pg` rather than the Prisma client: this has to run from a cron
 * entry on a server where nothing has been generated or compiled, and an integrity check is worth
 * more when you can read exactly what it asserts.
 *
 * This is a detector, not a repair tool. It reports and exits non-zero; deciding what to do about
 * a finding is a human's job, and correcting one is a FinancialAdjustment.
 *
 *   npm run check:financial
 *   npm run check:financial -- --custody-age-days=3 --json
 *
 * Exits 0 when everything is clean, 1 when anything needs attention, 2 if it could not run.
 * That makes it safe to put straight into cron with no wrapper.
 */

loadEnvironmentFile();

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("DATABASE_URL is required. Set it in .env at the repository root or in the environment.");
  process.exit(2);
}

const custodyAgeDays = positiveInteger(argumentValue("custody-age-days") ?? "2", "--custody-age-days");
const asJson = process.argv.includes("--json");

const client = new pg.Client({ connectionString: databaseUrl });

try {
  await client.connect();
} catch (error) {
  console.error(`Could not connect to the database: ${error.message}`);
  process.exit(2);
}

try {
  const report = await collect();
  if (asJson) console.log(JSON.stringify(report, null, 2));
  else render(report);
  await client.end();
  process.exit(report.findingCount > 0 ? 1 : 0);
} catch (error) {
  console.error(`Financial integrity check could not run: ${error.message}`);
  await client.end().catch(() => {});
  process.exit(2);
}

async function collect() {
  // 1. A terminal order with no financial record. Money moved and nothing recorded where it went.
  //    Only the driver's delivery transition writes these, inside the same transaction as the
  //    status change — so a gap means data predating the ledger, or a path nobody accounted for.
  const unvalued = await client.query(`
    SELECT o."id", o."status", o."totalMinor", o."createdAt"
    FROM "Order" o
    LEFT JOIN "OrderFinancialRecord" r ON r."orderId" = o."id"
    WHERE o."status" IN ('DELIVERED', 'DELIVERY_FAILED') AND r."id" IS NULL
    ORDER BY o."createdAt" ASC
  `);

  // 2. A record valued against a missing cost price. It reconciles exactly and still split the
  //    money wrongly: the goods cost counted as zero, so the whole retail value became margin.
  //    This is the one drift the ledger-imbalance figure structurally cannot show.
  const provisional = await client.query(`
    SELECT "orderId", "vertical", "itemSubtotalMinor", "goodsCostMinor", "marginMinor", "computedAt"
    FROM "OrderFinancialRecord"
    WHERE "costDataComplete" = false
    ORDER BY "computedAt" ASC
  `);

  // 3. Cash a driver took at the door and has not handed over. Not a bug in itself — it is the
  //    normal state between a delivery and a handover — but it is the platform's money in
  //    someone's pocket, and the longer it sits the more it deserves a question.
  const stale = await client.query(
    `
    SELECT c."orderId",
           c."driverUserId",
           c."collectedAmountMinor" - c."settledAmountMinor" AS "outstandingMinor",
           c."collectedAt",
           u."fullName" AS "driverName",
           u."phone" AS "driverPhone"
    FROM "DriverCashCustody" c
    JOIN "User" u ON u."id" = c."driverUserId"
    WHERE c."status" IN ('OUTSTANDING', 'PARTIALLY_SETTLED')
      AND c."collectedAt" < NOW() - ($1::int * INTERVAL '1 day')
    ORDER BY c."collectedAt" ASC
  `,
    [custodyAgeDays]
  );

  const staleRows = stale.rows.map((row) => ({
    orderId: row.orderId,
    driverUserId: row.driverUserId,
    driverName: row.driverName,
    driverPhone: row.driverPhone,
    outstandingMinor: Number(row.outstandingMinor),
    collectedAt: row.collectedAt.toISOString()
  }));

  return {
    checkedAt: new Date().toISOString(),
    custodyAgeDays,
    unvaluedOrders: {
      count: unvalued.rowCount,
      rows: unvalued.rows.map((row) => ({
        orderId: row.id,
        status: row.status,
        totalMinor: row.totalMinor,
        createdAt: row.createdAt.toISOString()
      }))
    },
    costDataIncomplete: {
      count: provisional.rowCount,
      rows: provisional.rows.map((row) => ({
        orderId: row.orderId,
        vertical: row.vertical,
        itemSubtotalMinor: row.itemSubtotalMinor,
        goodsCostMinor: row.goodsCostMinor,
        marginMinor: row.marginMinor,
        computedAt: row.computedAt.toISOString()
      }))
    },
    staleCashCustody: {
      count: stale.rowCount,
      outstandingMinor: staleRows.reduce((sum, row) => sum + row.outstandingMinor, 0),
      rows: staleRows
    },
    get findingCount() {
      return this.unvaluedOrders.count + this.costDataIncomplete.count + this.staleCashCustody.count;
    }
  };
}

function render(report) {
  console.log(`Financial integrity check — ${report.checkedAt}`);
  console.log("=".repeat(74));

  section("Terminal orders with no financial record", report.unvaluedOrders.count, () => {
    for (const row of report.unvaluedOrders.rows.slice(0, 20)) {
      console.log(
        `    ${row.orderId}  ${row.status.padEnd(16)}${money(row.totalMinor).padStart(12)}  ${row.createdAt.slice(0, 10)}`
      );
    }
    overflow(report.unvaluedOrders.count, 20);
    console.log("    Money moved on these orders and nothing recorded where it went.");
    console.log("    Correct each one with a FinancialAdjustment; they will not self-heal.");
  });

  section("Orders valued without a cost price", report.costDataIncomplete.count, () => {
    for (const row of report.costDataIncomplete.rows.slice(0, 20)) {
      console.log(
        `    ${row.orderId}  ${row.vertical.padEnd(12)}subtotal ${money(row.itemSubtotalMinor).padStart(11)}` +
          `  cost ${money(row.goodsCostMinor).padStart(11)}  margin ${money(row.marginMinor).padStart(11)}`
      );
    }
    overflow(report.costDataIncomplete.count, 20);
    console.log("    These reconcile exactly and still paid the wrong parties: the goods cost was");
    console.log("    counted as zero, so the whole retail value was split as margin — the");
    console.log("    supermarket was underpaid and the platform owners overpaid.");
    console.log("    Add cost prices to the products, then adjust each affected order.");
  });

  section(`Cash held by drivers for more than ${report.custodyAgeDays} day(s)`, report.staleCashCustody.count, () => {
    for (const row of report.staleCashCustody.rows.slice(0, 20)) {
      console.log(
        `    ${row.driverName.padEnd(24)}${money(row.outstandingMinor).padStart(12)}  since ${row.collectedAt.slice(0, 10)}  order ${row.orderId}`
      );
    }
    overflow(report.staleCashCustody.count, 20);
    console.log(`    Total outstanding: ${money(report.staleCashCustody.outstandingMinor)}`);
    console.log("    Expected between a delivery and a handover; chase anything older than that.");
  });

  console.log("");
  console.log("=".repeat(74));
  if (report.findingCount === 0) {
    console.log("No findings. No missing records, no provisional costs, and no cash sitting out");
    console.log("longer than expected.");
  } else {
    console.log(`${report.findingCount} finding(s) need attention. See the sections marked FOUND above.`);
  }
}

function money(minor) {
  return `${(minor / 100).toFixed(2)} ILS`;
}

function section(title, count, body) {
  console.log("");
  console.log(`[${count === 0 ? "clean" : `FOUND ${count}`}] ${title}`);
  if (count > 0) body();
}

function overflow(total, shown) {
  if (total > shown) console.log(`    ... and ${total - shown} more (use --json for the full list).`);
}

function positiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    console.error(`${label} must be a positive whole number of days.`);
    process.exit(2);
  }
  return parsed;
}

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import {
  assertTargetAllowed,
  checkImageMapping,
  confirmationToken,
  isLocalDatabaseUrl,
  parseCatalogue,
  parseExactMinor,
  readRecords
} from "./catalogue-import";

const csv = [
  "sourceId,name,category,price,costPrice,barcode,sku,brand,description",
  "S-001,حليب طازج 1 لتر,ألبان,6.50,4.75,0072940001234,,الجنيدي,",
  "S-002,خبز عربي,مخبوزات,3,2,,,,",
  "S-003,Marlboro Gold,Snacks,25,20,6001234567890,,,",
  "S-004,Duplicate barcode,ألبان,5,4,0072940001234,,,",
  "S-005,Bad price,ألبان,5.555,4,,,,",
  "S-001,Repeated source,ألبان,5,4,,,,"
].join("\n");

test("CSV rows keep barcodes as strings and prices exactly", () => {
  const result = parseCatalogue(readRecords(csv, "csv"));
  const milk = result.rows.find((row) => row.sourceId === "S-001")!;
  assert.equal(milk.barcode, "0072940001234");
  assert.equal(milk.priceMinor, 650);
  assert.equal(milk.costPriceMinor, 475);
  assert.equal(result.rows.find((row) => row.sourceId === "S-002")!.barcode, null, "a product without a barcode is supported");
});

test("restricted, duplicate-barcode and invalid rows are separated, never imported", () => {
  const result = parseCatalogue(readRecords(csv, "csv"));
  assert.deepEqual(result.rows.map((row) => row.sourceId), ["S-001", "S-002"]);
  assert.equal(result.restricted[0]?.sourceId, "S-003");
  assert.deepEqual(result.conflicts.map((conflict) => [conflict.sourceId, conflict.reason, conflict.otherSourceId]), [["S-004", "DUPLICATE_IN_FILE", "S-001"]]);
  assert.deepEqual(result.errors.map((error) => error.sourceId).sort(), ["S-001", "S-005"]);
});

test("exact money parsing refuses rounding, signs and exponents", () => {
  assert.equal(parseExactMinor("12"), 1200);
  assert.equal(parseExactMinor("12.5"), 1250);
  assert.equal(parseExactMinor("0.07"), 7);
  for (const bad of ["12.345", "-1", "1e3", "12,50", "", "abc"]) assert.equal(parseExactMinor(bad), null, bad);
});

test("JSON numbers for identifiers are refused because leading zeros would be lost", () => {
  const result = parseCatalogue(readRecords(JSON.stringify([{ sourceId: "J-1", name: "Milk", category: "Dairy", price: "5", barcode: 72940001234 }]), "json"));
  assert.equal(result.rows.length, 0);
  assert.match(result.errors[0].errors.join(" "), /barcode must be a string/);
});

test("image mappings need the exact sha256 of the file", () => {
  const bytes = Buffer.from("fake image bytes");
  const sha = createHash("sha256").update(bytes).digest("hex");
  const checked = checkImageMapping(
    [
      { sourceId: "S-001", file: "a.jpg", sha256: sha },
      { sourceId: "S-002", file: "b.jpg", sha256: "0".repeat(64) },
      { sourceId: "S-003", file: "missing.jpg", sha256: sha }
    ],
    (file) => (file === "missing.jpg" ? null : bytes)
  );
  assert.deepEqual([...checked.valid.keys()], ["S-001"]);
  assert.deepEqual(checked.problems.map((problem) => problem.sourceId), ["S-002", "S-003"]);
});

test("only localhost runs without the production flag and the exact confirmation token", () => {
  assert.equal(isLocalDatabaseUrl("postgresql://u@localhost:5433/jovo_test"), true);
  assert.equal(isLocalDatabaseUrl("postgresql://u@db.railway.internal:5432/railway"), false);
  const remote = "postgresql://u@db.example.test:5432/prod";
  const base = { databaseUrl: remote, restaurantId: "r1", fileSha256: "abc" };
  assert.throws(() => assertTargetAllowed({ ...base, production: false }), /non-local/);
  assert.throws(() => assertTargetAllowed({ ...base, production: true, confirm: "IMPORT-WRONG" }), /does not match/);
  const token = confirmationToken(remote, "r1", "abc");
  assert.doesNotThrow(() => assertTargetAllowed({ ...base, production: true, confirm: token }));
  assert.notEqual(confirmationToken(remote, "r1", "other-file"), token, "a token is bound to the file");
  assert.doesNotThrow(() => assertTargetAllowed({ databaseUrl: "postgresql://u@127.0.0.1/x", restaurantId: "r1", fileSha256: "abc", production: false }));
});

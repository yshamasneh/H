import assert from "node:assert/strict";
import { test } from "node:test";
import { buildCatalogueReport, parseCsv, reportToCsv } from "./restricted-catalogue-report";

const csv = [
  "﻿sku,name,category,price,costPrice,description,brand",
  "JOVO-0001,البينار جبنة مغلية 500 غم,ألبان وأجبان,24.00,18.00,,",
  'JOVO-0900,"Marlboro Red, 20",دخان,25.00,20.00,,Marlboro',
  "JOVO-0901,معسل تفاحتين,معسل,30.00,25.00,,",
  "JOVO-0902,بيرة شعير بدون كحول,المشروبات,6.00,4.00,,",
  "JOVO-1361,بامبرز بيبي دراي رقم 6,الأطفال,45.00,38.00,,"
].join("\r\n");

test("the report lists blocked and review rows with their CSV line, and nothing else", () => {
  const report = buildCatalogueReport(csv);
  assert.equal(report.totalRows, 5);
  assert.deepEqual(report.blocked.map((row) => [row.line, row.sku]), [[3, "JOVO-0900"], [4, "JOVO-0901"]]);
  assert.deepEqual(report.review.map((row) => [row.line, row.sku]), [[5, "JOVO-0902"]]);
});

test("the CSV parser handles quotes, embedded commas and the BOM", () => {
  const rows = parseCsv(csv);
  assert.equal(rows[0]![0], "sku");
  assert.equal(rows[2]![1], "Marlboro Red, 20");
});

test("the report CSV starts with a BOM and escapes commas", () => {
  const output = reportToCsv(buildCatalogueReport(csv));
  assert.ok(output.startsWith("﻿verdict,line,sku,name,category,matches"));
  assert.match(output, /BLOCKED,3,JOVO-0900,"Marlboro Red, 20"/);
});

test("a file without a name column is rejected rather than silently reported clean", () => {
  assert.throws(() => buildCatalogueReport("sku,price\nA,1"), /no 'name' column/);
});

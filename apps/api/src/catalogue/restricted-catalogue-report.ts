import { classifyRestricted, type RestrictedVerdict } from "./restricted-products.rules";

/**
 * Builds the restricted-product report for an exported catalogue (store audit H6). Pure: the CLI in
 * apps/api/scripts/restricted-catalogue-report.ts reads the file and writes the result. It never
 * changes or deletes anything — the owner decides what to do with each flagged product.
 */

export type CatalogueReportRow = {
  line: number;
  sku: string;
  name: string;
  category: string;
  verdict: Exclude<RestrictedVerdict, "ALLOWED">;
  matches: string[];
};

export type CatalogueReport = {
  totalRows: number;
  blocked: CatalogueReportRow[];
  review: CatalogueReportRow[];
};

/** A small RFC 4180 parser: quoted fields, "" escapes, commas and newlines inside quotes, BOM stripped. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const source = text.replace(/^﻿/, "").replace(/\r\n/g, "\n");
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]!;
    if (inQuotes) {
      if (char === '"' && source[index + 1] === '"') {
        field += '"';
        index += 1;
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
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((cells) => !(cells.length === 1 && cells[0]!.trim() === ""));
}

/**
 * Screens every row of a catalogue CSV. Accepts the import template's columns (sku, name, category,
 * description, brand) and tolerates a missing column; any extra columns are ignored.
 */
export function buildCatalogueReport(csvText: string): CatalogueReport {
  const [header = [], ...dataRows] = parseCsv(csvText);
  const column = (name: string) => header.findIndex((cell) => cell.trim().toLowerCase() === name.toLowerCase());
  const indexes = {
    sku: column("sku"),
    name: column("name"),
    category: column("category"),
    description: column("description"),
    brand: column("brand")
  };
  if (indexes.name === -1) throw new Error("The CSV has no 'name' column.");
  const cell = (cells: string[], index: number) => (index === -1 ? "" : (cells[index] ?? "").trim());

  const report: CatalogueReport = { totalRows: dataRows.length, blocked: [], review: [] };
  dataRows.forEach((cells, offset) => {
    const name = cell(cells, indexes.name);
    const category = cell(cells, indexes.category);
    const screening = classifyRestricted(name, cell(cells, indexes.brand), cell(cells, indexes.description), category);
    if (screening.verdict === "ALLOWED") return;
    const row: CatalogueReportRow = {
      line: offset + 2,
      sku: cell(cells, indexes.sku),
      name,
      category,
      verdict: screening.verdict,
      matches: screening.matches
    };
    (screening.verdict === "BLOCKED" ? report.blocked : report.review).push(row);
  });
  return report;
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** The report as CSV (UTF-8 with BOM so spreadsheet apps show Arabic correctly). */
export function reportToCsv(report: CatalogueReport): string {
  const lines = ["verdict,line,sku,name,category,matches"];
  for (const row of [...report.blocked, ...report.review]) {
    lines.push([row.verdict, String(row.line), row.sku, row.name, row.category, row.matches.join(" | ")].map(csvCell).join(","));
  }
  return `﻿${lines.join("\n")}\n`;
}

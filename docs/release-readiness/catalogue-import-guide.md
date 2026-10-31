# Catalogue import guide (run 3)

The importer is `apps/api/scripts/catalogue-import.ts` (logic in `apps/api/src/catalogue/catalogue-import.ts`). **Nothing in this run was imported into production.** Everything below the "Production" heading is for a later, approved run by the owner.

## What it does

| Rule | Behaviour |
|---|---|
| Default mode | **Dry-run.** Nothing is written without `--apply`. |
| Target | Refuses any `DATABASE_URL` whose host is not `localhost`, `127.0.0.1` or `::1`, unless `--production` **and** `--confirm <token>` are both given. The token binds the database host and name, the store id and the SHA-256 of the input file. |
| Identity | Each row needs a stable `sourceId`, stored as `MenuItem.importSourceId` (unique per store). Re-runs find products by it. |
| Barcodes, SKU, ids | Kept as strings exactly as written (leading zeros kept). In JSON input they must be quoted strings; a JSON number is refused. Products without a barcode are supported. |
| Prices | `price` and optional `costPrice` in shekels with at most two decimals (`6.5`, `6.50`). More decimals, signs, commas or exponents are refused, never rounded. Stored in agorot exactly. A supermarket product without `costPrice` is imported but cannot be sold until a cost is set (existing rule). |
| New products | Created `reviewStatus = PENDING_REVIEW`, hidden from customers until an admin approves them in the admin web page **Product review**. |
| Updates | An unedited imported product is updated when the file changes; its review status is kept. |
| Hand edits | If an imported product was edited in the app or admin since the last import, it is **not** overwritten (`MANUALLY_EDITED`). |
| Restricted goods | Tobacco, nicotine, vaping and alcohol rows are **never imported**; they are listed in `restricted-not-imported.json`. |
| Barcode conflicts | Two rows with one barcode, or a barcode already used by another product in the store → `conflicts.json`; nothing is overwritten. Same for SKUs. |
| Images | Optional `--images map.csv` with `sourceId,file,sha256`. A file is used only if it exists and its SHA-256 matches. With `--image-base-url`, the product's `imageUrl` becomes `<base>/<file name>`. **The importer does not upload files**; upload them to the image storage first (owner, with storage credentials). Products without images are fine. |
| Categories | Missing category names are created (active). |
| Logs and reports | In `--report-dir` (default `./catalogue-import-<timestamp>`): `log.jsonl` (one line per row), `outcomes.json`, `invalid-rows.json`, `restricted-not-imported.json`, `conflicts.json`, `image-problems.json`. |
| Retry | Each product is written in its own transaction. After a crash, run the same command again: finished rows report `UNCHANGED`, the rest are written. No duplicates (unique `restaurantId + importSourceId`). |

Input columns (CSV header or JSON keys): `sourceId, name, category, price, costPrice, barcode, sku, brand, description, unitLabel`. Examples: `apps/api/scripts/fixtures/catalogue-import-example.csv` and `catalogue-images-example.csv` (synthetic).

## Local run (safe, what was tested here)

From `apps/api`, with a local PostgreSQL whose name contains `test`, migrations applied:

```bash
npx prisma migrate deploy
```

```bash
npx tsx scripts/catalogue-import.ts --restaurant-id <local-store-uuid> --file scripts/fixtures/catalogue-import-example.csv --report-dir ./import-reports
```

```bash
npx tsx scripts/catalogue-import.ts --restaurant-id <local-store-uuid> --file scripts/fixtures/catalogue-import-example.csv --report-dir ./import-reports --apply
```

Tests (run here; see `cloud-run-log.md`): `src/catalogue/catalogue-import.test.ts` (unit) and `src/integration/catalogue-import.e2e.test.ts` (PostgreSQL, `RUN_DATABASE_E2E=true`).

## Production checklist (owner, later; not done)

1. The API with migrations `20261102090000_add_menu_item_review_status` and `20261102100000_add_menu_item_import_source` is deployed (both additive).
2. The file comes from Khaldoun, is UTF-8, uses one `sourceId` per product that will never change, and passed a local dry-run against a **copy** of production (restore a backup into a local database).
3. `restricted-not-imported.json` and `conflicts.json` from the dry-run were reviewed and the file corrected.
4. Images are uploaded to the image storage and the mapping hashes verified locally.
5. A fresh production backup exists and a restore was tested (see `docs/railway-setup.md`; do not change `deploy/railway/**`).
6. The run is scheduled outside opening hours; Khaldoun is available to review the PENDING_REVIEW queue afterwards.

## Production commands (for a later approved run only)

```bash
npx tsx scripts/catalogue-import.ts --restaurant-id <JOVO MARKET id> --file catalogue.csv --print-confirmation-token
```

(prints `IMPORT-…` offline; no connection is made). Then a production dry-run:

```bash
npx tsx scripts/catalogue-import.ts --restaurant-id <JOVO MARKET id> --file catalogue.csv --images images.csv --image-base-url <public image base URL> --report-dir ./prod-dry-run --production --confirm IMPORT-XXXXXXXXXXXX
```

Review the reports, then the same command with `--apply` and a new `--report-dir`.

`DATABASE_URL` must be supplied in your own shell for that run only; never commit it.

## Backup and rollback

- **Before:** take a backup (the Railway backup job or `npm run db:backup` from the repo root, as documented in its script).
- **Undo new products only:** every imported product has `importSourceId` set and is `PENDING_REVIEW` until approved, so nothing reached customers. Products with no orders can be removed in the admin (delete is refused for ordered products by design). A bulk removal of never-ordered, never-approved imported rows would be:
  `DELETE FROM "MenuItem" WHERE "restaurantId" = '<id>' AND "importSourceId" IS NOT NULL AND "reviewStatus" = 'PENDING_REVIEW' AND id NOT IN (SELECT "menuItemId" FROM "OrderItem");`
  Run it only after checking it with `SELECT` first, inside a transaction.
- **Undo updates to existing products:** restore from the backup taken before the run (the importer does not keep old values), or correct by hand using `outcomes.json` (lists every `UPDATED` product id).

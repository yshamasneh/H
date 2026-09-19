import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "../../api";
import {
  listInventoryMovements,
  lookupInventoryBarcode,
  type InventoryMovement,
  type InventoryRow
} from "../../api.business";

/**
 * The two inventory tools the mobile client had and this console lacked: finding a product by its
 * barcode, and reading the stock ledger — every reservation, return, adjustment and receipt, with
 * the balance it left behind — so "why is the count 12?" has an answer.
 */

const pageSize = 20;

export function BarcodeLookup({ onShowHistory }: { onShowHistory: (product: InventoryRow) => void }) {
  const { t } = useTranslation();
  const [barcode, setBarcode] = useState("");
  const [found, setFound] = useState<InventoryRow | null>(null);
  const [error, setError] = useState<string | null>(null);

  const lookup = async () => {
    setFound(null);
    setError(null);
    if (!barcode.trim()) return;
    try {
      setFound(await lookupInventoryBarcode(barcode));
    } catch (requestError) {
      setError(
        requestError instanceof ApiError && requestError.statusCode === 404
          ? t("inventory.barcodeNotFound")
          : requestError instanceof ApiError
            ? requestError.message
            : t("common.genericActionError")
      );
    }
  };

  return (
    <div className="card">
      <h2 className="card-title">{t("inventory.barcodeTitle")}</h2>
      <form
        className="filters-row"
        onSubmit={(event) => {
          // A barcode scanner types the code and presses Enter.
          event.preventDefault();
          void lookup();
        }}
      >
        <input
          className="text-input"
          dir="ltr"
          onChange={(event) => setBarcode(event.target.value)}
          placeholder={t("inventory.barcodePlaceholder")}
          value={barcode}
        />
        <button className="btn btn-outline btn-sm" type="submit">
          {t("inventory.barcodeLookup")}
        </button>
      </form>
      {error ? <div className="error-banner">{error}</div> : null}
      {found ? (
        <div className="notice-banner">
          {t("inventory.barcodeResult", { name: found.name, stock: found.stockQuantity ?? t("common.dash") })}{" "}
          <button className="btn btn-outline btn-sm" onClick={() => onShowHistory(found)} type="button">
            {t("inventory.barcodeOpenHistory")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function MovementsCard({
  product,
  products,
  onProductChange,
  reloadToken
}: {
  product: InventoryRow | null;
  products: InventoryRow[];
  onProductChange: (menuItemId: string | null) => void;
  /** Bumped when stock changes elsewhere on the page, so the ledger refetches. */
  reloadToken: number;
}) {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<InventoryMovement[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const productId = product?.id;

  useEffect(() => {
    setPage(1);
  }, [productId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await listInventoryMovements({ menuItemId: productId, page, pageSize });
        if (cancelled) return;
        setRows(result.items);
        setTotal(result.total);
        setError(null);
      } catch (requestError) {
        if (!cancelled) setError(requestError instanceof ApiError ? requestError.message : t("inventory.movementsLoadError"));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [productId, page, reloadToken]);

  const pages = Math.max(1, Math.ceil(total / pageSize));
  // A product opened from the barcode box may not be on the current stock page; keep it selectable.
  const options = product && !products.some((row) => row.id === product.id) ? [product, ...products] : products;

  return (
    <div className="card" id="inventory-movements">
      <h2 className="card-title">
        {product ? t("inventory.movementsFor", { name: product.name }) : t("inventory.movementsTitle")}
      </h2>
      <div className="filters-row">
        <select
          aria-label={t("inventory.product")}
          className="select"
          onChange={(event) => onProductChange(event.target.value || null)}
          value={productId ?? ""}
        >
          <option value="">{t("inventory.allProducts")}</option>
          {options.map((row) => (
            <option key={row.id} value={row.id}>
              {row.name}
            </option>
          ))}
        </select>
      </div>
      {error ? <div className="error-banner">{error}</div> : null}
      {rows === null ? (
        error ? null : <div className="loading-state">{t("common.loading")}</div>
      ) : rows.length === 0 ? (
        <div className="empty-state">{t("inventory.movementsEmpty")}</div>
      ) : (
        <>
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t("inventory.when")}</th>
                  <th>{t("inventory.product")}</th>
                  <th>{t("inventory.movementType")}</th>
                  <th>{t("inventory.change")}</th>
                  <th>{t("inventory.stockAfter")}</th>
                  <th>{t("inventory.reason")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>{new Date(row.createdAt).toLocaleString()}</td>
                    <td>{row.menuItem.name}</td>
                    <td>{t(`inventory.movement.${row.type}`, row.type)}</td>
                    <td className={`money${row.quantityDelta < 0 ? " money-negative" : ""}`}>
                      {row.quantityDelta > 0 ? `+${row.quantityDelta}` : row.quantityDelta}
                    </td>
                    <td className="money">{row.stockAfter}</td>
                    <td>{row.reason ?? t("common.dash")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="pagination-row">
            <button className="btn btn-outline btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)} type="button">
              {t("common.previous")}
            </button>
            <span>{t("common.pageOf", { page, pages })}</span>
            <button className="btn btn-outline btn-sm" disabled={page >= pages} onClick={() => setPage(page + 1)} type="button">
              {t("common.next")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

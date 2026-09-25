import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError, readApiError } from "../../api";
import {
  adjustInventory,
  cancelPurchaseOrder,
  createPurchaseOrder,
  createSupplier,
  listInventory,
  listPurchaseOrders,
  listSuppliers,
  receivePurchaseOrder,
  type InventoryRow,
  type PurchaseOrderView,
  type Supplier
} from "../../api.business";
import { parsePositiveMoneyToMinor, parseWholeNumber } from "../../money";
import { BarcodeLookup, MovementsCard } from "./InventoryMovements";

const currencyCode = "ILS";
const stockPageSize = 30;

/**
 * Stock, suppliers, and purchasing for a supermarket. The API for all of this already existed with
 * no interface at all, so this screen is mostly wiring rather than new behaviour.
 */
export function InventoryPage() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrderView[]>([]);
  const [search, setSearch] = useState("");
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [supplierName, setSupplierName] = useState("");
  // The unit cost is typed in shekels, like everywhere else in the console; it is converted to minor
  // units exactly once, when the purchase order is built.
  const [draft, setDraft] = useState({ supplierId: "", menuItemId: "", quantity: "", unitCost: "" });
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [historyProduct, setHistoryProduct] = useState<InventoryRow | null>(null);
  const [movementsToken, setMovementsToken] = useState(0);

  async function load() {
    try {
      const [inventory, nextSuppliers, nextOrders] = await Promise.all([
        listInventory({ search: search || undefined, lowStock: lowStockOnly || undefined, page, pageSize: stockPageSize }),
        listSuppliers(),
        listPurchaseOrders()
      ]);
      setRows(inventory.items);
      setTotal(inventory.total);
      setSuppliers(nextSuppliers);
      setPurchaseOrders(nextOrders);
      setError(null);
    } catch (requestError) {
      setError(readApiError(requestError, t("inventory.loadError")));
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, lowStockOnly, page]);

  // A new search or filter starts again from the first page.
  useEffect(() => {
    setPage(1);
  }, [search, lowStockOnly]);

  async function run(action: () => Promise<unknown>) {
    try {
      await action();
      await load();
      setMovementsToken((token) => token + 1);
      setError(null);
    } catch (requestError) {
      setError(readApiError(requestError, t("common.genericActionError")));
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{t("inventory.title")}</h1>
          <p className="page-subtitle">{t("inventory.subtitle")}</p>
        </div>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}

      <BarcodeLookup
        onShowHistory={(product) => {
          setHistoryProduct(product);
          document.getElementById("inventory-movements")?.scrollIntoView({ behavior: "smooth" });
        }}
      />

      <div className="card">
        <h2 className="card-title">{t("inventory.stock")}</h2>
        <div className="filters-row">
          <input
            className="text-input"
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t("inventory.searchPlaceholder")}
            value={search}
          />
          <button className="btn btn-outline btn-sm" onClick={() => setLowStockOnly(!lowStockOnly)} type="button">
            {lowStockOnly ? t("inventory.showAll") : t("inventory.showLowStock")}
          </button>
        </div>
        {rows.length === 0 ? (
          <div className="empty-state">{t("inventory.empty")}</div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t("common.name")}</th>
                  <th>{t("inventory.sku")}</th>
                  <th>{t("inventory.onHand")}</th>
                  <th>{t("inventory.reorderLevel")}</th>
                  <th>{t("inventory.adjust")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>{row.name}</td>
                    <td>{row.sku ?? t("common.dash")}</td>
                    <td className="num">{row.stockQuantity ?? t("common.dash")}</td>
                    <td className="num">{row.reorderLevel ?? t("common.dash")}</td>
                    <td>
                      <AdjustStockControl
                        onSubmit={(quantityDelta, reason) => run(() => adjustInventory(row.id, { quantityDelta, reason }))}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {total > stockPageSize ? (
          <div className="pagination-row">
            <button className="btn btn-outline btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)} type="button">
              {t("common.previous")}
            </button>
            <span>{t("common.pageOf", { page, pages: Math.ceil(total / stockPageSize) })}</span>
            <button
              className="btn btn-outline btn-sm"
              disabled={page >= Math.ceil(total / stockPageSize)}
              onClick={() => setPage(page + 1)}
              type="button"
            >
              {t("common.next")}
            </button>
          </div>
        ) : null}
      </div>

      <div className="card">
        <h2 className="card-title">{t("inventory.suppliers")}</h2>
        <div className="filters-row">
          <input
            className="text-input"
            onChange={(event) => setSupplierName(event.target.value)}
            placeholder={t("inventory.newSupplierPlaceholder")}
            value={supplierName}
          />
          <button
            className="btn btn-primary btn-sm"
            disabled={!supplierName.trim()}
            onClick={() =>
              void run(async () => {
                await createSupplier({ name: supplierName.trim() });
                setSupplierName("");
              })
            }
            type="button"
          >
            {t("inventory.addSupplier")}
          </button>
        </div>
        {suppliers.length === 0 ? (
          <div className="empty-state">{t("inventory.noSuppliers")}</div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t("common.name")}</th>
                  <th>{t("common.phone")}</th>
                  <th>{t("common.status")}</th>
                </tr>
              </thead>
              <tbody>
                {suppliers.map((supplier) => (
                  <tr key={supplier.id}>
                    <td>{supplier.name}</td>
                    <td>{supplier.phone ?? t("common.dash")}</td>
                    <td>{supplier.isActive ? t("common.active") : t("common.inactive")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h2 className="card-title">{t("inventory.purchaseOrders")}</h2>
        {suppliers.length > 0 && rows.length > 0 ? (
          <div className="filters-row">
            <select
              className="select"
              onChange={(event) => setDraft({ ...draft, supplierId: event.target.value })}
              value={draft.supplierId || suppliers[0].id}
            >
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </select>
            <select
              className="select"
              onChange={(event) => setDraft({ ...draft, menuItemId: event.target.value })}
              value={draft.menuItemId || rows[0].id}
            >
              {rows.map((row) => (
                <option key={row.id} value={row.id}>
                  {row.name}
                </option>
              ))}
            </select>
            <input
              className="text-input"
              onChange={(event) => setDraft({ ...draft, quantity: event.target.value })}
              placeholder={t("inventory.quantity")}
              inputMode="numeric"
              value={draft.quantity}
            />
            <input
              className="text-input"
              onChange={(event) => setDraft({ ...draft, unitCost: event.target.value })}
              placeholder={t("inventory.unitCostShekel")}
              dir="ltr"
              inputMode="decimal"
              value={draft.unitCost}
            />
            <button
              className="btn btn-primary btn-sm"
              disabled={!draft.quantity || !draft.unitCost}
              onClick={() =>
                void run(async () => {
                  const quantity = parseWholeNumber(draft.quantity, 1);
                  const unitCostMinor = parsePositiveMoneyToMinor(draft.unitCost);
                  if (quantity === null) throw new ApiError(400, "INVALID_QUANTITY", t("inventory.invalidQuantity"));
                  if (unitCostMinor === null) throw new ApiError(400, "INVALID_COST", t("inventory.invalidCost"));
                  await createPurchaseOrder({
                    supplierId: draft.supplierId || suppliers[0].id,
                    items: [{ menuItemId: draft.menuItemId || rows[0].id, quantity, unitCostMinor }]
                  });
                  setDraft({ supplierId: "", menuItemId: "", quantity: "", unitCost: "" });
                })
              }
              type="button"
            >
              {t("inventory.createPurchaseOrder")}
            </button>
          </div>
        ) : (
          <div className="empty-state">{t("inventory.purchaseOrderPrerequisites")}</div>
        )}
        {purchaseOrders.length === 0 ? (
          <div className="empty-state">{t("inventory.noPurchaseOrders")}</div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>{t("inventory.reference")}</th>
                  <th>{t("common.status")}</th>
                  <th>{t("inventory.totalCost")}</th>
                  <th>{t("common.actions")}</th>
                </tr>
              </thead>
              <tbody>
                {purchaseOrders.map((purchaseOrder) => (
                  <tr key={purchaseOrder.id}>
                    <td>{purchaseOrder.reference ?? purchaseOrder.id.slice(0, 8).toUpperCase()}</td>
                    <td>{t(`purchaseOrderStatus.${purchaseOrder.status}`, purchaseOrder.status)}</td>
                    <td className="num">{formatPrice(purchaseOrder.totalCostMinor)}</td>
                    <td>
                      {purchaseOrder.status === "DRAFT" ? (
                        <div className="filters-row" style={{ margin: 0 }}>
                          <button
                            className="btn btn-primary btn-sm"
                            onClick={() => void run(() => receivePurchaseOrder(purchaseOrder.id))}
                            type="button"
                          >
                            {t("inventory.receive")}
                          </button>
                          <button
                            className="btn btn-danger btn-sm"
                            onClick={() => void run(() => cancelPurchaseOrder(purchaseOrder.id))}
                            type="button"
                          >
                            {t("common.cancel")}
                          </button>
                        </div>
                      ) : (
                        t("common.dash")
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <MovementsCard
        onProductChange={(menuItemId) => setHistoryProduct(rows.find((row) => row.id === menuItemId) ?? null)}
        product={historyProduct}
        products={rows}
        reloadToken={movementsToken}
      />
    </div>
  );
}

function AdjustStockControl({ onSubmit }: { onSubmit: (quantityDelta: number, reason: string) => Promise<void> }) {
  const { t } = useTranslation();
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");

  return (
    <div className="filters-row" style={{ margin: 0 }}>
      <input
        className="text-input"
        onChange={(event) => setDelta(event.target.value)}
        placeholder={t("inventory.delta")}
        style={{ maxWidth: 90 }}
        type="number"
        value={delta}
      />
      <input
        className="text-input"
        onChange={(event) => setReason(event.target.value)}
        placeholder={t("inventory.reason")}
        style={{ maxWidth: 160 }}
        value={reason}
      />
      <button
        className="btn btn-outline btn-sm"
        disabled={!Number.isInteger(Number(delta)) || Number(delta) === 0 || !reason.trim()}
        onClick={() =>
          void onSubmit(Number(delta), reason.trim()).then(() => {
            setDelta("");
            setReason("");
          })
        }
        type="button"
      >
        {t("inventory.apply")}
      </button>
    </div>
  );
}

function formatPrice(priceMinor: number): string {
  return `${(priceMinor / 100).toFixed(2)} ${currencyCode}`;
}

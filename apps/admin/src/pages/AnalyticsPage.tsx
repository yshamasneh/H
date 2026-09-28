import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { readApiError } from "../api";
import {
  getCustomerRetention,
  getPeakTimes,
  getTopProducts,
  type AnalyticsPeriodParams,
  type CustomerRetentionView,
  type PeakTimesView,
  type TopProductsView
} from "../api.analytics";
import {
  barPercent,
  busiest,
  formatQuantityMilli,
  formatRateBp,
  heatStep,
  periodPresets,
  presetRange,
  weekdayDisplayOrder,
  type PeriodPreset
} from "../analytics-view";
import { Money } from "../components/Money";

type Loaded<T> = { data: T | null; error: string | null };
const empty = { data: null, error: null };

/**
 * Super-admin analytics: best sellers, busy times in Hebron local time, and how many customers come
 * back. Every figure counts DELIVERED orders only, and every figure is computed by the API in SQL;
 * this page only lays the numbers out.
 */
export function AnalyticsPage() {
  const { t } = useTranslation();
  const [preset, setPreset] = useState<PeriodPreset>("last30");
  const [custom, setCustom] = useState({ fromDate: "", toDate: "" });
  const [sortBy, setSortBy] = useState<"quantity" | "revenue">("quantity");
  const [products, setProducts] = useState<Loaded<TopProductsView>>(empty);
  const [peak, setPeak] = useState<Loaded<PeakTimesView>>(empty);
  const [retention, setRetention] = useState<Loaded<CustomerRetentionView>>(empty);

  const period: AnalyticsPeriodParams =
    preset === "custom"
      ? { fromDate: custom.fromDate || undefined, toDate: custom.toDate || undefined }
      : presetRange(preset, new Date());
  const periodKey = `${period.fromDate ?? ""}|${period.toDate ?? ""}`;

  useEffect(() => {
    let cancelled = false;
    setPeak(empty);
    setRetention(empty);
    getPeakTimes(period)
      .then((data) => !cancelled && setPeak({ data, error: null }))
      .catch((error) => !cancelled && setPeak({ data: null, error: readApiError(error, t("analytics.loadError")) }));
    getCustomerRetention(period)
      .then((data) => !cancelled && setRetention({ data, error: null }))
      .catch((error) => !cancelled && setRetention({ data: null, error: readApiError(error, t("analytics.loadError")) }));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodKey]);

  useEffect(() => {
    let cancelled = false;
    setProducts(empty);
    getTopProducts({ ...period, sortBy, limit: 20 })
      .then((data) => !cancelled && setProducts({ data, error: null }))
      .catch((error) => !cancelled && setProducts({ data: null, error: readApiError(error, t("analytics.loadError")) }));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [periodKey, sortBy]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">{t("analytics.title")}</h1>
          <p className="page-subtitle">{t("analytics.subtitle")}</p>
        </div>
      </div>

      <div className="card">
        <div className="tab-row" role="tablist" style={{ margin: 0 }}>
          {periodPresets.map((key) => (
            <button
              aria-selected={key === preset}
              className={`btn btn-sm ${key === preset ? "btn-primary" : "btn-outline"}`}
              key={key}
              onClick={() => setPreset(key)}
              role="tab"
              type="button"
            >
              {t(`analytics.presets.${key}`)}
            </button>
          ))}
        </div>
        {preset === "custom" ? (
          <div className="filters-row" style={{ marginTop: 12, marginBottom: 0 }}>
            <label className="analytics-date">
              <span>{t("analytics.from")}</span>
              <input
                className="text-input"
                onChange={(event) => setCustom({ ...custom, fromDate: event.target.value })}
                type="date"
                value={custom.fromDate}
              />
            </label>
            <label className="analytics-date">
              <span>{t("analytics.to")}</span>
              <input
                className="text-input"
                onChange={(event) => setCustom({ ...custom, toDate: event.target.value })}
                type="date"
                value={custom.toDate}
              />
            </label>
          </div>
        ) : null}
        <p className="stat-hint" style={{ marginBottom: 0 }}>
          {period.fromDate || period.toDate
            ? t("analytics.periodRange", { from: period.fromDate ?? "…", to: period.toDate ?? "…" })
            : t("analytics.periodAll")}{" "}
          · {t("analytics.deliveredOnly")}
        </p>
      </div>

      <RetentionSection state={retention} />
      <PeakSection state={peak} />
      <TopProductsSection onSort={setSortBy} sortBy={sortBy} state={products} />
    </div>
  );
}

function SectionState<T>({ state, children }: { state: Loaded<T>; children: (data: T) => ReactNode }) {
  const { t } = useTranslation();
  if (state.error) return <div className="error-banner">{state.error}</div>;
  if (!state.data) return <div className="loading-state">{t("common.loading")}</div>;
  return <>{children(state.data)}</>;
}

function RetentionSection({ state }: { state: Loaded<CustomerRetentionView> }) {
  const { t } = useTranslation();
  return (
    <section className="card" aria-labelledby="analytics-retention">
      <h2 className="card-title" id="analytics-retention">{t("analytics.retention.title")}</h2>
      <SectionState state={state}>
        {(data) =>
          data.customers === 0 ? (
            <div className="empty-state">{t("analytics.noOrders")}</div>
          ) : (
            <>
              <div className="stat-grid" style={{ marginBottom: 16 }}>
                <Tile hint={t("analytics.retention.rateHint")} label={t("analytics.retention.rate")} value={formatRateBp(data.returningRateBp)} />
                <Tile
                  hint={t("analytics.retention.returningHint", { orders: data.ordersFromReturningCustomers })}
                  label={t("analytics.retention.returning")}
                  value={String(data.returningCustomers)}
                />
                <Tile hint={t("analytics.retention.oneTimeHint")} label={t("analytics.retention.oneTime")} value={String(data.oneTimeCustomers)} />
                <Tile
                  hint={t("analytics.retention.customersHint", { orders: data.deliveredOrders })}
                  label={t("analytics.retention.customers")}
                  value={String(data.customers)}
                />
              </div>
              {/* A single ratio against its whole: a meter, the returning share in the accent. */}
              <div
                aria-label={t("analytics.retention.meterLabel", {
                  returning: data.returningCustomers,
                  total: data.customers,
                  rate: formatRateBp(data.returningRateBp)
                })}
                className="meter"
                role="img"
                title={formatRateBp(data.returningRateBp)}
              >
                <div className="meter-fill" style={{ width: `${data.returningRateBp / 100}%` }} />
              </div>
              <div className="meter-legend">
                <span>
                  <i className="swatch swatch-accent" /> {t("analytics.retention.returning")} · {data.returningCustomers}
                </span>
                <span>
                  <i className="swatch swatch-track" /> {t("analytics.retention.oneTime")} · {data.oneTimeCustomers}
                </span>
              </div>
            </>
          )
        }
      </SectionState>
    </section>
  );
}

function Tile(props: { label: string; value: string; hint: string }) {
  return (
    <div className="stat-card">
      <div className="stat-label">{props.label}</div>
      <div className="stat-value num">{props.value}</div>
      <div className="stat-hint">{props.hint}</div>
    </div>
  );
}

const hourLabel = (hour: number) => `${String(hour).padStart(2, "0")}:00`;

function PeakSection({ state }: { state: Loaded<PeakTimesView> }) {
  const { t } = useTranslation();
  const [readout, setReadout] = useState<string | null>(null);
  const weekdayName = (weekday: number) => t(`analytics.weekdays.${weekday}`);

  return (
    <section className="card" aria-labelledby="analytics-peak">
      <h2 className="card-title" id="analytics-peak">{t("analytics.peak.title")}</h2>
      <p className="page-subtitle">{t("analytics.peak.subtitle")}</p>
      <SectionState state={state}>
        {(data) => {
          if (data.totalOrders === 0) return <div className="empty-state">{t("analytics.noOrders")}</div>;
          const maxHour = Math.max(...data.byHour.map((row) => row.orders));
          const maxWeekday = Math.max(...data.byWeekday.map((row) => row.orders));
          const maxCell = Math.max(...data.byWeekdayHour.flat());
          const hourReadout = (hour: number, orders: number) => t("analytics.peak.hourReadout", { hour: hourLabel(hour), orders });
          return (
            <>
              <p className="analytics-summary">
                {t("analytics.peak.busiestHour", { hours: busiest(data.byHour).map((row) => hourLabel(row.hour)).join(t("analytics.listSeparator")) })}
                {" · "}
                {t("analytics.peak.busiestDay", { days: busiest(data.byWeekday).map((row) => weekdayName(row.weekday)).join(t("analytics.listSeparator")) })}
              </p>

              <h3 className="analytics-chart-title">{t("analytics.peak.byHour")}</h3>
              <div aria-live="polite" className="analytics-readout">{readout ?? t("analytics.peak.hoverHint")}</div>
              {/* Clock time reads left to right in both languages, so the hour axis does too. */}
              <div className="chart-columns" dir="ltr" role="list">
                {data.byHour.map((row) => (
                  <div
                    aria-label={hourReadout(row.hour, row.orders)}
                    className="chart-col"
                    key={row.hour}
                    onBlur={() => setReadout(null)}
                    onFocus={() => setReadout(hourReadout(row.hour, row.orders))}
                    onMouseEnter={() => setReadout(hourReadout(row.hour, row.orders))}
                    onMouseLeave={() => setReadout(null)}
                    role="listitem"
                    tabIndex={0}
                    title={hourReadout(row.hour, row.orders)}
                  >
                    <div className="chart-col-plot">
                      <div className="chart-col-bar" style={{ height: `${barPercent(row.orders, maxHour)}%` }} />
                    </div>
                    <span className="chart-col-label">{row.hour % 3 === 0 ? String(row.hour).padStart(2, "0") : ""}</span>
                  </div>
                ))}
              </div>

              <h3 className="analytics-chart-title">{t("analytics.peak.byWeekday")}</h3>
              <div className="hbar-list" role="list">
                {weekdayDisplayOrder.map((weekday) => {
                  const orders = data.byWeekday[weekday].orders;
                  return (
                    <div className="hbar-row" key={weekday} role="listitem" title={t("analytics.peak.dayReadout", { day: weekdayName(weekday), orders })}>
                      <span className="hbar-label">{weekdayName(weekday)}</span>
                      <div className="hbar-track">
                        <div className="hbar-fill" style={{ width: `${barPercent(orders, maxWeekday)}%` }} />
                      </div>
                      <span className="hbar-value num">{orders}</span>
                    </div>
                  );
                })}
              </div>

              <h3 className="analytics-chart-title">{t("analytics.peak.heatmap")}</h3>
              <div className="table-scroll">
                <table className="heatmap" dir="ltr">
                  <thead>
                    <tr>
                      <th scope="col" />
                      {data.byHour.map((row) => (
                        <th key={row.hour} scope="col">{row.hour % 3 === 0 ? String(row.hour).padStart(2, "0") : ""}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {weekdayDisplayOrder.map((weekday) => (
                      <tr key={weekday}>
                        <th dir="auto" scope="row">{weekdayName(weekday)}</th>
                        {data.byWeekdayHour[weekday].map((orders, hour) => {
                          const label = t("analytics.peak.cellReadout", { day: weekdayName(weekday), hour: hourLabel(hour), orders });
                          return (
                            <td
                              aria-label={label}
                              className={`heat-cell heat-${heatStep(orders, maxCell)}`}
                              key={hour}
                              onMouseEnter={() => setReadout(label)}
                              onMouseLeave={() => setReadout(null)}
                              title={label}
                            />
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="heat-legend" aria-hidden="true">
                <span>{t("analytics.peak.fewer")}</span>
                {[0, 1, 2, 3, 4].map((step) => (
                  <i className={`heat-cell heat-${step}`} key={step} />
                ))}
                <span>{t("analytics.peak.more")}</span>
              </div>

              <details className="analytics-table-view">
                <summary>{t("analytics.showTable")}</summary>
                <div className="table-scroll">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th>{t("analytics.peak.hour")}</th>
                        {weekdayDisplayOrder.map((weekday) => (
                          <th key={weekday}>{weekdayName(weekday)}</th>
                        ))}
                        <th>{t("analytics.peak.total")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.byHour.map((row) => (
                        <tr key={row.hour}>
                          <td dir="ltr">{hourLabel(row.hour)}</td>
                          {weekdayDisplayOrder.map((weekday) => (
                            <td className="num" key={weekday}>{data.byWeekdayHour[weekday][row.hour]}</td>
                          ))}
                          <td className="num">{row.orders}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </>
          );
        }}
      </SectionState>
    </section>
  );
}

function TopProductsSection(props: {
  state: Loaded<TopProductsView>;
  sortBy: "quantity" | "revenue";
  onSort: (sortBy: "quantity" | "revenue") => void;
}) {
  const { t } = useTranslation();
  return (
    <section className="card" aria-labelledby="analytics-products">
      <div className="page-header" style={{ marginBottom: 8 }}>
        <h2 className="card-title" id="analytics-products" style={{ margin: 0 }}>{t("analytics.products.title")}</h2>
        <div className="tab-row" role="tablist" style={{ margin: 0 }}>
          {(["quantity", "revenue"] as const).map((key) => (
            <button
              aria-selected={key === props.sortBy}
              className={`btn btn-sm ${key === props.sortBy ? "btn-primary" : "btn-outline"}`}
              key={key}
              onClick={() => props.onSort(key)}
              role="tab"
              type="button"
            >
              {t(`analytics.products.sortBy.${key}`)}
            </button>
          ))}
        </div>
      </div>
      <p className="page-subtitle">{t("analytics.products.subtitle")}</p>
      <SectionState state={props.state}>
        {(data) => {
          if (data.items.length === 0) return <div className="empty-state">{t("analytics.noOrders")}</div>;
          const metric = (row: TopProductsView["items"][number]) => (data.sortBy === "revenue" ? row.revenueMinor : row.quantityMilli);
          const max = Math.max(...data.items.map(metric));
          return (
            <>
              <div className="stat-grid" style={{ marginBottom: 16 }}>
                <div className="stat-card">
                  <div className="stat-label">{t("analytics.products.revenueTotal")}</div>
                  <div className="stat-value">
                    <Money minor={data.totals.revenueMinor} />
                  </div>
                  <div className="stat-hint">{t("analytics.products.revenueTotalHint")}</div>
                </div>
                <Tile hint={t("analytics.products.ordersHint")} label={t("analytics.products.orders")} value={String(data.totals.deliveredOrders)} />
                <Tile hint={t("analytics.products.productsHint")} label={t("analytics.products.products")} value={String(data.totals.productsSold)} />
              </div>
              <div className="table-scroll">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>{t("analytics.products.product")}</th>
                      <th>{t("analytics.products.quantity")}</th>
                      <th>{t("analytics.products.revenue")}</th>
                      <th>{t("analytics.products.inOrders")}</th>
                      <th aria-hidden="true" style={{ width: "22%" }} />
                    </tr>
                  </thead>
                  <tbody>
                    {data.items.map((row) => (
                      <tr key={row.menuItemId}>
                        <td className="num">{row.rank}</td>
                        <td>{row.name}</td>
                        <td>
                          <span className="num">{formatQuantityMilli(row.quantityMilli)}</span> {row.unitLabel}
                        </td>
                        <td>
                          <Money minor={row.revenueMinor} />
                        </td>
                        <td className="num">{row.orders}</td>
                        <td aria-hidden="true">
                          <div className="hbar-track">
                            <div className="hbar-fill" style={{ width: `${barPercent(metric(row), max)}%` }} />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          );
        }}
      </SectionState>
    </section>
  );
}

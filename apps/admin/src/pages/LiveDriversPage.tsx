import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { ApiError } from "../api";
import { listDriverLocations } from "../api.tracking";
import { StatusBadge } from "../components/StatusBadge";
import { TrackingMap } from "../components/TrackingMap";
import {
  ageLabel,
  applyLocationUpdate,
  freshness,
  hasPosition,
  markerColors,
  sortForList,
  type TrackedDriver
} from "../driver-tracking";
import { useLiveRefresh, useRealtimeEvent } from "../socket";

/**
 * Every driver who is on shift or mid-delivery, on one map.
 *
 * Positions arrive over the socket (`driver.location.updated`) and move the markers directly. The
 * list itself — who is on shift, who holds which delivery — is re-fetched when a shift or delivery
 * event arrives, on reconnect and on tab focus, with a slow poll behind it so a dropped socket
 * shows up as a short delay instead of a map that quietly stops moving.
 */
export function LiveDriversPage() {
  const { t } = useTranslation();
  const [drivers, setDrivers] = useState<TrackedDriver[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [fitSignal, setFitSignal] = useState(0);
  // Re-evaluates freshness as time passes even when no new position arrives: a driver whose phone
  // went quiet has to fade to "stale" on their own.
  const [now, setNow] = useState(() => Date.now());

  async function load() {
    try {
      setDrivers(await listDriverLocations());
      setError(null);
      setNow(Date.now());
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : t("liveDrivers.loadError"));
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => window.clearInterval(timer);
  }, []);

  useRealtimeEvent("driver.location.updated", (payload) => {
    setDrivers((current) => (current ? applyLocationUpdate(current, payload) : current));
    setNow(Date.now());
  });
  useLiveRefresh(["driver.status.changed", "delivery.status.changed"], () => void load(), 60_000);

  const sorted = useMemo(() => (drivers ? sortForList(drivers, now) : []), [drivers, now]);
  const mapped = sorted.filter(hasPosition).length;

  return (
    <div>
      <div className="page-header">
        <div>
          <Link className="btn btn-outline btn-sm" to="/drivers">
            {t("common.back")}
          </Link>
          <h1 className="page-title" style={{ marginTop: 10 }}>{t("liveDrivers.title")}</h1>
          <p className="page-subtitle">{t("liveDrivers.subtitle")}</p>
        </div>
        <button className="btn btn-outline" onClick={() => setFitSignal((value) => value + 1)} type="button">
          {t("liveDrivers.fitAll")}
        </button>
      </div>

      {error ? <div className="error-banner">{error}</div> : null}

      {drivers === null ? (
        <div className="loading-state">{t("common.loading")}</div>
      ) : (
        <div className="detail-grid">
          <div className="card">
            <TrackingMap
              drivers={drivers}
              fitSignal={fitSignal}
              now={now}
              onSelectDriver={setSelected}
              selectedDriverId={selected}
            />
            <p className="page-subtitle" style={{ marginTop: 10 }}>
              {t("liveDrivers.legend")}
            </p>
          </div>

          <div className="card">
            <h2 className="card-title">{t("liveDrivers.onShift", { count: sorted.length, mapped })}</h2>
            {sorted.length === 0 ? (
              <div className="empty-state">{t("liveDrivers.empty")}</div>
            ) : (
              sorted.map((driver) => {
                const state = freshness(driver.lastLocationAt, now);
                const age = ageLabel(driver.lastLocationAt, now);
                return (
                  <button
                    className="kv-row"
                    key={driver.userId}
                    onClick={() => {
                      setSelected(driver.userId);
                      setFitSignal((value) => value + 1);
                    }}
                    style={{
                      background: driver.userId === selected ? "var(--primary-subtle)" : "transparent",
                      border: 0,
                      cursor: "pointer",
                      textAlign: "start",
                      width: "100%"
                    }}
                    type="button"
                  >
                    <span className="kv-label">
                      <span
                        aria-hidden
                        style={{
                          background: markerColors[state],
                          borderRadius: "50%",
                          display: "inline-block",
                          height: 10,
                          marginInlineEnd: 8,
                          width: 10
                        }}
                      />
                      <strong>{driver.fullName}</strong>
                      <br />
                      <small>
                        {driver.activeDelivery
                          ? t("liveDrivers.onDelivery", { store: driver.activeDelivery.restaurantName })
                          : t("liveDrivers.idle")}
                        {" · "}
                        {age ? t(`liveDrivers.age.${age.unit}`, { count: age.value }) : t("liveDrivers.noFix")}
                      </small>
                    </span>
                    <span className="kv-value">
                      {driver.activeDelivery ? <StatusBadge status={driver.activeDelivery.status} /> : null}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}

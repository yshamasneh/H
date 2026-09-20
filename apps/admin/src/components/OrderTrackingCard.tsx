import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ApiError } from "../api";
import { getOrderTracking, type OrderTracking } from "../api.tracking";
import { StatusBadge } from "./StatusBadge";
import { TrackingMap } from "./TrackingMap";
import { ageLabel, applyLocationUpdate, freshness, hasPosition } from "../driver-tracking";
import { useLiveRefresh, useRealtimeEvent } from "../socket";

/**
 * Where the driver on this order is, on a map with the pickup and the destination.
 *
 * Mounted on the order detail page. It fetches its own tracking view (the order detail does not
 * carry the driver), then follows the driver over the socket: positions move the marker directly,
 * and a delivery event for this order (accepted, picked up, delivered) re-fetches the view.
 */
export function OrderTrackingCard({ orderId }: { orderId: string }) {
  const { t } = useTranslation();
  const [tracking, setTracking] = useState<OrderTracking | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  async function load() {
    try {
      setTracking(await getOrderTracking(orderId));
      setError(null);
      setNow(Date.now());
    } catch (requestError) {
      setError(requestError instanceof ApiError ? requestError.message : t("tracking.loadError"));
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderId]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 5_000);
    return () => window.clearInterval(timer);
  }, []);

  useRealtimeEvent("driver.location.updated", (payload) => {
    setTracking((current) => {
      if (!current?.driver) return current;
      const [moved] = applyLocationUpdate([current.driver], payload);
      return moved === current.driver ? current : { ...current, driver: moved };
    });
    setNow(Date.now());
  });
  useRealtimeEvent("delivery.status.changed", (payload: unknown) => {
    if ((payload as { orderId?: string } | null)?.orderId === orderId) void load();
  });
  useLiveRefresh([], () => void load(), 60_000);

  if (error) return <div className="error-banner">{error}</div>;
  // Nothing to track before the order reaches a delivery.
  if (!tracking || !tracking.deliveryId) return null;

  const { driver } = tracking;
  const age = driver ? ageLabel(driver.lastLocationAt, now) : null;
  const state = driver ? freshness(driver.lastLocationAt, now) : "none";

  return (
    <div className="card">
      <h2 className="card-title">{t("tracking.title")}</h2>
      {!driver ? (
        <div className="empty-state">{t("tracking.noDriver")}</div>
      ) : (
        <>
          <div className="kv-row">
            <span className="kv-label">{t("tracking.driver")}</span>
            <span className="kv-value">
              {driver.fullName} · {driver.phone}
            </span>
          </div>
          <div className="kv-row">
            <span className="kv-label">{t("tracking.lastSeen")}</span>
            <span className="kv-value">
              {age ? t(`liveDrivers.age.${age.unit}`, { count: age.value }) : t("liveDrivers.noFix")}
              {" "}
              <StatusBadge status={state === "live" ? "ONLINE" : "OFFLINE"} />
            </span>
          </div>
          {!hasPosition(driver) ? <div className="empty-state">{t("tracking.noPosition")}</div> : null}
          <TrackingMap
            destination={tracking.destination}
            drivers={[driver]}
            height={320}
            now={now}
            pickup={tracking.pickup}
          />
          <p className="page-subtitle" style={{ marginTop: 10 }}>
            {t("tracking.legend")}
          </p>
        </>
      )}
    </div>
  );
}

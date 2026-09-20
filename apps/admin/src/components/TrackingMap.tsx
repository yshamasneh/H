import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { freshness, hasPosition, markerColors, type TrackedDriver } from "../driver-tracking";

/**
 * A Leaflet map of drivers (and, on an order, its pickup and destination), updated in place.
 *
 * Markers are created once and moved with `setLatLng` as positions change, rather than rebuilt, so
 * a position arriving every few seconds does not flicker and the dispatcher's own panning and
 * zooming is never undone: the map only re-frames when the set of things on it changes, or on
 * request. Same bundled Leaflet and Esri imagery as the landmark picker, so the production
 * Content-Security-Policy needs nothing new.
 */

type Point = { latitude: number | null; longitude: number | null };
export type TrackingMapProps = {
  drivers: TrackedDriver[];
  pickup?: (Point & { name: string }) | null;
  destination?: (Point & { label: string }) | null;
  /** Bumping this re-frames the map on everything currently shown. */
  fitSignal?: number;
  /** A driver to highlight (larger marker), e.g. the one picked in the list. */
  selectedDriverId?: string | null;
  onSelectDriver?: (userId: string) => void;
  height?: number;
  now: number;
};

const defaultCenter: [number, number] = [31.83804, 35.14047];

function dotIcon(color: string, size: number, ring: string): L.DivIcon {
  return L.divIcon({
    html: `<div style="width:${size}px;height:${size}px;border-radius:50%;background:${color};border:3px solid ${ring};box-shadow:0 0 0 1.5px rgba(0,0,0,.4)"></div>`,
    className: "tracking-dot",
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2]
  });
}

function pinIcon(color: string): L.DivIcon {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="30" viewBox="0 0 22 30">` +
    `<path d="M11 0C4.9 0 0 4.9 0 11c0 8.2 11 19 11 19s11-10.8 11-19C22 4.9 17.1 0 11 0Z" fill="${color}" stroke="#ffffff" stroke-width="1.5"/>` +
    `<circle cx="11" cy="11" r="4" fill="#ffffff"/></svg>`;
  return L.divIcon({ html: svg, className: "tracking-pin", iconSize: [22, 30], iconAnchor: [11, 30] });
}

const hasCoords = (point: Point | null | undefined): point is { latitude: number; longitude: number } =>
  !!point && typeof point.latitude === "number" && typeof point.longitude === "number";

export function TrackingMap(props: TrackingMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const driverMarkers = useRef(new Map<string, L.Marker>());
  const fixedMarkers = useRef<L.Marker[]>([]);
  const framedKey = useRef<string>("");
  const onSelectRef = useRef(props.onSelectDriver);
  onSelectRef.current = props.onSelectDriver;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current).setView(defaultCenter, 13);
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 19,
      attribution: "Tiles &copy; Esri"
    }).addTo(map);
    L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}", {
      maxZoom: 19,
      pane: "overlayPane"
    }).addTo(map);
    mapRef.current = map;
    const markers = driverMarkers.current;
    setTimeout(() => map.invalidateSize(), 0);
    return () => {
      map.remove();
      mapRef.current = null;
      markers.clear();
      fixedMarkers.current = [];
      framedKey.current = "";
    };
  }, []);

  // Drivers: move existing markers, add new ones, drop the ones that left the list.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const markers = driverMarkers.current;
    const present = new Set<string>();
    for (const driver of props.drivers) {
      if (!hasPosition(driver)) continue;
      present.add(driver.userId);
      const state = freshness(driver.lastLocationAt, props.now);
      const selected = driver.userId === props.selectedDriverId;
      const icon = dotIcon(markerColors[state], selected ? 26 : 20, selected ? "#F45A00" : "#FFFFFF");
      const label = `${driver.fullName}${driver.activeDelivery ? ` · ${driver.activeDelivery.restaurantName}` : ""}`;
      const existing = markers.get(driver.userId);
      if (existing) {
        existing.setLatLng([driver.latitude, driver.longitude]);
        existing.setIcon(icon);
        existing.setTooltipContent(label);
      } else {
        const marker = L.marker([driver.latitude, driver.longitude], { icon, zIndexOffset: 500 })
          .addTo(map)
          .bindTooltip(label, { direction: "top", offset: [0, -10] });
        marker.on("click", () => onSelectRef.current?.(driver.userId));
        markers.set(driver.userId, marker);
      }
    }
    for (const [userId, marker] of markers) {
      if (!present.has(userId)) {
        map.removeLayer(marker);
        markers.delete(userId);
      }
    }
  }, [props.drivers, props.selectedDriverId, props.now]);

  // The fixed points of a trip: where the goods are collected and where they are going.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    fixedMarkers.current.forEach((marker) => map.removeLayer(marker));
    fixedMarkers.current = [];
    if (hasCoords(props.pickup)) {
      fixedMarkers.current.push(
        L.marker([props.pickup.latitude, props.pickup.longitude], { icon: pinIcon("#0E7A3C") }).addTo(map).bindTooltip(props.pickup.name)
      );
    }
    if (hasCoords(props.destination)) {
      fixedMarkers.current.push(
        L.marker([props.destination.latitude, props.destination.longitude], { icon: pinIcon("#F45A00") })
          .addTo(map)
          .bindTooltip(props.destination.label)
      );
    }
  }, [props.pickup, props.destination]);

  // Re-frame only when what is on the map changes (a driver appears or leaves, the trip changes) or
  // when asked — never on a plain position update, so panning is not undone.
  const positioned = props.drivers.filter(hasPosition).map((driver) => driver.userId).sort().join(",");
  const tripKey = `${hasCoords(props.pickup) ? "p" : ""}${hasCoords(props.destination) ? "d" : ""}`;
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const key = `${positioned}|${tripKey}|${props.fitSignal ?? 0}`;
    if (key === framedKey.current) return;
    framedKey.current = key;
    const points: [number, number][] = [];
    for (const driver of props.drivers) if (hasPosition(driver)) points.push([driver.latitude, driver.longitude]);
    if (hasCoords(props.pickup)) points.push([props.pickup.latitude, props.pickup.longitude]);
    if (hasCoords(props.destination)) points.push([props.destination.latitude, props.destination.longitude]);
    if (points.length === 0) return;
    if (points.length === 1) map.setView(points[0], 15);
    else map.fitBounds(L.latLngBounds(points), { padding: [48, 48], maxZoom: 16 });
    // props.drivers / pickup / destination are read for their coordinates only when the key changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [positioned, tripKey, props.fitSignal]);

  return <div ref={containerRef} style={{ borderRadius: 12, height: props.height ?? 420, overflow: "hidden", width: "100%" }} />;
}

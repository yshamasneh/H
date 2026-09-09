import { createElement, useEffect, useMemo, useRef } from "react";
import { StyleSheet, View } from "react-native";
import type LeafletNamespace from "leaflet";
import "leaflet/dist/leaflet.css";
import { landmarkMarkerColor, landmarkVisibilityMinZoom, type LocationMapProps } from "./location-map.types";
import { radius, spacing, type ThemeColors } from "../theme/tokens";
import { useTheme } from "../theme/theme-context";

// The web map is Leaflet over OpenStreetMap-style Esri tiles, rendered directly into the page
// (no iframe, no CDN). Leaflet used to be loaded from unpkg inside a srcDoc iframe, but a
// srcDoc document inherits the parent's Content-Security-Policy, and a production `script-src
// 'self'` blocks both the remote <script> tag and the inline map script that ran inside it —
// so the production build showed a blank box. Bundling Leaflet as a real npm dependency and
// mounting it straight into a plain div makes every script part of the app's own 'self' bundle.
export const isInteractiveMapAvailable = true;

type Leaflet = typeof LeafletNamespace;

let leafletModulePromise: Promise<Leaflet> | null = null;
function loadLeaflet(): Promise<Leaflet> {
  if (!leafletModulePromise) {
    leafletModulePromise = import("leaflet").then((mod) => (mod as { default?: Leaflet }).default ?? (mod as unknown as Leaflet));
  }
  ensureIconStyles();
  return leafletModulePromise;
}

// Leaflet's default divIcon wrapper carries a white background/border; the flag/dot/pin icons
// above draw their own shape, so that chrome (and the landmark name label) is stripped/styled
// here instead of a per-document <style> tag, matching the CSP's existing `style-src
// 'unsafe-inline'` allowance.
let iconStylesInjected = false;
function ensureIconStyles(): void {
  if (iconStylesInjected || typeof document === "undefined") return;
  iconStylesInjected = true;
  const style = document.createElement("style");
  style.textContent =
    ".leaflet-control-attribution{font-size:10px}" +
    ".landmark-flag,.map-pin,.map-dot{background:transparent;border:0}" +
    ".landmark-label{position:absolute;left:15px;bottom:1px;background:#ffffff;color:#1a1a1a;font:600 10px/1.25 system-ui;padding:1px 5px;border-radius:4px;border:1px solid rgba(0,0,0,.12);white-space:nowrap;box-shadow:0 1px 2px rgba(0,0,0,.3)}";
  document.head.appendChild(style);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Compact orange flag with the name in a persistent label — matches the previous iframe
// implementation exactly. The flag shape (not a teardrop pin) is what tells landmarks apart
// from the user's own delivery pin.
function landmarkIcon(L: Leaflet, color: string | undefined, title: string) {
  const c = color || landmarkMarkerColor;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="30" viewBox="0 0 22 30">` +
    `<line x1="4" y1="2" x2="4" y2="29" stroke="#ffffff" stroke-width="4" stroke-linecap="round"/>` +
    `<line x1="4" y1="2" x2="4" y2="29" stroke="${c}" stroke-width="2" stroke-linecap="round"/>` +
    `<path d="M4 2 L19 6 L4 11 Z" fill="${c}" stroke="#ffffff" stroke-width="1.2" stroke-linejoin="round"/>` +
    `</svg>`;
  const html = `<div style="position:relative">${svg}<span class="landmark-label">${escapeHtml(title)}</span></div>`;
  return L.divIcon({ html, className: "landmark-flag", iconSize: [22, 30], iconAnchor: [4, 29], popupAnchor: [6, -24] });
}

function dotIcon(L: Leaflet, color: string | undefined) {
  const c = color || landmarkMarkerColor;
  return L.divIcon({
    html: `<div style="width:14px;height:14px;border-radius:50%;background:${c};border:2px solid #ffffff;box-shadow:0 0 0 1.5px rgba(0,0,0,.35)"></div>`,
    className: "map-dot",
    iconSize: [14, 14],
    iconAnchor: [7, 7]
  });
}

function teardropIcon(L: Leaflet, color: string | undefined) {
  const c = color || landmarkMarkerColor;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="30" viewBox="0 0 22 30">` +
    `<path d="M11 0C4.9 0 0 4.9 0 11c0 8.2 11 19 11 19s11-10.8 11-19C22 4.9 17.1 0 11 0Z" fill="${c}" stroke="#ffffff" stroke-width="1.5"/>` +
    `<circle cx="11" cy="11" r="4" fill="#ffffff"/></svg>`;
  return L.divIcon({ html: svg, className: "map-pin", iconSize: [22, 30], iconAnchor: [11, 30], popupAnchor: [0, -26] });
}

function applyLandmarks(
  L: Leaflet,
  map: LeafletNamespace.Map,
  layersRef: React.MutableRefObject<LeafletNamespace.Layer[]>,
  markers: LocationMapProps["markers"]
): void {
  layersRef.current.forEach((layer) => map.removeLayer(layer));
  layersRef.current = [];
  if (map.getZoom() < landmarkVisibilityMinZoom) return;
  layersRef.current = (markers ?? []).map((item) =>
    L.marker([item.latitude, item.longitude], { icon: landmarkIcon(L, item.color, item.title) })
      .addTo(map)
      .bindPopup(escapeHtml(item.title || ""))
  );
}

function applyPins(
  L: Leaflet,
  map: LeafletNamespace.Map,
  layersRef: React.MutableRefObject<LeafletNamespace.Layer[]>,
  pins: LocationMapProps["pins"]
): void {
  layersRef.current.forEach((layer) => map.removeLayer(layer));
  layersRef.current = (pins ?? []).map((pin) =>
    L.marker([pin.latitude, pin.longitude], { icon: pin.shape === "pin" ? teardropIcon(L, pin.color) : dotIcon(L, pin.color) })
      .addTo(map)
      .bindPopup(escapeHtml(pin.title || ""))
  );
}

export function LocationMap(props: LocationMapProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletNamespace.Map | null>(null);
  const markerRef = useRef<LeafletNamespace.Marker | null>(null);
  const landmarkLayersRef = useRef<LeafletNamespace.Layer[]>([]);
  const pinLayersRef = useRef<LeafletNamespace.Layer[]>([]);
  const onChangeRef = useRef(props.onCoordinateChange);
  onChangeRef.current = props.onCoordinateChange;

  useEffect(() => {
    let cancelled = false;
    void loadLeaflet().then((L) => {
      if (cancelled || !containerRef.current || mapRef.current) return;
      const map = L.map(containerRef.current).setView([props.coordinate.latitude, props.coordinate.longitude], 15);
      L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
        maxZoom: 19,
        attribution: "Tiles &copy; Esri"
      }).addTo(map);
      L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}", {
        maxZoom: 19,
        pane: "overlayPane"
      }).addTo(map);

      if (onChangeRef.current) {
        // An explicit icon, not Leaflet's own default marker: the default icon's PNG is referenced
        // by a relative `url(images/marker-icon.png)` inside leaflet.css, which Metro's web bundler
        // does not resolve when the CSS is imported as a local module — it would silently render no
        // pin at all in the production build.
        const marker = L.marker([props.coordinate.latitude, props.coordinate.longitude], {
          draggable: true,
          icon: teardropIcon(L, undefined)
        })
          .addTo(map)
          .bindPopup("موقع التوصيل");
        marker.on("dragend", () => {
          const latlng = marker.getLatLng();
          onChangeRef.current?.({ latitude: latlng.lat, longitude: latlng.lng });
        });
        map.on("click", (event: LeafletNamespace.LeafletMouseEvent) => {
          marker.setLatLng(event.latlng);
          onChangeRef.current?.({ latitude: event.latlng.lat, longitude: event.latlng.lng });
        });
        markerRef.current = marker;
      }

      mapRef.current = map;
      applyLandmarks(L, map, landmarkLayersRef, props.markers ?? []);
      applyPins(L, map, pinLayersRef, props.pins ?? []);
      map.on("zoomend", () => applyLandmarks(L, map, landmarkLayersRef, props.markers ?? []));
      // Leaflet mis-measures inside a freshly mounted card; recompute once laid out.
      setTimeout(() => map.invalidateSize(), 0);
    });
    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        markerRef.current = null;
        landmarkLayersRef.current = [];
        pinLayersRef.current = [];
      }
    };
    // Init runs once; coordinate/markers/pins are synced by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Move the marker and recenter when the coordinate changes from outside.
  useEffect(() => {
    if (!mapRef.current) return;
    markerRef.current?.setLatLng([props.coordinate.latitude, props.coordinate.longitude]);
    mapRef.current.panTo([props.coordinate.latitude, props.coordinate.longitude]);
  }, [props.coordinate.latitude, props.coordinate.longitude]);

  useEffect(() => {
    void loadLeaflet().then((L) => {
      if (mapRef.current) applyLandmarks(L, mapRef.current, landmarkLayersRef, props.markers ?? []);
    });
  }, [props.markers]);

  useEffect(() => {
    void loadLeaflet().then((L) => {
      if (mapRef.current) applyPins(L, mapRef.current, pinLayersRef, props.pins ?? []);
    });
  }, [props.pins]);

  return (
    <View style={[styles.frame, { height: props.height ?? 300 }]}>
      {createDiv({ ref: containerRef, style: { width: "100%", height: "100%" } })}
    </View>
  );
}

function createDiv(properties: Record<string, unknown>) {
  return createElement("div", properties);
}

const createStyles = (colors: ThemeColors) =>
  StyleSheet.create({
    frame: {
      borderColor: colors.border,
      borderRadius: radius.lg,
      borderWidth: 1,
      marginVertical: spacing[3],
      overflow: "hidden",
      width: "100%"
    }
  });

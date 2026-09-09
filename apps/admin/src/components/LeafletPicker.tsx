import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

/**
 * A Leaflet map the admin taps (or drags the marker on) to pick a coordinate.
 *
 * Leaflet is bundled as a normal npm dependency (not loaded from a CDN) so the production
 * build's `script-src 'self'` Content-Security-Policy never has to allow an external script
 * host. The base layer is Esri World Imagery with a boundaries/places overlay — the same
 * satellite + labels pairing the customer sees on the mobile address map.
 */

export type PickerCoordinate = { latitude: number; longitude: number };
export type PickerMarker = PickerCoordinate & { id: string; title: string };

// An explicit icon, not Leaflet's own default marker: the default icon's PNG is referenced by a
// relative `url(images/marker-icon.png)` inside leaflet.css, which Vite does not resolve/copy
// when the CSS is bundled as a local module — it would silently render no pin at all in the
// production build.
function teardropIcon(color = "#F45A00"): L.DivIcon {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="30" viewBox="0 0 22 30">` +
    `<path d="M11 0C4.9 0 0 4.9 0 11c0 8.2 11 19 11 19s11-10.8 11-19C22 4.9 17.1 0 11 0Z" fill="${color}" stroke="#ffffff" stroke-width="1.5"/>` +
    `<circle cx="11" cy="11" r="4" fill="#ffffff"/></svg>`;
  return L.divIcon({ html: svg, className: "picker-pin", iconSize: [22, 30], iconAnchor: [11, 30], popupAnchor: [0, -26] });
}

export function LeafletPicker(props: {
  value: PickerCoordinate;
  onChange: (value: PickerCoordinate) => void;
  markers?: PickerMarker[];
  height?: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const extraLayersRef = useRef<L.Layer[]>([]);
  // Keep the latest onChange without re-running the init effect.
  const onChangeRef = useRef(props.onChange);
  onChangeRef.current = props.onChange;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current).setView([props.value.latitude, props.value.longitude], 14);
    L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 19, attribution: "Tiles &copy; Esri" }
    ).addTo(map);
    L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 19, pane: "overlayPane" }
    ).addTo(map);
    const marker = L.marker([props.value.latitude, props.value.longitude], { draggable: true }).addTo(map);
    marker.on("dragend", () => {
      const latlng = marker.getLatLng();
      onChangeRef.current({ latitude: latlng.lat, longitude: latlng.lng });
    });
    map.on("click", (event) => {
      marker.setLatLng(event.latlng);
      onChangeRef.current({ latitude: event.latlng.lat, longitude: event.latlng.lng });
    });
    mapRef.current = map;
    markerRef.current = marker;
    // Leaflet mis-measures inside a freshly mounted card; recompute once laid out.
    setTimeout(() => map.invalidateSize(), 0);
    return () => {
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
    };
    // Init runs once; value/markers are synced by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Move the marker and recenter when the coordinate changes from outside (e.g. editing a row).
  useEffect(() => {
    if (!mapRef.current || !markerRef.current) return;
    markerRef.current.setLatLng([props.value.latitude, props.value.longitude]);
    mapRef.current.panTo([props.value.latitude, props.value.longitude]);
  }, [props.value.latitude, props.value.longitude]);

  // Render the other existing landmarks as faint reference pins.
  useEffect(() => {
    if (!mapRef.current) return;
    const map = mapRef.current;
    extraLayersRef.current.forEach((layer) => map.removeLayer(layer));
    extraLayersRef.current = (props.markers ?? []).map((item) =>
      L.marker([item.latitude, item.longitude], { opacity: 0.55 }).addTo(map).bindPopup(item.title)
    );
  }, [props.markers]);

  return (
    <div
      ref={containerRef}
      style={{ borderRadius: 12, height: props.height ?? 320, overflow: "hidden", width: "100%" }}
    />
  );
}

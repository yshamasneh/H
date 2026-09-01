import { useEffect, useRef } from "react";

/**
 * A Leaflet map the admin taps (or drags the marker on) to pick a coordinate.
 *
 * Leaflet is loaded once from the same CDN the mobile web map uses rather than
 * added as an npm dependency, so this stays self-contained. The base layer is
 * Esri World Imagery with a boundaries/places overlay — the same satellite +
 * labels pairing the customer sees on the mobile address map.
 */

const leafletCssUrl = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
const leafletJsUrl = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";

type LeafletGlobal = typeof window & { L?: any };

let leafletPromise: Promise<any> | null = null;

function loadLeaflet(): Promise<any> {
  const scope = window as LeafletGlobal;
  if (scope.L) return Promise.resolve(scope.L);
  if (leafletPromise) return leafletPromise;
  leafletPromise = new Promise((resolve, reject) => {
    if (!document.querySelector(`link[href="${leafletCssUrl}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = leafletCssUrl;
      document.head.appendChild(link);
    }
    const script = document.createElement("script");
    script.src = leafletJsUrl;
    script.async = true;
    script.onload = () => resolve(scope.L);
    script.onerror = () => reject(new Error("Failed to load Leaflet"));
    document.body.appendChild(script);
  });
  return leafletPromise;
}

export type PickerCoordinate = { latitude: number; longitude: number };
export type PickerMarker = PickerCoordinate & { id: string; title: string };

export function LeafletPicker(props: {
  value: PickerCoordinate;
  onChange: (value: PickerCoordinate) => void;
  markers?: PickerMarker[];
  height?: number;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const markerRef = useRef<any>(null);
  const extraLayersRef = useRef<any[]>([]);
  // Keep the latest onChange without re-running the init effect.
  const onChangeRef = useRef(props.onChange);
  onChangeRef.current = props.onChange;

  useEffect(() => {
    let cancelled = false;
    void loadLeaflet()
      .then((L) => {
        if (cancelled || !containerRef.current || mapRef.current) return;
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
        map.on("click", (event: any) => {
          marker.setLatLng(event.latlng);
          onChangeRef.current({ latitude: event.latlng.lat, longitude: event.latlng.lng });
        });
        mapRef.current = map;
        markerRef.current = marker;
        // Leaflet mis-measures inside a freshly mounted card; recompute once laid out.
        setTimeout(() => map.invalidateSize(), 0);
      })
      .catch(() => {
        // A blocked CDN just leaves the coordinate readout and manual dragging unavailable; the
        // rest of the form still works.
      });
    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
        markerRef.current = null;
      }
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
    const scope = window as LeafletGlobal;
    if (!mapRef.current || !scope.L) return;
    const L = scope.L;
    extraLayersRef.current.forEach((layer) => mapRef.current.removeLayer(layer));
    extraLayersRef.current = (props.markers ?? []).map((item) =>
      L.marker([item.latitude, item.longitude], { opacity: 0.55 }).addTo(mapRef.current).bindPopup(item.title)
    );
  }, [props.markers]);

  return (
    <div
      ref={containerRef}
      style={{ borderRadius: 12, height: props.height ?? 320, overflow: "hidden", width: "100%" }}
    />
  );
}

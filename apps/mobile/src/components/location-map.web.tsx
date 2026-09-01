import { createElement, useEffect, useMemo, useRef } from "react";
import { StyleSheet, View } from "react-native";
import { landmarkMarkerColor, landmarkVisibilityMinZoom, type LocationMapProps } from "./location-map.types";
import { radius, spacing, type ThemeColors } from "../theme/tokens";
import { useTheme } from "../theme/theme-context";

const channel = "tasawaq-location-map";

// The web map is Leaflet over OpenStreetMap in an iframe — no Google Maps SDK
// and no API key involved — so it is always available. The native module gates
// this on a configured key; see location-map.native.tsx.
export const isInteractiveMapAvailable = true;

export function LocationMap(props: LocationMapProps) {
  const { colors } = useTheme();
  const styles = useMemo(() => createStyles(colors), [colors]);
  const frame = useRef<HTMLIFrameElement | null>(null);
  const documentHtml = useMemo(
    () =>
      createMapDocument(
        props.coordinate.latitude,
        props.coordinate.longitude,
        Boolean(props.onCoordinateChange),
        props.markers ?? [],
        props.pins ?? []
      ),
    []
  );

  useEffect(() => {
    function receive(event: MessageEvent) {
      if (event.source !== frame.current?.contentWindow) return;
      const value = event.data as { channel?: string; latitude?: number; longitude?: number };
      if (value?.channel !== channel || typeof value.latitude !== "number" || typeof value.longitude !== "number") return;
      props.onCoordinateChange?.({ latitude: value.latitude, longitude: value.longitude });
    }
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [props.onCoordinateChange]);

  useEffect(() => {
    frame.current?.contentWindow?.postMessage(
      { channel, type: "update", coordinate: props.coordinate, markers: props.markers ?? [], pins: props.pins ?? [] },
      "*"
    );
  }, [props.coordinate, props.markers, props.pins]);

  return (
    <View style={[styles.frame, { height: props.height ?? 300 }]}>
      {/** The iframe isolates Leaflet from React Native Web while preserving an interactive OSM map. */}
      {createIframe({
        ref: frame,
        srcDoc: documentHtml,
        title: "خريطة موقع التوصيل",
        style: { border: 0, height: "100%", width: "100%" }
      })}
    </View>
  );
}

function createIframe(properties: Record<string, unknown>) {
  return createElement("iframe", properties);
}

function createMapDocument(
  latitude: number,
  longitude: number,
  editable: boolean,
  markers: LocationMapProps["markers"],
  pins: LocationMapProps["pins"]
): string {
  const safeMarkers = JSON.stringify(markers ?? []).replace(/</g, "\\u003c");
  const safePins = JSON.stringify(pins ?? []).replace(/</g, "\\u003c");
  return `<!doctype html><html><head><meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <style>html,body,#map{height:100%;margin:0}body{font-family:system-ui}.leaflet-control-attribution{font-size:10px}.landmark-flag,.map-pin,.map-dot{background:transparent;border:0}.landmark-label{position:absolute;left:15px;bottom:1px;background:#ffffff;color:#1a1a1a;font:600 10px/1.25 system-ui;padding:1px 5px;border-radius:4px;border:1px solid rgba(0,0,0,.12);white-space:nowrap;box-shadow:0 1px 2px rgba(0,0,0,.3)}</style></head>
  <body><div id="map"></div><script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script><script>
  const channel=${JSON.stringify(channel)}; const editable=${editable}; const extra=${safeMarkers}; const extraPins=${safePins}; const landmarkColor=${JSON.stringify(landmarkMarkerColor)}; const minZoom=${landmarkVisibilityMinZoom};
  const map=L.map('map').setView([${latitude},${longitude}],15);
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,attribution:'Tiles &copy; Esri'}).addTo(map);
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',{maxZoom:19,pane:'overlayPane'}).addTo(map);
  let selected=editable?L.marker([${latitude},${longitude}],{draggable:true}).addTo(map).bindPopup('موقع التوصيل'):null;
  let extraLayers=[]; let currentMarkers=extra; let pinLayers=[]; let currentPins=extraPins;
  function emit(latlng){parent.postMessage({channel,latitude:latlng.lat,longitude:latlng.lng},'*')}
  if(selected)selected.on('dragend',e=>emit(e.target.getLatLng()));
  if(editable)map.on('click',e=>{selected.setLatLng(e.latlng);emit(e.latlng)});
  function esc(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
  // Compact orange flag with the name in a persistent label. The flag shape (not a
  // teardrop pin) is what tells landmarks apart from the user's own delivery pin.
  function landmarkIcon(color,title){const c=color||landmarkColor;const svg='<svg xmlns="http://www.w3.org/2000/svg" width="22" height="30" viewBox="0 0 22 30">'+'<line x1="4" y1="2" x2="4" y2="29" stroke="#ffffff" stroke-width="4" stroke-linecap="round"/>'+'<line x1="4" y1="2" x2="4" y2="29" stroke="'+c+'" stroke-width="2" stroke-linecap="round"/>'+'<path d="M4 2 L19 6 L4 11 Z" fill="'+c+'" stroke="#ffffff" stroke-width="1.2" stroke-linejoin="round"/>'+'</svg>';const html='<div style="position:relative">'+svg+'<span class="landmark-label">'+esc(title)+'</span></div>';return L.divIcon({html:html,className:'landmark-flag',iconSize:[22,30],iconAnchor:[4,29],popupAnchor:[6,-24]});}
  // Landmarks are gated on zoom so a wide-area view isn't cluttered; the draggable
  // delivery pin above is never touched here.
  function applyMarkers(){extraLayers.forEach(layer=>map.removeLayer(layer));extraLayers=[];if(map.getZoom()<minZoom)return;extraLayers=(currentMarkers||[]).map(item=>L.marker([item.latitude,item.longitude],{icon:landmarkIcon(item.color,item.title)}).addTo(map).bindPopup(esc(item.title||'')));}
  function setMarkers(markers){currentMarkers=markers||[];applyMarkers();}
  map.on('zoomend',applyMarkers);
  setMarkers(extra);
  // Always-visible point markers (driver position, pickup store, delivery destination) — distinct
  // simple markers, never zoom-gated and never the landmark flag+label style.
  function dotIcon(color){return L.divIcon({html:'<div style="width:14px;height:14px;border-radius:50%;background:'+(color||landmarkColor)+';border:2px solid #ffffff;box-shadow:0 0 0 1.5px rgba(0,0,0,.35)"></div>',className:'map-dot',iconSize:[14,14],iconAnchor:[7,7]});}
  function teardropIcon(color){const c=color||landmarkColor;const svg='<svg xmlns="http://www.w3.org/2000/svg" width="22" height="30" viewBox="0 0 22 30"><path d="M11 0C4.9 0 0 4.9 0 11c0 8.2 11 19 11 19s11-10.8 11-19C22 4.9 17.1 0 11 0Z" fill="'+c+'" stroke="#ffffff" stroke-width="1.5"/><circle cx="11" cy="11" r="4" fill="#ffffff"/></svg>';return L.divIcon({html:svg,className:'map-pin',iconSize:[22,30],iconAnchor:[11,30],popupAnchor:[0,-26]});}
  function applyPins(){pinLayers.forEach(layer=>map.removeLayer(layer));pinLayers=(currentPins||[]).map(p=>L.marker([p.latitude,p.longitude],{icon:(p.shape==='pin'?teardropIcon:dotIcon)(p.color)}).addTo(map).bindPopup(esc(p.title||'')));}
  function setPins(pins){currentPins=pins||[];applyPins();}
  setPins(extraPins);
  addEventListener('message',event=>{const value=event.data;if(!value||value.channel!==channel||value.type!=='update')return;const c=value.coordinate;if(selected)selected.setLatLng([c.latitude,c.longitude]);setMarkers(value.markers);setPins(value.pins);map.panTo([c.latitude,c.longitude]);});
  </script></body></html>`;
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  frame: {
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    marginVertical: spacing[3],
    overflow: "hidden",
    width: "100%"
  }
});

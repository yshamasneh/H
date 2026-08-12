import { createElement, useEffect, useMemo, useRef } from "react";
import { StyleSheet, View } from "react-native";
import type { LocationMapProps } from "./location-map.types";
import { colors, radius, spacing } from "../theme/tokens";

const channel = "tasawaq-location-map";

export function LocationMap(props: LocationMapProps) {
  const frame = useRef<HTMLIFrameElement | null>(null);
  const documentHtml = useMemo(
    () => createMapDocument(props.coordinate.latitude, props.coordinate.longitude, Boolean(props.onCoordinateChange), props.markers ?? []),
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
      { channel, type: "update", coordinate: props.coordinate, markers: props.markers ?? [] },
      "*"
    );
  }, [props.coordinate, props.markers]);

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
  markers: LocationMapProps["markers"]
): string {
  const safeMarkers = JSON.stringify(markers ?? []).replace(/</g, "\\u003c");
  return `<!doctype html><html><head><meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <style>html,body,#map{height:100%;margin:0}body{font-family:system-ui}.leaflet-control-attribution{font-size:10px}</style></head>
  <body><div id="map"></div><script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script><script>
  const channel=${JSON.stringify(channel)}; const editable=${editable}; const extra=${safeMarkers};
  const map=L.map('map').setView([${latitude},${longitude}],15);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap contributors'}).addTo(map);
  let selected=editable?L.marker([${latitude},${longitude}],{draggable:true}).addTo(map).bindPopup('موقع التوصيل'):null;
  let extraLayers=[];
  function emit(latlng){parent.postMessage({channel,latitude:latlng.lat,longitude:latlng.lng},'*')}
  if(selected)selected.on('dragend',e=>emit(e.target.getLatLng()));
  if(editable)map.on('click',e=>{selected.setLatLng(e.latlng);emit(e.latlng)});
  function render(markers){extraLayers.forEach(layer=>map.removeLayer(layer));extraLayers=(markers||[]).map(item=>L.marker([item.latitude,item.longitude]).addTo(map).bindPopup(item.title||''));}
  render(extra);
  addEventListener('message',event=>{const value=event.data;if(!value||value.channel!==channel||value.type!=='update')return;const c=value.coordinate;if(selected)selected.setLatLng([c.latitude,c.longitude]);render(value.markers);map.panTo([c.latitude,c.longitude]);});
  </script></body></html>`;
}

const styles = StyleSheet.create({
  frame: {
    borderColor: colors.border,
    borderRadius: radius.lg,
    borderWidth: 1,
    marginVertical: spacing[3],
    overflow: "hidden",
    width: "100%"
  }
});

import MapView, { Marker, type MapPressEvent, type Region } from "react-native-maps";
import { StyleSheet, View } from "react-native";
import type { LocationMapProps, MapCoordinate } from "./location-map.types";

const latitudeDelta = 0.025;
const longitudeDelta = 0.025;

export function LocationMap(props: LocationMapProps) {
  const region: Region = {
    ...props.coordinate,
    latitudeDelta,
    longitudeDelta
  };

  function select(event: MapPressEvent) {
    props.onCoordinateChange?.(event.nativeEvent.coordinate);
  }

  function drag(coordinate: MapCoordinate) {
    props.onCoordinateChange?.(coordinate);
  }

  return (
    <View style={[styles.frame, { height: props.height ?? 300 }]}>
      <MapView initialRegion={region} onPress={select} style={StyleSheet.absoluteFillObject}>
        {props.onCoordinateChange ? (
          <Marker
            coordinate={props.coordinate}
            draggable
            onDragEnd={(event) => drag(event.nativeEvent.coordinate)}
            pinColor="#0E7C66"
            title="موقع التوصيل"
          />
        ) : null}
        {props.markers?.map((marker) => (
          <Marker
            coordinate={marker}
            key={marker.id}
            pinColor={marker.color}
            title={marker.title}
          />
        ))}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  frame: {
    borderColor: "#D8E4E8",
    borderRadius: 18,
    borderWidth: 1,
    marginVertical: 10,
    overflow: "hidden",
    width: "100%"
  }
});

export type MapCoordinate = {
  latitude: number;
  longitude: number;
};

export type LocationMapMarker = MapCoordinate & {
  id: string;
  title: string;
  color?: string;
};

export type LocationMapProps = {
  coordinate: MapCoordinate;
  onCoordinateChange?: (coordinate: MapCoordinate) => void;
  markers?: LocationMapMarker[];
  height?: number;
};

// The detail screen's map: one vehicle, its route and its numbered calls (with names — this
// map has no stop layer to collide with). Deliberately not LiveMap: no stream, no stops, no
// selection; the position comes in as a prop from the screen's single-vehicle subscription.
import { useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Camera, GeoJSONSource, Images, Layer, Map as MLMap, type CameraRef, type ViewStateChangeEvent } from "@maplibre/maplibre-react-native";
import type { TripStop } from "@ovlive/api-types";
import { COLORFUL_STYLE, ECLIPSE_STYLE, tripStopFeatures } from "@ovlive/shared";
import { emptyFC } from "../../lib/geo";
import { STOP_LABEL_ZOOM, routeLineLayer, tripStopLayers, tripStopNameLayer, vehicleBadgeLayer } from "./layers";
import { markerKey } from "../../lib/markerImages";
import { useMarkerImages } from "../../hooks/useMarkerImages";

export interface MapVehicle {
  lat: number;
  lon: number;
  owner: string;
  line: string;
}

interface Props {
  dark: boolean;
  vehicle: MapVehicle | null;
  routeShape: [number, number][] | null;
  stops: TripStop[];
  /** Index of the first call still ahead — handed in, so the screen's list and its map agree. */
  upcomingFrom: number;
  stopNumbers: boolean;
  following: boolean;
}

export function VehicleMap({ dark, vehicle, routeShape, stops, upcomingFrom, stopNumbers, following }: Props) {
  const cameraRef = useRef<CameraRef>(null);
  const placed = useRef(false);
  // iOS drops camera stops until the map has finished loading, so the first fix waits for it.
  const [ready, setReady] = useState(false);
  const followingRef = useRef(following);
  followingRef.current = following;
  // Following is a toggle; a gesture only pauses the recentre until it ends (see LiveMap).
  const gesture = useRef(false);
  const marker = useMarkerImages();
  useEffect(() => {
    if (vehicle) marker.ensure([markerKey(vehicle.owner, vehicle.line, dark)]);
  }, [vehicle, dark, marker]);

  const vehicleFC = useMemo<GeoJSON.GeoJSON>(
    () =>
      vehicle
        ? {
            type: "Feature",
            geometry: { type: "Point", coordinates: [vehicle.lon, vehicle.lat] },
            properties: { id: "me", owner: vehicle.owner, line: vehicle.line },
          }
        : emptyFC(),
    [vehicle],
  );
  const routeFC = useMemo<GeoJSON.GeoJSON>(() => {
    if (!routeShape || routeShape.length < 2) return emptyFC();
    return { type: "Feature", geometry: { type: "LineString", coordinates: routeShape.map(([lat, lon]) => [lon, lat]) }, properties: {} };
  }, [routeShape]);
  const tripStopsFC = useMemo(() => tripStopFeatures(stops, upcomingFrom), [stops, upcomingFrom]);

  // The first fix jumps the camera onto the vehicle; later ones ease, while following.
  useEffect(() => {
    if (!vehicle || !ready) return;
    if (!placed.current) {
      placed.current = true;
      cameraRef.current?.jumpTo({ center: [vehicle.lon, vehicle.lat], zoom: 14 });
    } else if (followingRef.current && !gesture.current) {
      cameraRef.current?.easeTo({ center: [vehicle.lon, vehicle.lat], duration: 700 });
    }
  }, [vehicle, ready]);

  // Re-attach: recentre at once when follow comes back on.
  useEffect(() => {
    if (following && vehicle) cameraRef.current?.easeTo({ center: [vehicle.lon, vehicle.lat], duration: 500 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [following]);

  return (
    <View style={styles.root}>
      <MLMap
        style={styles.root}
        mapStyle={dark ? ECLIPSE_STYLE : COLORFUL_STYLE}
        attribution
        logo={false}
        compass={false}
        touchPitch={false}
        onDidFinishLoadingMap={() => setReady(true)}
        onRegionWillChange={(e: { nativeEvent: ViewStateChangeEvent }) => {
          if (e.nativeEvent.userInteraction) gesture.current = true;
        }}
        onRegionDidChange={() => {
          if (!gesture.current) return;
          gesture.current = false;
          if (followingRef.current && vehicle) cameraRef.current?.easeTo({ center: [vehicle.lon, vehicle.lat], duration: 500 });
        }}
      >
        <Camera ref={cameraRef} initialViewState={{ center: [4.9041, 52.3676], zoom: 7 }} minZoom={6} maxZoom={19} />
        <Images images={marker.images} onImageMissing={marker.onImageMissing} />
        <GeoJSONSource id="route" data={routeFC}>
          <Layer {...routeLineLayer("route")} />
        </GeoJSONSource>
        <GeoJSONSource id="trip-stops" data={tripStopsFC}>
          {tripStopLayers("trip-stops", dark, stopNumbers, STOP_LABEL_ZOOM).map((l) => (
            <Layer key={l.id} {...l} />
          ))}
          <Layer {...tripStopNameLayer("trip-stops", dark)} />
        </GeoJSONSource>
        <GeoJSONSource id="vehicle" data={vehicleFC}>
          <Layer {...{ ...vehicleBadgeLayer("vehicle", dark), minzoom: 0 }} />
        </GeoJSONSource>
      </MLMap>
    </View>
  );
}

const styles = StyleSheet.create({ root: { flex: 1 } });

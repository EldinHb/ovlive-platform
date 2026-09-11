// Viewport arithmetic shared by the map components.
import type { BBox } from "@ovlive/api-types";
import type { LngLatBounds } from "@maplibre/maplibre-react-native";

export function boundsToBBox(b: LngLatBounds): BBox {
  const [west, south, east, north] = b;
  return { minLat: south, minLon: west, maxLat: north, maxLon: east };
}

export function padBBox(b: BBox, f: number): BBox {
  const dLat = (b.maxLat - b.minLat) * f;
  const dLon = (b.maxLon - b.minLon) * f;
  return { minLat: b.minLat - dLat, minLon: b.minLon - dLon, maxLat: b.maxLat + dLat, maxLon: b.maxLon + dLon };
}

/** Is `view` fully inside the already-fetched box `have`? */
export function covers(have: BBox | null, view: BBox): boolean {
  return (
    !!have &&
    have.minLat <= view.minLat &&
    have.minLon <= view.minLon &&
    have.maxLat >= view.maxLat &&
    have.maxLon >= view.maxLon
  );
}

export function emptyFC(): GeoJSON.FeatureCollection {
  return { type: "FeatureCollection", features: [] };
}

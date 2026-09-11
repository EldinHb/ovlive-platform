// The live fleet as the map sees it: a plain Map mutated straight from the stream, flushed
// to the renderer at most once per tick. Nothing here touches React — LiveMap subscribes to
// `onFlush` and hands the FeatureCollection to the native source. A port of the featuresRef /
// vehiclesRef / scheduleFlush trio in apps/web/app/components/MapView.tsx.
import type { NormalizedUpdate, Vehicle } from "@ovlive/api-types";
import { resolveOperator } from "@ovlive/shared";

export interface StoreEvents {
  /** A selected vehicle left the live stream (its trip ended / was pruned). */
  onSelectedGone: (id: string) => void;
  /** A selected vehicle (re)entered the live stream. */
  onSelectedBack: (v: Vehicle) => void;
}

export class VehicleStore {
  readonly vehicles = new Map<string, Vehicle>();
  private features = new Map<string, GeoJSON.Feature>();
  selectedIds: string[] = [];
  private dirty = false;
  private timer?: ReturnType<typeof setTimeout>;
  private lastFlush = 0;
  onFlush?: (fc: GeoJSON.FeatureCollection) => void;

  constructor(private events: StoreEvents) {}

  apply(u: NormalizedUpdate) {
    if (u.isSnapshot) {
      this.features.clear();
      this.vehicles.clear();
    }
    for (const v of u.entered) {
      this.vehicles.set(v.id, v);
      this.features.set(v.id, vehicleFeature(v));
      if (this.selectedIds.includes(v.id)) this.events.onSelectedBack(v);
    }
    for (const m of u.moved) {
      const f = this.features.get(m.id);
      if (f && f.geometry.type === "Point") f.geometry.coordinates = [m.lon, m.lat];
      const veh = this.vehicles.get(m.id);
      if (veh) {
        Object.assign(veh, { lat: m.lat, lon: m.lon, delay: m.delay, delayKnown: m.delayKnown, atStop: m.atStop, speedKmh: m.speedKmh });
      }
    }
    for (const id of u.left) {
      this.features.delete(id);
      this.vehicles.delete(id);
      if (this.selectedIds.includes(id)) this.events.onSelectedGone(id);
    }
    // A snapshot replaces state wholesale — no per-vehicle LEAVE events — so reconcile: any
    // selected vehicle absent from it has ended. This is the only "gone" signal after a
    // reconnect, and pinned vehicles are never merely "out of view".
    if (u.isSnapshot) {
      for (const id of this.selectedIds) if (!this.vehicles.has(id)) this.events.onSelectedGone(id);
    }
    this.scheduleFlush();
  }

  get size() {
    return this.vehicles.size;
  }

  /**
   * Coalesce frames into one render. The stream already ticks at ~3 Hz; the floor here is for
   * reconnect bursts and for a country-wide view, where a 3000-feature collection crossing to
   * the native side three times a second is the expensive part of the whole app. Nothing the
   * user can see moves faster than a bus does at that zoom.
   */
  private scheduleFlush() {
    if (this.dirty) return;
    this.dirty = true;
    const n = this.vehicles.size;
    const minGap = n > 1500 ? 1000 : n > 600 ? 500 : 250;
    const wait = Math.max(0, this.lastFlush + minGap - Date.now());
    this.timer = setTimeout(() => this.flush(), wait);
  }

  private flush() {
    this.dirty = false;
    this.lastFlush = Date.now();
    this.onFlush?.({ type: "FeatureCollection", features: [...this.features.values()] });
  }

  dispose() {
    if (this.timer) clearTimeout(this.timer);
    this.onFlush = undefined;
  }
}

function vehicleFeature(v: Vehicle): GeoJSON.Feature {
  // Resolve the operator to display (GTFS brand over the raw dataowner code) so the marker
  // shows the public operator, not a masking subcontractor code. No brand colour: markers
  // are uniform, colours are for the panels.
  const op = resolveOperator(v.dataowner, v.operator);
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates: [v.lon, v.lat] },
    properties: { id: v.id, line: v.line, owner: op.label, type: v.type },
  };
}

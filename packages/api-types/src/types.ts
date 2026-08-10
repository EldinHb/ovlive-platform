// App-facing types (camelCase), decoupled from the protobuf wire field names.

export enum VehicleType {
  UNSPECIFIED = 0,
  BUS = 1,
  TRAM = 2,
  METRO = 3,
  TRAIN = 4,
  FERRY = 5,
}

export const VEHICLE_TYPE_LABEL: Record<VehicleType, string> = {
  [VehicleType.UNSPECIFIED]: "unknown",
  [VehicleType.BUS]: "bus",
  [VehicleType.TRAM]: "tram",
  [VehicleType.METRO]: "metro",
  [VehicleType.TRAIN]: "train",
  [VehicleType.FERRY]: "ferry",
};

export interface BBox {
  minLat: number;
  minLon: number;
  maxLat: number;
  maxLon: number;
}

export interface FilterState {
  types: VehicleType[];
  owners: string[];
  search: string;
}

/** Full state for a vehicle (from ENTER / snapshot). */
export interface Vehicle {
  id: string;
  dataowner: string;
  vehicleNumber: string;
  line: string;
  type: VehicleType;
  operator: string;
  lat: number;
  lon: number;
  bearing: number | null;
  delay: number;
  /** Whether `delay` is measured. False = unknown, which is not the same as on time. */
  delayKnown: boolean;
  destination: string;
  block: string;
  journey: string;
  atStop: boolean;
  currentStopId: string;
  /**
   * `lat`/`lon` is the scheduled station, not a GPS fix. RET metros publish no coordinates,
   * so their dot marks the last confirmed station call and hops station-to-station.
   */
  schedulePositioned: boolean;
  /** GTFS line colours (6-hex, no '#'); "" when the line has none. */
  lineColor: string;
  lineTextColor: string;
}

/** Lightweight position delta (from MOVE). */
export interface MoveDelta {
  id: string;
  lat: number;
  lon: number;
  bearing: number | null;
  delay: number;
  /** Whether `delay` is measured. False = unknown, which is not the same as on time. */
  delayKnown: boolean;
  atStop: boolean;
  currentStopId: string;
  /** See `Vehicle.schedulePositioned`; can flip mid-trip if GPS (re)appears. */
  schedulePositioned: boolean;
}

export interface NormalizedUpdate {
  entered: Vehicle[];
  moved: MoveDelta[];
  left: string[];
  isSnapshot: boolean;
}

/** A boardable quay, as returned by the stop-layer endpoint. */
export interface StopSummary {
  stop_id: string;
  name: string;
  /** Operator stop code (`stops.txt.stop_code`) — not a GTFS key. */
  code: string | null;
  platform_code: string | null;
  parent_station: string | null;
  lat: number;
  lon: number;
}

/** REST stop-layer response (`GET /v1/stops/viewport`). */
export interface StopsResponse {
  count: number;
  /** `limit` was hit, so the result only covers the centre of the requested box. */
  truncated: boolean;
  stops: StopSummary[];
}

/**
 * One scheduled departure from a stop. Times are seconds since **today's** local
 * (Europe/Amsterdam) midnight — the same axis as `upcoming_stops` — so they can be negative
 * or exceed 86400 for after-midnight service; use `etaSeconds`/`secsToClock` on them.
 */
export interface StopDeparture {
  trip_id: string;
  realtime_trip_id: string | null;
  /** Live vehicle running this trip; null until it starts reporting. Selectable on the map. */
  vehicle_id: string | null;
  vehicle_lat: number | null;
  vehicle_lon: number | null;
  line: string;
  vehicle_type: string;
  /** GTFS `agency_id` of the route (e.g. `GVB`). */
  operator: string | null;
  headsign: string;
  stop_sequence: number;
  scheduled_arrival: number;
  scheduled_departure: number;
  /** `scheduled_departure` plus the live vehicle's trip delay; equal to it when not live. */
  expected_departure: number;
  delay_seconds: number | null;
  at_stop: boolean;
  line_color: string | null;
  line_text_color: string | null;
}

/** REST departure-board response (`GET /v1/stops/{stopId}/departures`). */
export interface StopDeparturesResponse {
  stop: StopSummary;
  /** Service date the board is anchored to, `yyyy-mm-dd`. */
  service_date: string;
  departures: StopDeparture[];
}

/** A live vehicle as the REST endpoints serialise it (snake_case, unlike the WS `Vehicle`). */
export interface VehicleSummary {
  id: string;
  dataowner: string;
  vehicle_number: string;
  line_public_number: string | null;
  line_planning_number: string | null;
  vehicle_type: string;
  operator_name: string | null;
  lat: number;
  lon: number;
  bearing: number | null;
  delay_seconds: number;
  /** Whether `delay_seconds` is measured. False = unknown, not on time. */
  delay_known: boolean;
  destination: string | null;
  block_code: string | null;
  journey_number: string | null;
  at_stop: boolean;
  current_stop_id: string | null;
  /** `lat`/`lon` is the scheduled station, not a GPS fix (RET metros publish none). */
  schedule_positioned: boolean;
  line_color: string | null;
  line_text_color: string | null;
  last_update: string;
}

/** REST snapshot/search response (`GET /v1/vehicles`). */
export interface VehiclesResponse {
  /** How many are in `vehicles` (after `limit`). */
  count: number;
  /** How many matched in total; greater than `count` when `limit` truncated the result. */
  total: number;
  vehicles: VehicleSummary[];
}

/**
 * REST vehicle-detail response (`GET /v1/vehicles/{id}`) — the half that changes, so this is
 * the one to poll. The route shape and stop list are in `VehicleTripPlan`.
 */
export interface VehicleDetail {
  vehicle: VehicleSummary;
  /** Matched GTFS trip; null when unmatched. Refetch the trip plan when this changes. */
  trip_id: string | null;
}

/**
 * One scheduled call on a trip. Times are seconds since the operating day's local
 * (Europe/Amsterdam) midnight, so they can exceed 86400 for after-midnight service; use
 * `etaSeconds`/`secsToClock` on them.
 *
 * Schedule only, by design — expected is `scheduled + delay` from the live vehicle, and only
 * when its `delayKnown` is set.
 */
export interface TripStop {
  stop_id: string;
  name: string;
  lat: number;
  lon: number;
  stop_sequence: number;
  scheduled_arrival: number;
  scheduled_departure: number;
}

/**
 * REST vehicle trip-plan response (`GET /v1/vehicles/{id}/trip`) — the half that doesn't
 * change while the vehicle runs this trip. Fetch once, refetch only when the detail
 * response's `trip_id` changes.
 *
 * `stops` is the **whole** trip; the calls still ahead are filtered client-side from the
 * vehicle's live position (see `upcomingStops` in the web app).
 */
export interface VehicleTripPlan {
  trip_id: string | null;
  route_shape: [number, number][]; // [lat, lon]
  stops: TripStop[];
}

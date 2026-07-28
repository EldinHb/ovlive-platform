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
  /** GTFS line colours (6-hex, no '#'); "" when the line has none. */
  lineColor: string;
  lineTextColor: string;
  /** Predicted next public line this vehicle becomes (block/omloop chaining); "" if unknown. */
  nextLine: string;
  /** Destination of the predicted next trip; "" if unknown. */
  nextDestination: string;
  /** Start of the predicted next trip (unix seconds); 0 if unknown. */
  nextStart: number;
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

/** REST vehicle-detail response. */
export interface VehicleDetail {
  vehicle: {
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
    line_color: string | null;
    line_text_color: string | null;
    last_update: string;
  };
  route_shape: [number, number][]; // [lat, lon]
  upcoming_stops: {
    stop_id: string;
    name: string;
    lat: number;
    lon: number;
    stop_sequence: number;
    scheduled_arrival: number;
    expected_arrival: number;
  }[];
  /** Predicted next trip for this vehicle (block/omloop chaining); null if unknown. */
  next_trip: {
    line_public_number: string;
    destination: string;
    start_unix: number;
  } | null;
}

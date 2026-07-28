//! In-memory GTFS store: compact lookups for enrichment and vehicle-detail queries.

use std::collections::HashMap;

use chrono::{DateTime, Duration, NaiveDate, TimeZone, Utc};
use ovlive_core::{Enricher, LiveTrip, VehicleType};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RouteInfo {
    pub route_id: String,
    pub agency_id: Option<String>,
    pub short_name: String,
    pub long_name: String,
    pub vehicle_type: VehicleType,
    /// GTFS route_color / route_text_color (6-hex, no '#'); `None` when the feed omits them.
    pub color: Option<String>,
    pub text_color: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TripInfo {
    pub trip_id: String,
    pub route_id: String,
    pub headsign: String,
    pub block_id: Option<String>,
    pub shape_id: Option<String>,
    /// `calendar_dates.txt` service this trip runs on. The feed spans several weeks, so this
    /// is the only way to tell which trips actually run on a given day.
    pub service_id: String,
    /// `trips.txt.trip_long_name` — the operator's human description of the run.
    pub long_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StopInfo {
    pub stop_id: String,
    pub name: String,
    pub lat: f64,
    pub lon: f64,
    /// `stops.txt.stop_code` — the operator's stop code. **This is what KV6/KV78 call
    /// `UserStopCode`**, so it (not `stop_id`) is the join key for realtime stop passages.
    pub code: Option<String>,
    pub platform_code: Option<String>,
    pub parent_station: Option<String>,
    /// `stops.txt.location_type` (0 = stop/quay, 1 = station). The stops endpoints list only
    /// boardable quays, so stations — and gtfs-nl's `stoparea:*` grouping rows — are excluded.
    pub location_type: i32,
}

impl StopInfo {
    /// A boardable quay, as opposed to a station or a gtfs-nl `stoparea:*` grouping row.
    pub fn is_quay(&self) -> bool {
        self.location_type != 1 && !self.stop_id.starts_with("stoparea:")
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StopTime {
    pub stop_id: String,
    pub stop_sequence: u32,
    /// Seconds since local midnight (may exceed 86400 for after-midnight service).
    pub arrival: i32,
    pub departure: i32,
}

/// A resolved next-stop prediction for the vehicle-detail view.
#[derive(Debug, Clone, Serialize)]
pub struct UpcomingStop {
    pub stop_id: String,
    pub name: String,
    pub lat: f64,
    pub lon: f64,
    pub stop_sequence: u32,
    pub scheduled_arrival: i32,
    /// Scheduled + live delay, in seconds since local midnight.
    pub expected_arrival: i32,
}

/// The whole feed, parsed into lookup tables. Wrapped in `Arc` and hot-swapped daily.
#[derive(Debug, Default, Serialize, Deserialize)]
pub struct GtfsStore {
    pub feed_version: String,
    pub agencies: HashMap<String, String>, // agency_id -> name
    pub routes: HashMap<String, RouteInfo>, // route_id -> route
    pub trips: HashMap<String, TripInfo>,   // trip_id -> trip
    pub stops: HashMap<String, StopInfo>,   // stop_id -> stop
    pub stop_times: HashMap<String, Vec<StopTime>>, // trip_id -> ordered stop times
    pub shapes: HashMap<String, Vec<[f64; 2]>>, // shape_id -> [lat, lon] polyline
    /// OVapi `realtime_trip_id` -> `trip_id`. The KV6 join
    /// (`"<dataowner>:<lineplanningnumber>:<journeynumber>"`). Duplicates across service
    /// days collapse (last wins); enrichment fields are day-invariant so that's correct.
    pub trip_by_key: HashMap<String, String>,
    /// `service_id` -> the `YYYYMMDD` dates it runs, ascending. gtfs-nl ships no
    /// `calendar.txt` — every service is enumerated in `calendar_dates.txt` — but
    /// `calendar.txt` is folded in here too when a feed provides one.
    pub service_dates: HashMap<String, Vec<u32>>,
}

impl GtfsStore {
    pub fn route(&self, id: &str) -> Option<&RouteInfo> {
        self.routes.get(id)
    }
    pub fn trip(&self, id: &str) -> Option<&TripInfo> {
        self.trips.get(id)
    }
    pub fn stop(&self, id: &str) -> Option<&StopInfo> {
        self.stops.get(id)
    }
    /// Whether `service_id` runs on `date` (as a `YYYYMMDD` integer).
    pub fn runs_on(&self, service_id: &str, date: u32) -> bool {
        self.service_dates
            .get(service_id)
            .is_some_and(|dates| dates.binary_search(&date).is_ok())
    }

    pub fn shape_of_trip(&self, trip_id: &str) -> Option<&Vec<[f64; 2]>> {
        self.trips
            .get(trip_id)
            .and_then(|t| t.shape_id.as_ref())
            .and_then(|s| self.shapes.get(s))
    }

    /// The OVapi `realtime_trip_id` join value for a KV6 vehicle:
    /// `"<DataOwnerCode>:<LinePlanningNumber>:<JourneyNumber>"` (e.g. `HTM:11:110002`).
    pub fn realtime_trip_id(dataowner: &str, line: &str, journey: &str) -> String {
        format!("{dataowner}:{line}:{journey}")
    }

    /// Resolve the GTFS trip id for a KV6 vehicle via its `realtime_trip_id`.
    pub fn match_trip_id(&self, trip: &LiveTrip) -> Option<String> {
        let key = Self::realtime_trip_id(
            &trip.key.dataowner,
            trip.line_planning_number.as_deref()?,
            trip.journey_number.as_deref()?,
        );
        self.trip_by_key.get(&key).cloned()
    }

    /// Stops the vehicle still has to visit.
    ///
    /// Anchored to the vehicle's *physical position*: the current/next stop is the one
    /// nearest the vehicle. If the vehicle is at a stop we start there (it hasn't left yet);
    /// if it's moving we additionally consult the delay-adjusted schedule to decide whether
    /// it has already *departed* that nearest stop (advance by one). Position-anchoring
    /// avoids dropping the stop a vehicle is physically dwelling at just because the
    /// schedule+delay says it "should" have gone. Falls back to pure time (then whole trip)
    /// when the vehicle position is unknown.
    #[allow(clippy::too_many_arguments)] // position + schedule + delay + clock all matter here
    pub fn upcoming_stops(
        &self,
        trip_id: &str,
        delay_seconds: i32,
        operating_day: Option<&str>,
        veh_lat: f64,
        veh_lon: f64,
        at_stop: bool,
        now: DateTime<Utc>,
    ) -> Vec<UpcomingStop> {
        let Some(times) = self.stop_times.get(trip_id) else {
            return Vec::new();
        };
        let rows: Vec<(&StopTime, &StopInfo)> = times
            .iter()
            .filter_map(|st| self.stops.get(&st.stop_id).map(|s| (st, s)))
            .collect();
        if rows.is_empty() {
            return Vec::new();
        }

        let start = match nearest_stop_index(&rows, veh_lat, veh_lon) {
            Some(g) if at_stop => g, // dwelling at this stop → it's the current one
            Some(g) => {
                // Moving: only skip the nearest stop if the delay-adjusted schedule says
                // we've already departed it.
                let departed = operating_day
                    .and_then(day_midnight_utc)
                    .map(|mid| {
                        now >= mid + Duration::seconds((rows[g].0.departure + delay_seconds) as i64)
                    })
                    .unwrap_or(false);
                if departed {
                    g + 1
                } else {
                    g
                }
            }
            // No position → fall back to first stop not yet departed (pure time), else all.
            None => operating_day
                .and_then(day_midnight_utc)
                .and_then(|mid| {
                    rows.iter().position(|(st, _)| {
                        mid + Duration::seconds((st.departure + delay_seconds) as i64) >= now
                    })
                })
                .unwrap_or(0),
        };

        rows.get(start..)
            .unwrap_or(&[])
            .iter()
            .map(|(st, s)| UpcomingStop {
                stop_id: st.stop_id.clone(),
                name: s.name.clone(),
                lat: s.lat,
                lon: s.lon,
                stop_sequence: st.stop_sequence,
                scheduled_arrival: st.arrival,
                expected_arrival: st.arrival + delay_seconds,
            })
            .collect()
    }
}

/// Midnight of a `YYYY-MM-DD` local (Europe/Amsterdam) date, as a UTC instant.
fn day_midnight_utc(day: &str) -> Option<DateTime<Utc>> {
    let d = NaiveDate::parse_from_str(day, "%Y-%m-%d").ok()?;
    let naive = d.and_hms_opt(0, 0, 0)?;
    let local = chrono_tz::Europe::Amsterdam.from_local_datetime(&naive).single()?;
    Some(local.with_timezone(&Utc))
}

/// Index of the stop nearest a position (small-area lat/lon approximation).
fn nearest_stop_index(rows: &[(&StopTime, &StopInfo)], lat: f64, lon: f64) -> Option<usize> {
    if !lat.is_finite() || !lon.is_finite() {
        return None;
    }
    let coslat = lat.to_radians().cos();
    let mut best = None;
    let mut best_d = f64::MAX;
    for (i, (_, s)) in rows.iter().enumerate() {
        if !s.lat.is_finite() || !s.lon.is_finite() {
            continue;
        }
        let dlat = s.lat - lat;
        let dlon = (s.lon - lon) * coslat;
        let d = dlat * dlat + dlon * dlon;
        if d < best_d {
            best_d = d;
            best = Some(i);
        }
    }
    best
}

impl GtfsStore {
    /// Fill schedule-derived fields onto a live trip. Idempotent.
    fn enrich_trip(&self, trip: &mut LiveTrip) {
        if trip.matched_trip_id.is_none() {
            trip.matched_trip_id = self.match_trip_id(trip);
        }
        if let Some(tid) = trip.matched_trip_id.clone() {
            if let Some(t) = self.trips.get(&tid) {
                if trip.destination.is_none() && !t.headsign.is_empty() {
                    trip.destination = Some(t.headsign.clone());
                }
                if trip.block_code.is_none() {
                    trip.block_code = t.block_id.clone();
                }
                if let Some(r) = self.routes.get(&t.route_id) {
                    if trip.line_public_number.is_none() && !r.short_name.is_empty() {
                        trip.line_public_number = Some(r.short_name.clone());
                    }
                    if trip.vehicle_type == VehicleType::Unknown {
                        trip.vehicle_type = r.vehicle_type;
                    }
                    if trip.operator_name.is_none() {
                        trip.operator_name = r
                            .agency_id
                            .as_ref()
                            .and_then(|a| self.agencies.get(a))
                            .cloned();
                    }
                    if trip.agency_id.is_none() {
                        trip.agency_id = r.agency_id.clone();
                    }
                    if trip.line_color.is_none() {
                        trip.line_color = r.color.clone();
                        trip.line_text_color = r.text_color.clone();
                    }
                }
            }
        }
    }
}

/// The service holds an `Arc<GtfsStore>` and enriches trips against the current feed.
/// `ovlive-gtfs::GtfsService` implements this by delegating to the loaded store.
impl Enricher for GtfsStore {
    fn enrich(&self, trip: &mut LiveTrip) {
        self.enrich_trip(trip);
    }
}

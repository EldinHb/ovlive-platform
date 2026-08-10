//! In-memory GTFS store: compact lookups for enrichment and vehicle-detail queries.

use std::collections::HashMap;

use chrono::{DateTime, NaiveDate, Utc};
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
    /// This trip's own `trips.txt.realtime_trip_id`.
    ///
    /// Held per trip rather than recovered by inverting [`GtfsStore::trip_by_key`]: that map
    /// collapses the ~2.1 trips that share each realtime id (one per operating pattern), so
    /// the inverse only ever names one of them and every other day's trip would look as
    /// though the feed gave it no realtime id at all.
    pub realtime_trip_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct StopInfo {
    pub stop_id: String,
    pub name: String,
    pub lat: f64,
    pub lon: f64,
    /// `stops.txt.stop_code` — the operator's stop code. **This is what KV6 calls
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

/// A candidate rail trip for one train number, indexed by [`GtfsStore::train_trips`].
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrainTrip {
    pub trip_id: String,
    /// Middle component of the trip's `realtime_trip_id` — the train *type* code gtfs-nl uses
    /// as the line: `SPR`, `IC`, `ICD`, `ICE`, `NJ`, … Stored per candidate because it's the
    /// only place the code appears, and the NS position feed doesn't publish it.
    pub line_code: String,
}

/// One scheduled call on a trip, for the vehicle-detail trip plan.
///
/// Schedule only — no expected times, and the whole trip rather than the part still ahead.
/// Both of those depend on the vehicle (its delay and its position), and a client already
/// holds both from the live stream: expected is `scheduled + delay`, and "still ahead" is a
/// comparison against the stop the vehicle is nearest. Keeping them out is what makes this
/// payload constant for the duration of a trip, so it can be fetched once instead of on
/// every detail poll alongside the route shape.
#[derive(Debug, Clone, Serialize)]
pub struct TripStop {
    pub stop_id: String,
    pub name: String,
    pub lat: f64,
    pub lon: f64,
    pub stop_sequence: u32,
    /// Seconds since the operating day's local midnight (may exceed 86400 for
    /// after-midnight service).
    pub scheduled_arrival: i32,
    pub scheduled_departure: i32,
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
    /// Train number (`trips.txt.trip_short_name`) -> every rail trip that runs under it.
    ///
    /// The join for NS InfoPlus positions, which identify a train **only** by its number:
    /// no line code and no operating day, so `trip_by_key` can't be used and the day has to
    /// be resolved against `service_dates` instead. That's also why candidates are *not*
    /// collapsed the way `trip_by_key` collapses them — the same number is a different trip
    /// on each operating pattern (median 2 candidates, max 34 across the feed's span), and
    /// keeping only the last would usually leave one that doesn't run today.
    ///
    /// Rail routes only (`route_type` 2). gtfs-nl also files rail-replacement buses under
    /// `IFF:`, reusing the train number; a GPS-reporting train is always the rail trip.
    pub train_trips: HashMap<String, Vec<TrainTrip>>,
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

    /// Resolve a train number to the rail trip running it on `date`, falling back to the
    /// previous service date. Returns the trip **and the date it runs on**.
    ///
    /// The fallback is what covers after-midnight service: a train that left at 23:50 is
    /// still on yesterday's service date at 00:30, and NS publishes no operating day for us
    /// to disambiguate with. Numbers are effectively unique per service date (measured:
    /// 7747 distinct numbers across 7748 rail trips on one day — the single duplicate is a
    /// Nightjet that splits into two portions), so the first match is the right one.
    pub fn resolve_train_trip(&self, number: &str, date: NaiveDate) -> Option<(&TrainTrip, NaiveDate)> {
        let candidates = self.train_trips.get(number)?;
        let mut day = date;
        for _ in 0..2 {
            let key = date_key(day);
            if let Some(c) = candidates.iter().find(|c| self.trip_runs_on(&c.trip_id, key)) {
                return Some((c, day));
            }
            day = day.pred_opt()?;
        }
        None
    }

    fn trip_runs_on(&self, trip_id: &str, date: u32) -> bool {
        self.trips.get(trip_id).is_some_and(|t| self.runs_on(&t.service_id, date))
    }

    /// Every scheduled call on a trip, in order.
    ///
    /// The whole trip, not the remainder: which calls are still ahead depends on the
    /// vehicle's live position and delay, both of which the client already has, and cutting
    /// the list server-side is what would otherwise force this (and the route shape beside
    /// it) into the polled detail response.
    pub fn trip_stops(&self, trip_id: &str) -> Vec<TripStop> {
        let Some(times) = self.stop_times.get(trip_id) else {
            return Vec::new();
        };
        times
            .iter()
            .filter_map(|st| {
                let s = self.stops.get(&st.stop_id)?;
                Some(TripStop {
                    stop_id: st.stop_id.clone(),
                    name: s.name.clone(),
                    lat: s.lat,
                    lon: s.lon,
                    stop_sequence: st.stop_sequence,
                    scheduled_arrival: st.arrival,
                    scheduled_departure: st.departure,
                })
            })
            .collect()
    }
}

/// A date as the `YYYYMMDD` integer `service_dates` is keyed by.
fn date_key(d: NaiveDate) -> u32 {
    d.format("%Y%m%d").to_string().parse().unwrap_or(0)
}

impl GtfsStore {
    /// Fill schedule-derived fields onto a live trip. Idempotent.
    fn enrich_trip(&self, trip: &mut LiveTrip) {
        if trip.matched_trip_id.is_none() {
            trip.matched_trip_id = match trip.key.dataowner.as_str() {
                TRAIN_DATAOWNER => self.match_train_trip(trip),
                _ => self.match_trip_id(trip),
            };
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

/// Vehicle-key namespace for trains, mirroring `ovlive_realtime::TRAIN_DATAOWNER`. Kept as a
/// literal rather than a dependency: `ovlive-gtfs` doesn't otherwise know about the feeds, and
/// this is really a property of gtfs-nl — the prefix it gives every rail `realtime_trip_id`.
const TRAIN_DATAOWNER: &str = "IFF";

impl GtfsStore {
    /// Resolve a train's GTFS trip from its number, and backfill the parts of the vehicle
    /// identity that the NS position feed doesn't publish.
    ///
    /// Setting `line_planning_number` to the matched trip's code is what makes
    /// [`LiveTrip::realtime_trip_id`] come out as gtfs-nl's own `IFF:SPR:8743`, so a train
    /// resolves like any other vehicle — including from stop departure boards, which look up
    /// live vehicles by exactly that key.
    fn match_train_trip(&self, trip: &mut LiveTrip) -> Option<String> {
        let number = trip.journey_number.clone()?;
        // The fix time is the only clock we have, and it's the right one: it dates the
        // position, so an after-midnight train resolves against the service date it ran on.
        // RitInfo publishes the operating day outright (`TreinDatum`); only fall back to
        // deriving it from the fix time when we haven't heard a RitInfo for this train.
        let from_feed = trip
            .operating_day
            .as_deref()
            .and_then(|d| NaiveDate::parse_from_str(d, "%Y-%m-%d").ok());
        let date = from_feed.unwrap_or_else(|| service_date_local(trip.last_update));
        let (matched, day) = self.resolve_train_trip(&number, date)?;
        let (trip_id, line_code) = (matched.trip_id.clone(), matched.line_code.clone());
        trip.line_planning_number = Some(line_code.clone());
        // `IC` / `SPR` rather than the route's `route_short_name`, which for rail is the prose
        // "Intercity" / "Sprinter" — too long for a map marker, and the code is how NS
        // labels trains publicly anyway.
        if trip.line_public_number.is_none() {
            trip.line_public_number = Some(line_code);
        }
        // Trains report no operating day; the date the match resolved on is it — which for an
        // after-midnight train is yesterday. Feeds `upcoming_stops`, whose schedule times are
        // seconds since that day's local midnight.
        if trip.operating_day.is_none() {
            trip.operating_day = Some(day.format("%Y-%m-%d").to_string());
        }
        Some(trip_id)
    }
}

/// The service date (Europe/Amsterdam calendar day) an instant falls on.
fn service_date_local(at: DateTime<Utc>) -> NaiveDate {
    at.with_timezone(&chrono_tz::Europe::Amsterdam).date_naive()
}

/// The service holds an `Arc<GtfsStore>` and enriches trips against the current feed.
/// `ovlive-gtfs::GtfsService` implements this by delegating to the loaded store.
impl Enricher for GtfsStore {
    fn enrich(&self, trip: &mut LiveTrip) {
        self.enrich_trip(trip);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ovlive_core::VehicleKey;

    /// Train 8743 runs as two separate trips: T-MON on 2026-07-27 and T-TUE on 2026-07-28.
    /// Same number, same line code, different operating pattern — exactly the shape that
    /// makes a collapsed `realtime_trip_id` index useless for trains.
    fn store_with_train() -> GtfsStore {
        let mut s = GtfsStore::default();
        s.agencies.insert("IFF:NS".into(), "NS".into());
        s.routes.insert(
            "R1".into(),
            RouteInfo {
                route_id: "R1".into(),
                agency_id: Some("IFF:NS".into()),
                short_name: "Sprinter".into(),
                long_name: "Hoorn <-> Gouda".into(),
                vehicle_type: VehicleType::Train,
                color: None,
                text_color: None,
            },
        );
        for (trip_id, service_id) in [("T-MON", "S-MON"), ("T-TUE", "S-TUE")] {
            s.trips.insert(
                trip_id.into(),
                TripInfo {
                    trip_id: trip_id.into(),
                    route_id: "R1".into(),
                    headsign: "Gouda".into(),
                    block_id: None,
                    shape_id: None,
                    service_id: service_id.into(),
                    long_name: "Sprinter".into(),
                    realtime_trip_id: Some("IFF:SPR:8743".into()),
                },
            );
            s.train_trips.entry("8743".into()).or_default().push(TrainTrip {
                trip_id: trip_id.into(),
                line_code: "SPR".into(),
            });
        }
        s.service_dates.insert("S-MON".into(), vec![20_260_727]);
        s.service_dates.insert("S-TUE".into(), vec![20_260_728]);
        s
    }

    fn train_at(ts: &str) -> LiveTrip {
        let key = VehicleKey { dataowner: "IFF".into(), vehicle_number: "8743".into() };
        let at = DateTime::parse_from_rfc3339(ts).unwrap().with_timezone(&Utc);
        let mut t = LiveTrip::new(key, at);
        t.journey_number = Some("8743".into()); // what `parse_ns_treinposities` sets
        t
    }

    #[test]
    fn resolves_the_trip_running_on_the_fix_date() {
        let s = store_with_train();
        let d = |y, m, day| NaiveDate::from_ymd_opt(y, m, day).unwrap();
        assert_eq!(s.resolve_train_trip("8743", d(2026, 7, 28)).unwrap().0.trip_id, "T-TUE");
        assert_eq!(s.resolve_train_trip("8743", d(2026, 7, 27)).unwrap().0.trip_id, "T-MON");
        // Two days on from any candidate, the previous-day fallback no longer reaches.
        assert!(s.resolve_train_trip("8743", d(2026, 7, 30)).is_none());
        assert!(s.resolve_train_trip("9999", d(2026, 7, 28)).is_none());
    }

    #[test]
    fn enriches_a_train_from_its_number() {
        let s = store_with_train();
        // 12:00Z on the Tuesday.
        let mut t = train_at("2026-07-28T12:00:00Z");
        s.enrich(&mut t);

        assert_eq!(t.matched_trip_id.as_deref(), Some("T-TUE"));
        assert_eq!(t.destination.as_deref(), Some("Gouda"));
        assert_eq!(t.vehicle_type, VehicleType::Train);
        assert_eq!(t.operator_name.as_deref(), Some("NS"));
        assert_eq!(t.operating_day.as_deref(), Some("2026-07-28"));
        // The line code, not the route's prose name — and it reconstructs the GTFS key, which
        // is what lets a stop departure board find this train.
        assert_eq!(t.line_public_number.as_deref(), Some("SPR"));
        assert_eq!(t.line_planning_number.as_deref(), Some("SPR"));
        assert_eq!(t.realtime_trip_id().as_deref(), Some("IFF:SPR:8743"));
    }

    /// A train still running after midnight belongs to the *previous* service date, and the
    /// NS feed gives us no operating day to say so.
    #[test]
    fn after_midnight_train_resolves_to_yesterdays_service() {
        let s = store_with_train();
        // 00:30 Amsterdam on Wednesday 29th = 22:30Z Tuesday... so use a fix that is
        // Wednesday *local*: 23:30Z on the 28th is 01:30 local on the 29th.
        let mut t = train_at("2026-07-28T23:30:00Z");
        assert_eq!(service_date_local(t.last_update), NaiveDate::from_ymd_opt(2026, 7, 29).unwrap());
        s.enrich(&mut t);
        assert_eq!(t.matched_trip_id.as_deref(), Some("T-TUE"));
        assert_eq!(t.operating_day.as_deref(), Some("2026-07-28"), "yesterday's service date");
    }

    /// Non-rail vehicles must keep using the KV6 `realtime_trip_id` join untouched.
    #[test]
    fn bus_enrichment_still_joins_on_realtime_trip_id() {
        let mut s = store_with_train();
        s.routes.insert(
            "R2".into(),
            RouteInfo {
                route_id: "R2".into(),
                agency_id: Some("IFF:NS".into()),
                short_name: "42".into(),
                long_name: "".into(),
                vehicle_type: VehicleType::Bus,
                color: None,
                text_color: None,
            },
        );
        s.trips.insert(
            "TB".into(),
            TripInfo {
                trip_id: "TB".into(),
                route_id: "R2".into(),
                headsign: "Blaak".into(),
                block_id: None,
                shape_id: None,
                service_id: "S-TUE".into(),
                long_name: "".into(),
                realtime_trip_id: Some("RET:M1:1001".into()),
            },
        );
        s.trip_by_key.insert("RET:M1:1001".into(), "TB".into());

        let key = VehicleKey { dataowner: "RET".into(), vehicle_number: "1001".into() };
        let mut t = LiveTrip::new(key, Utc::now());
        t.line_planning_number = Some("M1".into());
        t.journey_number = Some("1001".into());
        s.enrich(&mut t);

        assert_eq!(t.matched_trip_id.as_deref(), Some("TB"));
        assert_eq!(t.line_public_number.as_deref(), Some("42"), "route_short_name, as before");
    }
}

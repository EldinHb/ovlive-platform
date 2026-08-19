//! In-memory live-trip state, lifecycle rules, and the per-tick spatial index.

use std::collections::HashMap;
use std::sync::Arc;

use chrono::{DateTime, Duration, Utc};
use dashmap::DashMap;
use rstar::{primitives::GeomWithData, RTree, AABB};

use crate::filter::{BBox, Filters};
use crate::model::{LiveTrip, MessageKind, PosEvent};
use crate::rd;
use crate::trains::TrainDelays;

/// Vehicle-key namespace for trains — see `ovlive_realtime::TRAIN_DATAOWNER`. Trains are the
/// only vehicles whose punctuality arrives on a different feed from their positions.
const TRAIN_DATAOWNER: &str = "IFF";

/// Fills schedule-derived fields (public line number, destination, vehicle type,
/// operator, matched GTFS trip id) onto a live trip. Implemented by `ovlive-gtfs`.
pub trait Enricher: Send + Sync {
    fn enrich(&self, trip: &mut LiveTrip);

    /// The station a fix-less trip is at, per its matched GTFS trip's schedule and its
    /// reported punctuality — `(lat, lon)`, or `None` when no scheduled call sits close
    /// enough to claim. Consulted per message (unlike [`Enricher::enrich`], which is lazy),
    /// because the answer changes with every station call. Exists for vehicles that report
    /// no coordinates at all — RET metros foremost; see `LiveTrip::schedule_positioned`.
    fn scheduled_position(&self, _trip: &LiveTrip) -> Option<(f64, f64)> {
        None
    }
}

/// A no-op enricher for tests / running without GTFS loaded yet.
pub struct NoEnricher;
impl Enricher for NoEnricher {
    fn enrich(&self, _trip: &mut LiveTrip) {}
}

/// The authoritative in-memory set of currently-active trips, keyed by vehicle id.
///
/// Writes come from the realtime ingestion tasks; reads come from the WS tick loop and
/// REST handlers. `DashMap` gives us sharded concurrency without a global lock.
pub struct LiveState {
    trips: DashMap<String, LiveTrip>,
    /// Reverse index: vehicle key id -> current trip id. Identical here (id == key id),
    /// but kept explicit so the "new trip replaces old" rule reads clearly.
    stale_after: Duration,
    /// Delay curves for trains, whose positions carry no punctuality. `None` disables the
    /// lookup entirely, which is what tests and a train-less deployment want.
    train_delays: Option<Arc<TrainDelays>>,
}

impl LiveState {
    pub fn new(stale_after_secs: i64) -> Self {
        Self {
            trips: DashMap::new(),
            stale_after: Duration::seconds(stale_after_secs),
            train_delays: None,
        }
    }

    /// Attach the RitInfo-derived delay curves consulted for train positions.
    pub fn with_train_delays(mut self, delays: Arc<TrainDelays>) -> Self {
        self.train_delays = Some(delays);
        self
    }

    /// Fill in what the NS position feed can't: punctuality, and the operating day.
    ///
    /// Read on every position update rather than copied once, because a curve stays valid
    /// while the train advances through it — the delay it reports changes with `now` even
    /// when no new RitInfo has arrived.
    fn apply_train_delay(&self, trip: &mut LiveTrip) {
        if trip.key.dataowner != TRAIN_DATAOWNER {
            return;
        }
        let Some(delays) = self.train_delays.as_ref() else { return };
        let Some(number) = trip.journey_number.clone() else { return };
        let Some(curve) = delays.get(&number) else { return };
        if let Some(d) = curve.at(trip.last_update) {
            trip.delay_seconds = d;
            trip.delay_known = true;
        }
        // RitInfo knows the operating day outright; the position feed leaves us guessing it
        // from the fix time, which is wrong for a train running past midnight.
        if let Some(day) = curve.operating_day {
            trip.operating_day = Some(day);
        }
        // The line code, but NOT `line_public_number`: enrichment is gated on that being
        // None, so filling it here would stop GTFS ever attaching the headsign, route colours
        // and matched trip. GTFS overwrites this with its own code once it matches.
        if trip.line_planning_number.is_none() {
            trip.line_planning_number = curve.line_code;
        }
    }

    pub fn len(&self) -> usize {
        self.trips.len()
    }

    pub fn is_empty(&self) -> bool {
        self.trips.is_empty()
    }

    pub fn get(&self, id: &str) -> Option<LiveTrip> {
        self.trips.get(id).map(|t| t.clone())
    }

    /// Clone all current trips (used when writing a snapshot).
    pub fn all_trips(&self) -> Vec<LiveTrip> {
        self.trips.iter().map(|t| t.clone()).collect()
    }

    /// Load a set of trips (used when restoring a snapshot on boot).
    pub fn load(&self, trips: Vec<LiveTrip>) {
        for t in trips {
            self.trips.insert(t.id.clone(), t);
        }
    }

    /// Apply a normalized realtime event, enforcing the trip lifecycle rules.
    /// Returns the affected vehicle id and whether it was removed.
    pub fn apply(&self, ev: PosEvent, enricher: &dyn Enricher) -> (String, bool) {
        let id = ev.key.id();

        match ev.kind {
            // A vehicle sending INIT starts a fresh trip; any prior trip for the same
            // vehicle is implicitly over, so we replace it wholesale.
            MessageKind::Init => {
                let mut trip = LiveTrip::new(ev.key.clone(), ev.timestamp);
                trip.has_init = true;
                apply_fields(&mut trip, &ev);
                self.apply_train_delay(&mut trip);
                enricher.enrich(&mut trip);
                anchor_to_schedule(&mut trip, &ev, enricher);
                self.trips.insert(id.clone(), trip);
                (id, false)
            }
            // END terminates the trip.
            MessageKind::End => {
                self.trips.remove(&id);
                (id, true)
            }
            // All other messages update the existing trip (creating one if we somehow
            // missed the INIT — best-effort feeds drop messages).
            _ => {
                let mut entry = self
                    .trips
                    .entry(id.clone())
                    .or_insert_with(|| LiveTrip::new(ev.key.clone(), ev.timestamp));

                // journey/line change without an END => treat as a new trip.
                let new_journey = ev.journey_number.is_some()
                    && ev.journey_number != entry.journey_number
                    && entry.journey_number.is_some();
                if new_journey {
                    *entry = LiveTrip::new(ev.key.clone(), ev.timestamp);
                }

                match ev.kind {
                    MessageKind::Arrival | MessageKind::OnStop => {
                        entry.at_stop = true;
                        entry.current_stop_id = ev.user_stop_code.clone();
                    }
                    MessageKind::Departure | MessageKind::OnRoute => {
                        entry.at_stop = false;
                        entry.current_stop_id = None;
                    }
                    _ => {}
                }
                apply_fields(&mut entry, &ev);
                self.apply_train_delay(&mut entry);
                let needs_enrich = entry.line_public_number.is_none();
                if needs_enrich {
                    enricher.enrich(&mut entry);
                }
                anchor_to_schedule(&mut entry, &ev, enricher);
                (id, false)
            }
        }
    }

    /// Remove trips that have not sent an update within the staleness window.
    /// Returns the removed ids so the API can notify clients.
    pub fn prune_stale(&self, now: DateTime<Utc>) -> Vec<String> {
        let cutoff = now - self.stale_after;
        let mut removed = Vec::new();
        self.trips.retain(|id, t| {
            let keep = t.last_update >= cutoff;
            if !keep {
                removed.push(id.clone());
            }
            keep
        });
        removed
    }

    /// Build an immutable spatial snapshot of all positioned trips for this tick.
    pub fn build_index(&self) -> Arc<VehicleIndex> {
        let mut vehicles: Vec<LiveTrip> = Vec::with_capacity(self.trips.len());
        for t in self.trips.iter() {
            if t.has_position() {
                vehicles.push(t.clone());
            }
        }
        let points: Vec<GeomWithData<[f64; 2], usize>> = vehicles
            .iter()
            .enumerate()
            .map(|(i, t)| GeomWithData::new([t.lon, t.lat], i))
            .collect();
        // Id → slot, so pinned vehicles can be fetched directly (bypassing the bbox query).
        let by_id = vehicles
            .iter()
            .enumerate()
            .map(|(i, t)| (t.id.clone(), i))
            .collect();
        // Same for the OVapi `realtime_trip_id`. Built here, once per tick, rather than by
        // scanning `trips` per request: the legacy stop-departure boards resolve many of
        // these ids in one request, which would otherwise be O(vehicles × ids).
        let by_rt_id = vehicles
            .iter()
            .enumerate()
            .filter_map(|(i, t)| t.realtime_trip_id().map(|k| (k, i)))
            .collect();
        Arc::new(VehicleIndex {
            tree: RTree::bulk_load(points),
            vehicles,
            by_id,
            by_rt_id,
        })
    }
}

/// The position an event carries, if any: WGS84 straight from the feed (NS InfoPlus) wins
/// over Rijksdriehoek (KV6); converting RD is only worth doing when that's all we were given.
fn fix_from(ev: &PosEvent) -> Option<(f64, f64)> {
    match (ev.lat, ev.lon) {
        (Some(lat), Some(lon)) => Some((lat, lon)),
        _ => match (ev.rd_x, ev.rd_y) {
            (Some(x), Some(y)) => Some(rd::rd_to_wgs84(x, y)),
            _ => None,
        },
    }
}

/// Move a trip to a new position, deriving bearing from the previous one. Shared by real
/// fixes and schedule-anchored placements, so a metro hopping station-to-station points
/// along its direction of travel exactly like a GPS vehicle does.
fn set_position(trip: &mut LiveTrip, lat: f64, lon: f64) {
    if trip.has_position() {
        let b = rd::bearing(trip.lat, trip.lon, lat, lon);
        // Keep old bearing if the vehicle barely moved (avoids jitter when stopped).
        if (lat - trip.lat).abs() > 1e-6 || (lon - trip.lon).abs() > 1e-6 {
            trip.bearing = b;
        }
        trip.prev_lat = trip.lat;
        trip.prev_lon = trip.lon;
    }
    trip.lat = lat;
    trip.lon = lon;
}

/// Anchor a fix-less trip to its scheduled station, when the enricher can name one.
///
/// Runs after `apply_fields` and enrichment, so the trip already carries the event's
/// punctuality and (once matched) its GTFS trip. Two deliberate gates:
///
/// - Only station-lifecycle messages move the anchor (INIT/ARRIVAL/ONSTOP/DEPARTURE): they
///   assert "at stop X now". ONROUTE asserts only "between stops" — anchoring on it would
///   hop the dot to whichever station is temporally nearer, i.e. ahead of the truth.
/// - Never touches a vehicle that has ever produced a real fix: `apply_fields` clears
///   `schedule_positioned` on every real fix, so a positioned-but-not-flagged trip is a GPS
///   vehicle in a dropout, which keeps its last true position instead of snapping to a stop.
fn anchor_to_schedule(trip: &mut LiveTrip, ev: &PosEvent, enricher: &dyn Enricher) {
    let station_event = matches!(
        ev.kind,
        MessageKind::Init | MessageKind::Arrival | MessageKind::OnStop | MessageKind::Departure
    );
    if !station_event || (trip.has_position() && !trip.schedule_positioned) {
        return;
    }
    if let Some((lat, lon)) = enricher.scheduled_position(trip) {
        set_position(trip, lat, lon);
        trip.schedule_positioned = true;
    }
}

fn apply_fields(trip: &mut LiveTrip, ev: &PosEvent) {
    if let Some((lat, lon)) = fix_from(ev) {
        set_position(trip, lat, lon);
        // A real fix outranks any schedule-derived stand-in, permanently: a vehicle that has
        // GPS must never be snapped back to a station by a later fix-less message.
        trip.schedule_positioned = false;
    }
    // A feed-supplied course beats anything derived from two fixes, and unlike the derived
    // value it's still right when the vehicle has only ever reported one position. The NS
    // feed omits it while stopped (see `parse_ns_treinposities`), so the old bearing holds.
    if let Some(b) = ev.bearing {
        trip.bearing = b;
    }
    // Speed is only ever what the feed measured (NS `Snelheid`); a fix-less message leaves the
    // last measurement standing, exactly as the position does.
    if let Some(kmh) = ev.speed_kmh {
        trip.speed_kmh = Some(kmh);
    }
    if let Some(t) = ev.vehicle_type {
        if trip.vehicle_type == crate::model::VehicleType::Unknown {
            trip.vehicle_type = t;
        }
    }
    if let Some(p) = ev.punctuality {
        trip.delay_seconds = p;
        trip.delay_known = true;
    }
    trip.last_kind = Some(ev.kind);
    if ev.line_planning_number.is_some() {
        trip.line_planning_number = ev.line_planning_number.clone();
    }
    if ev.journey_number.is_some() {
        trip.journey_number = ev.journey_number.clone();
    }
    if ev.operating_day.is_some() {
        trip.operating_day = ev.operating_day.clone();
    }
    if ev.block_code.is_some() {
        trip.block_code = ev.block_code.clone();
    }
    trip.last_update = ev.timestamp;
}

/// Immutable per-tick spatial index. Shared across all WS connections via `Arc`.
pub struct VehicleIndex {
    tree: RTree<GeomWithData<[f64; 2], usize>>,
    vehicles: Vec<LiveTrip>,
    by_id: HashMap<String, usize>,
    by_rt_id: HashMap<String, usize>,
}

impl VehicleIndex {
    pub fn len(&self) -> usize {
        self.vehicles.len()
    }

    pub fn is_empty(&self) -> bool {
        self.vehicles.is_empty()
    }

    /// Fetch a single trip by id regardless of viewport or filters. Used to stream pinned
    /// (selected) vehicles that have fallen outside the client's viewport. `None` if the
    /// trip no longer exists (ended / pruned as stale).
    pub fn get(&self, id: &str) -> Option<&LiveTrip> {
        self.by_id.get(id).map(|&i| &self.vehicles[i])
    }

    /// Fetch a trip by its OVapi `realtime_trip_id`
    /// (`"<dataowner>:<line_planning_number>:<journey_number>"`).
    pub fn get_by_realtime_trip_id(&self, rt_id: &str) -> Option<&LiveTrip> {
        self.by_rt_id.get(rt_id).map(|&i| &self.vehicles[i])
    }

    /// Resolve either id form: the vehicle id (`"<dataowner>:<vehicle_number>"`, 2 parts)
    /// or the legacy `realtime_trip_id` (3 parts). Both are colon-delimited and the part
    /// count disambiguates them, so one lookup serves clients on either scheme.
    pub fn get_any(&self, id: &str) -> Option<&LiveTrip> {
        if id.split(':').count() >= 3 {
            self.get_by_realtime_trip_id(id).or_else(|| self.get(id))
        } else {
            self.get(id).or_else(|| self.get_by_realtime_trip_id(id))
        }
    }

    /// All trips whose position falls inside `bbox` and that pass `filters`.
    pub fn query(&self, bbox: BBox, filters: &Filters) -> Vec<&LiveTrip> {
        let aabb = AABB::from_corners([bbox.min_lon, bbox.min_lat], [bbox.max_lon, bbox.max_lat]);
        self.tree
            .locate_in_envelope(&aabb)
            .map(|p| &self.vehicles[p.data])
            .filter(|t| filters.matches(t))
            .collect()
    }

    /// Full snapshot (no geo filter) passing `filters` — used by REST when no bbox given.
    pub fn all(&self, filters: &Filters) -> Vec<&LiveTrip> {
        self.vehicles.iter().filter(|t| filters.matches(t)).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{VehicleKey, VehicleType};

    fn ev(kind: MessageKind, journey: &str, x: f64, y: f64) -> PosEvent {
        PosEvent {
            key: VehicleKey {
                dataowner: "RET".into(),
                vehicle_number: "1001".into(),
            },
            kind,
            line_planning_number: Some("M1".into()),
            journey_number: Some(journey.into()),
            operating_day: Some("2026-07-07".into()),
            block_code: Some("42".into()),
            rd_x: Some(x),
            rd_y: Some(y),
            lat: None,
            lon: None,
            bearing: None,
            speed_kmh: None,
            vehicle_type: None,
            punctuality: Some(60),
            user_stop_code: Some("HAL1".into()),
            timestamp: Utc::now(),
        }
    }

    #[test]
    fn init_then_end_removes_trip() {
        let s = LiveState::new(240);
        s.apply(ev(MessageKind::Init, "1", 120_700.0, 487_200.0), &NoEnricher);
        assert_eq!(s.len(), 1);
        let (_, removed) = s.apply(ev(MessageKind::End, "1", 120_700.0, 487_200.0), &NoEnricher);
        assert!(removed);
        assert_eq!(s.len(), 0);
    }

    #[test]
    fn onstop_sets_at_stop_then_departure_clears() {
        let s = LiveState::new(240);
        s.apply(ev(MessageKind::Init, "1", 120_700.0, 487_200.0), &NoEnricher);
        s.apply(ev(MessageKind::OnStop, "1", 120_700.0, 487_200.0), &NoEnricher);
        assert!(s.get("RET:1001").unwrap().at_stop);
        s.apply(ev(MessageKind::Departure, "1", 120_800.0, 487_200.0), &NoEnricher);
        assert!(!s.get("RET:1001").unwrap().at_stop);
    }

    #[test]
    fn new_journey_replaces_trip_without_end() {
        let s = LiveState::new(240);
        s.apply(ev(MessageKind::Init, "1", 120_700.0, 487_200.0), &NoEnricher);
        s.apply(ev(MessageKind::OnRoute, "2", 120_800.0, 487_200.0), &NoEnricher);
        // still one vehicle, but the journey rolled over.
        assert_eq!(s.len(), 1);
        assert_eq!(s.get("RET:1001").unwrap().journey_number.as_deref(), Some("2"));
    }

    #[test]
    fn tracks_the_last_message_kind() {
        let s = LiveState::new(240);
        s.apply(ev(MessageKind::Init, "1", 120_700.0, 487_200.0), &NoEnricher);
        assert_eq!(s.get("RET:1001").unwrap().last_kind, Some(MessageKind::Init));
        s.apply(ev(MessageKind::Offroute, "1", 120_700.0, 487_200.0), &NoEnricher);
        // `at_stop` alone can't express this; the kind can.
        assert_eq!(s.get("RET:1001").unwrap().last_kind, Some(MessageKind::Offroute));
    }

    #[test]
    fn index_resolves_either_id_form() {
        let s = LiveState::new(240);
        s.apply(ev(MessageKind::Init, "7", 120_700.0, 487_200.0), &NoEnricher);
        let idx = s.build_index();

        // Vehicle id (2 parts) and legacy realtime_trip_id (3 parts) reach the same trip.
        assert_eq!(idx.get("RET:1001").unwrap().id, "RET:1001");
        assert_eq!(idx.get_by_realtime_trip_id("RET:M1:7").unwrap().id, "RET:1001");
        assert_eq!(idx.get_any("RET:1001").unwrap().id, "RET:1001");
        assert_eq!(idx.get_any("RET:M1:7").unwrap().id, "RET:1001");
        assert!(idx.get_any("RET:M1:999").is_none());
        assert!(idx.get_any("nonsense").is_none());
    }

    #[test]
    fn realtime_trip_id_needs_line_and_journey() {
        let key = VehicleKey { dataowner: "RET".into(), vehicle_number: "1001".into() };
        let mut t = LiveTrip::new(key, Utc::now());
        assert_eq!(t.realtime_trip_id(), None);
        t.line_planning_number = Some("M1".into());
        assert_eq!(t.realtime_trip_id(), None, "journey still missing");
        t.journey_number = Some("7".into());
        assert_eq!(t.realtime_trip_id().as_deref(), Some("RET:M1:7"));
    }

    /// A train's position carries no punctuality; it has to come from the RitInfo curve, and
    /// must stay *unknown* rather than default to 0 when there's no curve for that train.
    #[test]
    fn train_delay_comes_from_the_ritinfo_curve() {
        use crate::trains::{DelayPoint, TrainDelays, TrainUpdate};

        let now = Utc::now();
        let delays = Arc::new(TrainDelays::new());
        delays.apply(
            TrainUpdate {
                number: "8743".into(),
                operating_day: Some("2026-07-28".into()),
                line_code: Some("SPR".into()),
                points: vec![DelayPoint { at: now + Duration::minutes(5), delay_seconds: 180 }],
            },
            now,
        );
        let s = LiveState::new(240).with_train_delays(delays);

        let train = |number: &str| PosEvent {
            key: VehicleKey { dataowner: "IFF".into(), vehicle_number: number.into() },
            kind: MessageKind::OnRoute,
            line_planning_number: None,
            journey_number: Some(number.into()),
            operating_day: None,
            block_code: None,
            rd_x: None,
            rd_y: None,
            lat: Some(52.1),
            lon: Some(4.6),
            bearing: Some(90.0),
            speed_kmh: Some(112.0),
            vehicle_type: Some(VehicleType::Train),
            punctuality: None,
            user_stop_code: None,
            timestamp: now,
        };

        s.apply(train("8743"), &NoEnricher);
        let t = s.get("IFF:8743").unwrap();
        assert_eq!(t.delay_seconds, 180);
        assert!(t.delay_known);
        // RitInfo also supplies what the position feed omits.
        assert_eq!(t.operating_day.as_deref(), Some("2026-07-28"));
        assert_eq!(t.line_planning_number.as_deref(), Some("SPR"));
        assert_eq!(t.vehicle_type, VehicleType::Train);
        // WGS84 straight through, feed-supplied course kept.
        assert_eq!((t.lat, t.lon), (52.1, 4.6));
        assert_eq!(t.bearing, 90.0);
        // Speed too — the one measurement KV6 vehicles never have.
        assert_eq!(t.speed_kmh, Some(112.0));

        // No curve for this train: 0 would be a claim of punctuality we can't make.
        s.apply(train("9999"), &NoEnricher);
        let u = s.get("IFF:9999").unwrap();
        assert_eq!(u.delay_seconds, 0);
        assert!(!u.delay_known, "absence of data must not read as on time");
    }

    /// KV6 punctuality still marks the delay as known, so buses are unaffected.
    #[test]
    fn kv6_punctuality_marks_delay_known() {
        let s = LiveState::new(240);
        s.apply(ev(MessageKind::Init, "1", 120_700.0, 487_200.0), &NoEnricher);
        let t = s.get("RET:1001").unwrap();
        assert_eq!(t.delay_seconds, 60);
        assert!(t.delay_known);

        // A message without punctuality leaves it unknown rather than silently on time.
        let mut e = ev(MessageKind::OnRoute, "1", 120_700.0, 487_200.0);
        e.punctuality = None;
        let s2 = LiveState::new(240);
        s2.apply(e, &NoEnricher);
        assert!(!s2.get("RET:1001").unwrap().delay_known);
    }

    #[test]
    fn prune_removes_only_stale() {
        let s = LiveState::new(240);
        let mut e = ev(MessageKind::Init, "1", 120_700.0, 487_200.0);
        e.timestamp = Utc::now() - Duration::seconds(600);
        s.apply(e, &NoEnricher);
        let removed = s.prune_stale(Utc::now());
        assert_eq!(removed, vec!["RET:1001".to_string()]);
    }

    #[test]
    fn index_query_respects_bbox() {
        let s = LiveState::new(240);
        s.apply(ev(MessageKind::Init, "1", 120_700.0, 487_200.0), &NoEnricher); // ~Amsterdam
        let idx = s.build_index();
        let all = idx.query(
            BBox { min_lat: 50.0, min_lon: 3.0, max_lat: 54.0, max_lon: 7.5 },
            &Filters::default(),
        );
        assert_eq!(all.len(), 1);
        let none = idx.query(
            BBox { min_lat: 50.0, min_lon: 3.0, max_lat: 51.0, max_lon: 4.0 },
            &Filters::default(),
        );
        assert_eq!(none.len(), 0);
    }

    /// Enricher stand-in for a schedule that says "this vehicle is at station (lat, lon)".
    /// A different instance per apply models the vehicle reaching the next station.
    struct StationAt(f64, f64);
    impl Enricher for StationAt {
        fn enrich(&self, _trip: &mut LiveTrip) {}
        fn scheduled_position(&self, _trip: &LiveTrip) -> Option<(f64, f64)> {
            Some((self.0, self.1))
        }
    }

    /// A RET-metro-shaped event: station lifecycle, punctuality, but never a coordinate
    /// (measured live: 0 of 155 RET metro records carried a usable rd-x).
    fn metro_ev(kind: MessageKind) -> PosEvent {
        let mut e = ev(kind, "457295", 0.0, 0.0);
        e.rd_x = None;
        e.rd_y = None;
        e
    }

    #[test]
    fn fixless_station_event_anchors_to_schedule() {
        let s = LiveState::new(240);
        s.apply(metro_ev(MessageKind::Arrival), &StationAt(51.93, 4.59));
        let t = s.get("RET:1001").unwrap();
        assert!(t.has_position());
        assert!(t.schedule_positioned);
        assert_eq!((t.lat, t.lon), (51.93, 4.59));
        // And therefore it is actually on the map: the index only holds positioned trips.
        assert_eq!(s.build_index().len(), 1);
    }

    #[test]
    fn anchor_hops_stations_and_derives_bearing() {
        let s = LiveState::new(240);
        s.apply(metro_ev(MessageKind::Arrival), &StationAt(51.93, 4.59));
        assert!(s.get("RET:1001").unwrap().bearing.is_nan(), "one station, no direction yet");
        // Next station is due east; the second anchor must point the marker that way.
        s.apply(metro_ev(MessageKind::Arrival), &StationAt(51.93, 4.61));
        let t = s.get("RET:1001").unwrap();
        assert_eq!((t.lat, t.lon), (51.93, 4.61));
        assert!((t.bearing - 90.0).abs() < 5.0, "expected ~east, got {}", t.bearing);
    }

    #[test]
    fn onroute_without_fix_does_not_anchor() {
        let s = LiveState::new(240);
        // ONROUTE only says "between stops": it must neither create a position...
        s.apply(metro_ev(MessageKind::OnRoute), &StationAt(51.93, 4.59));
        assert!(!s.get("RET:1001").unwrap().has_position());
        // ...nor move an existing anchor off its last confirmed station.
        s.apply(metro_ev(MessageKind::Arrival), &StationAt(51.93, 4.59));
        s.apply(metro_ev(MessageKind::OnRoute), &StationAt(51.94, 4.61));
        assert_eq!(s.get("RET:1001").unwrap().lat, 51.93);
    }

    /// A vehicle with GPS must never be snapped to a station: a real fix clears the flag
    /// permanently, so later fix-less station messages (GPS dropout) keep the last true
    /// position rather than teleporting the dot to a scheduled stop.
    #[test]
    fn real_fix_wins_over_schedule_anchor_for_good() {
        let s = LiveState::new(240);
        s.apply(metro_ev(MessageKind::Arrival), &StationAt(51.93, 4.59));
        assert!(s.get("RET:1001").unwrap().schedule_positioned);

        // A real fix arrives (vehicle surfaced / GPS recovered).
        s.apply(ev(MessageKind::OnRoute, "457295", 120_700.0, 487_200.0), &StationAt(51.93, 4.59));
        let t = s.get("RET:1001").unwrap();
        assert!(!t.schedule_positioned);
        let gps = (t.lat, t.lon);
        assert_ne!(gps, (51.93, 4.59));

        // Fix-less station message afterwards: position holds, no snap back to a station.
        s.apply(metro_ev(MessageKind::Arrival), &StationAt(51.95, 4.70));
        let t = s.get("RET:1001").unwrap();
        assert!(!t.schedule_positioned);
        assert_eq!((t.lat, t.lon), gps);
    }

    #[test]
    fn no_scheduled_match_stays_unpositioned_rather_than_guessing() {
        let s = LiveState::new(240);
        s.apply(metro_ev(MessageKind::Arrival), &NoEnricher);
        let t = s.get("RET:1001").unwrap();
        assert!(!t.has_position());
        assert!(!t.schedule_positioned);
        assert_eq!(s.build_index().len(), 0);
    }

    #[test]
    fn filter_by_type_and_search() {
        let mut t = LiveTrip::new(
            VehicleKey { dataowner: "HTM".into(), vehicle_number: "42".into() },
            Utc::now(),
        );
        t.vehicle_type = VehicleType::Tram;
        t.line_public_number = Some("1".into());
        let f = Filters { vehicle_types: vec![VehicleType::Bus], ..Default::default() };
        assert!(!f.matches(&t));
        let f = Filters { search: "42".into(), ..Default::default() };
        assert!(f.matches(&t));
    }
}

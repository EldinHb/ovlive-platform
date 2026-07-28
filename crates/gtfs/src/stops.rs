//! Stop-oriented indexes over a loaded [`GtfsStore`]: viewport lookup, name search, and
//! departure boards.
//!
//! These exist for the deprecated `/v1/stops/*` endpoints (see `ovlive_api::legacy`) and are
//! deliberately kept **outside** `GtfsStore` so they add nothing to the snapshot format and
//! can be deleted in one piece once those endpoints go.
//!
//! The departure board is the expensive part, and the reason it is day-scoped: the feed spans
//! several weeks (~30M `stop_times` rows), so a full `stop_id -> stop_times` reverse index
//! would cost hundreds of MB on top of an already ~2 GB store. A board only ever answers
//! "what leaves this stop around now", so we index just the *current* service date plus the
//! previous one (for after-midnight service, whose GTFS times run past 24:00). That is a few
//! percent of the feed.
//!
//! An index owns the `Arc<GtfsStore>` it was built from, so a reader can never observe an
//! index and a feed that disagree across a hot swap.

use std::collections::HashMap;
use std::sync::Arc;

use chrono::NaiveDate;

use crate::model::{GtfsStore, RouteInfo, StopInfo, TripInfo};

/// Grid cell size in degrees. ~5.5 km on a side at Dutch latitudes, which puts a
/// country-wide viewport at only a few thousand cell lookups.
const CELL_LAT: f64 = 0.05;
const CELL_LON: f64 = 0.08;

/// Seconds in a day. GTFS times past this represent after-midnight service on the
/// *previous* service date.
const DAY_SECS: i32 = 86_400;

fn cell(lat: f64, lon: f64) -> (i32, i32) {
    ((lat / CELL_LAT).floor() as i32, (lon / CELL_LON).floor() as i32)
}

/// A trip that runs on one of the indexed service dates.
struct DayTrip {
    trip_id: String,
    /// OVapi `realtime_trip_id`, when the feed provides one — lets a board join a scheduled
    /// departure to the live vehicle running it.
    rt_id: Option<String>,
}

/// One scheduled call at a stop. Times are seconds relative to *today's* local midnight, so
/// yesterday's after-midnight trips sit on the same axis as today's (shifted by -86400).
struct Call {
    trip: u32,
    arrival: i32,
    departure: i32,
    stop_sequence: u32,
    /// False for calls carried over from the previous service date. The old API's stop-times
    /// query filtered strictly on one `calendar_dates.date`, so it must exclude these.
    today: bool,
}

/// A scheduled departure, resolved against the feed. Realtime enrichment is layered on by
/// the API, which owns the live state.
pub struct Departure<'a> {
    pub stop: &'a StopInfo,
    pub trip: &'a TripInfo,
    pub route: Option<&'a RouteInfo>,
    /// `realtime_trip_id` for joining to a live vehicle, if the feed has one.
    pub realtime_trip_id: Option<&'a str>,
    /// Seconds relative to today's local midnight (may be negative for yesterday's service).
    pub scheduled_arrival: i32,
    pub scheduled_departure: i32,
    pub stop_sequence: u32,
}

pub struct StopIndexes {
    store: Arc<GtfsStore>,
    /// The service date the departure board is anchored to (local Europe/Amsterdam).
    date: NaiveDate,
    /// Grid cell -> slots into `stop_slots`.
    grid: HashMap<(i32, i32), Vec<u32>>,
    /// Stop ids in slot order, paired with a pre-lowercased name so search does no
    /// per-request allocation.
    stop_slots: Vec<(String, String)>,
    day_trips: Vec<DayTrip>,
    /// `stop_id` -> calls, ascending by `departure`.
    calls: HashMap<String, Vec<Call>>,
}

impl StopIndexes {
    /// Build every index for `date` (and, for the board only, the day before).
    pub fn build(store: Arc<GtfsStore>, date: NaiveDate) -> Self {
        // Only boardable quays are indexed for lookup/search: the old API's SQL excluded
        // `stoparea:%` rows and `location_type = 1` stations from both queries.
        let mut grid: HashMap<(i32, i32), Vec<u32>> = HashMap::new();
        let mut stop_slots: Vec<(String, String)> = Vec::with_capacity(store.stops.len());
        for stop in store.stops.values() {
            if !stop.is_quay() {
                continue;
            }
            let slot = stop_slots.len() as u32;
            stop_slots.push((stop.stop_id.clone(), stop.name.to_lowercase()));
            if stop.lat.is_finite() && stop.lon.is_finite() {
                grid.entry(cell(stop.lat, stop.lon)).or_default().push(slot);
            }
        }

        let (day_trips, calls) = build_board(&store, date);

        Self {
            store,
            date,
            grid,
            stop_slots,
            day_trips,
            calls,
        }
    }

    pub fn store(&self) -> &Arc<GtfsStore> {
        &self.store
    }

    pub fn date(&self) -> NaiveDate {
        self.date
    }

    /// Number of indexed scheduled calls — logged on build so the memory cost stays visible.
    pub fn call_count(&self) -> usize {
        self.calls.values().map(|v| v.len()).sum()
    }

    /// Stops inside `bbox`, nearest the box centre first so that hitting `limit` keeps the
    /// middle of the viewport rather than an arbitrary corner.
    pub fn in_bbox(&self, min_lat: f64, min_lon: f64, max_lat: f64, max_lon: f64, limit: usize) -> Vec<&StopInfo> {
        let (lo_y, lo_x) = cell(min_lat, min_lon);
        let (hi_y, hi_x) = cell(max_lat, max_lon);
        let (c_lat, c_lon) = ((min_lat + max_lat) / 2.0, (min_lon + max_lon) / 2.0);
        let coslat = c_lat.to_radians().cos();

        let mut hits: Vec<(f64, &StopInfo)> = Vec::new();
        for y in lo_y..=hi_y {
            for x in lo_x..=hi_x {
                let Some(slots) = self.grid.get(&(y, x)) else {
                    continue;
                };
                for &slot in slots {
                    let Some(stop) = self.store.stops.get(&self.stop_slots[slot as usize].0) else {
                        continue;
                    };
                    // Cells overlap the bbox edges, so re-test exactly.
                    if stop.lat < min_lat || stop.lat > max_lat || stop.lon < min_lon || stop.lon > max_lon {
                        continue;
                    }
                    let dlat = stop.lat - c_lat;
                    let dlon = (stop.lon - c_lon) * coslat;
                    hits.push((dlat * dlat + dlon * dlon, stop));
                }
            }
        }
        hits.sort_by(|a, b| a.0.total_cmp(&b.0));
        hits.truncate(limit);
        hits.into_iter().map(|(_, s)| s).collect()
    }

    /// Case-insensitive substring search on stop name, reproducing the old API's SQL:
    /// take the first `name_limit` **distinct names** (prefix matches first, then
    /// alphabetically), then return every quay carrying one of those names, ordered by
    /// (prefix match, name, stop_id). Callers group the result by name.
    pub fn search(&self, query: &str, name_limit: usize) -> Vec<&StopInfo> {
        let q = query.trim().to_lowercase();
        if q.is_empty() {
            return Vec::new();
        }

        // Distinct matching names, ranked, capped.
        let mut names: Vec<(bool, &str)> = Vec::new();
        {
            let mut seen: std::collections::HashSet<&str> = std::collections::HashSet::new();
            for (stop_id, lower) in &self.stop_slots {
                if !lower.contains(&q) {
                    continue;
                }
                let Some(stop) = self.store.stops.get(stop_id) else {
                    continue;
                };
                if seen.insert(stop.name.as_str()) {
                    names.push((!lower.starts_with(&q), stop.name.as_str()));
                }
            }
            names.sort_by(|a, b| (a.0, a.1).cmp(&(b.0, b.1)));
            names.truncate(name_limit);
        }
        let keep: std::collections::HashSet<&str> = names.iter().map(|(_, n)| *n).collect();

        let mut hits: Vec<(bool, &str, &str, &StopInfo)> = Vec::new();
        for (stop_id, lower) in &self.stop_slots {
            let Some(stop) = self.store.stops.get(stop_id) else {
                continue;
            };
            if !keep.contains(stop.name.as_str()) {
                continue;
            }
            hits.push((!lower.starts_with(&q), stop.name.as_str(), stop_id.as_str(), stop));
        }
        hits.sort_by(|a, b| (a.0, a.1, a.2).cmp(&(b.0, b.1, b.2)));
        hits.into_iter().map(|(_, _, _, s)| s).collect()
    }

    /// Every scheduled call at `stop_id` on the indexed service date, ascending by arrival.
    ///
    /// This is the old stop-times query: one service date, no time window and no limit (a busy
    /// stop returns its whole day). Calls carried over from the previous date are excluded, so
    /// it matches the old `calendar_dates.date = $serviceDate` filter exactly.
    pub fn calls_on_service_date(&self, stop_id: &str) -> Vec<Departure<'_>> {
        let Some(stop) = self.store.stops.get(stop_id) else {
            return Vec::new();
        };
        let Some(calls) = self.calls.get(stop_id) else {
            return Vec::new();
        };
        let mut out: Vec<Departure<'_>> = calls
            .iter()
            .filter(|c| c.today)
            .filter_map(|c| self.departure(c, stop))
            .collect();
        out.sort_by_key(|d| d.scheduled_arrival);
        out
    }

    fn departure<'a>(&'a self, c: &Call, stop: &'a StopInfo) -> Option<Departure<'a>> {
        let day = &self.day_trips[c.trip as usize];
        let trip = self.store.trips.get(&day.trip_id)?;
        Some(Departure {
            stop,
            trip,
            route: self.store.routes.get(&trip.route_id),
            realtime_trip_id: day.rt_id.as_deref(),
            scheduled_arrival: c.arrival,
            scheduled_departure: c.departure,
            stop_sequence: c.stop_sequence,
        })
    }

    /// Scheduled departures at `stop_id` from `from_secs` (seconds since today's local
    /// midnight) through `from_secs + window_secs`.
    pub fn departures(
        &self,
        stop_id: &str,
        from_secs: i32,
        window_secs: i32,
        limit: usize,
    ) -> Vec<Departure<'_>> {
        let Some(stop) = self.store.stops.get(stop_id) else {
            return Vec::new();
        };
        let Some(calls) = self.calls.get(stop_id) else {
            return Vec::new();
        };
        let until = from_secs.saturating_add(window_secs);
        let start = calls.partition_point(|c| c.departure < from_secs);

        calls[start..]
            .iter()
            .take_while(|c| c.departure <= until)
            .take(limit)
            .filter_map(|c| self.departure(c, stop))
            .collect()
    }
}

/// Collect the trips running on `date` and `date - 1` and index their calls per stop.
fn build_board(store: &GtfsStore, date: NaiveDate) -> (Vec<DayTrip>, HashMap<String, Vec<Call>>) {
    // `trip_by_key` maps realtime id -> trip id; we need the inverse for the day's trips.
    // Built once per rebuild (twice a day) and dropped immediately.
    let mut rt_by_trip: HashMap<&str, &str> = HashMap::with_capacity(store.trip_by_key.len());
    for (rt_id, trip_id) in &store.trip_by_key {
        rt_by_trip.insert(trip_id.as_str(), rt_id.as_str());
    }

    let today = ymd_u32(date);
    let yesterday = date.pred_opt().map(ymd_u32);

    let mut day_trips: Vec<DayTrip> = Vec::new();
    let mut calls: HashMap<String, Vec<Call>> = HashMap::new();

    for trip in store.trips.values() {
        // Yesterday's trips join today's axis shifted back a day, which is how a GTFS
        // "25:10:00" departure becomes 01:10 today.
        let shift = if store.runs_on(&trip.service_id, today) {
            0
        } else if yesterday.is_some_and(|y| store.runs_on(&trip.service_id, y)) {
            -DAY_SECS
        } else {
            continue;
        };
        let Some(times) = store.stop_times.get(&trip.trip_id) else {
            continue;
        };

        let slot = day_trips.len() as u32;
        day_trips.push(DayTrip {
            trip_id: trip.trip_id.clone(),
            rt_id: rt_by_trip.get(trip.trip_id.as_str()).map(|s| s.to_string()),
        });
        for st in times {
            // A shifted trip whose whole run is already in the past adds nothing.
            if shift != 0 && st.departure + shift < -DAY_SECS / 4 {
                continue;
            }
            calls.entry(st.stop_id.clone()).or_default().push(Call {
                trip: slot,
                arrival: st.arrival + shift,
                departure: st.departure + shift,
                stop_sequence: st.stop_sequence,
                today: shift == 0,
            });
        }
    }

    for v in calls.values_mut() {
        v.sort_unstable_by_key(|c| c.departure);
        v.shrink_to_fit();
    }
    (day_trips, calls)
}

fn ymd_u32(d: NaiveDate) -> u32 {
    use chrono::Datelike;
    d.year() as u32 * 10_000 + d.month() * 100 + d.day()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{StopTime, TripInfo};

    fn stop(id: &str, name: &str, lat: f64, lon: f64) -> StopInfo {
        StopInfo {
            stop_id: id.into(),
            name: name.into(),
            lat,
            lon,
            code: Some(format!("code-{id}")),
            platform_code: None,
            parent_station: None,
            location_type: 0,
        }
    }

    /// Two stops in Rotterdam, one in Groningen; one trip calling at both Rotterdam stops.
    fn store() -> GtfsStore {
        let mut s = GtfsStore::default();
        for st in [
            stop("R1", "Rotterdam Centraal", 51.925, 4.469),
            stop("R2", "Rotterdam Blaak", 51.918, 4.487),
            stop("G1", "Groningen", 53.211, 6.564),
        ] {
            s.stops.insert(st.stop_id.clone(), st);
        }
        s.trips.insert(
            "T1".into(),
            TripInfo {
                trip_id: "T1".into(),
                route_id: "RT1".into(),
                headsign: "Blaak".into(),
                block_id: None,
                shape_id: None,
                service_id: "S1".into(),
                long_name: String::new(),
            },
        );
        s.stop_times.insert(
            "T1".into(),
            vec![
                StopTime { stop_id: "R1".into(), stop_sequence: 1, arrival: 36_000, departure: 36_060 },
                StopTime { stop_id: "R2".into(), stop_sequence: 2, arrival: 36_300, departure: 36_360 },
            ],
        );
        s.service_dates.insert("S1".into(), vec![20_260_727]);
        s.trip_by_key.insert("RET:M1:1001".into(), "T1".into());
        s
    }

    fn idx() -> StopIndexes {
        let date = NaiveDate::from_ymd_opt(2026, 7, 27).unwrap();
        StopIndexes::build(Arc::new(store()), date)
    }

    #[test]
    fn bbox_returns_only_stops_inside() {
        let i = idx();
        let hits = i.in_bbox(51.85, 4.40, 51.99, 4.55, 50);
        let ids: Vec<&str> = hits.iter().map(|s| s.stop_id.as_str()).collect();
        assert_eq!(ids, ["R1", "R2"]); // Groningen is outside, R1 is nearer the centre
    }

    #[test]
    fn bbox_limit_keeps_nearest_to_centre() {
        let i = idx();
        let hits = i.in_bbox(51.85, 4.40, 51.99, 4.55, 1);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].stop_id, "R1");
    }

    #[test]
    fn search_ranks_prefix_matches_first_then_name_then_id() {
        let i = idx();
        let ids: Vec<&str> = i.search("rotterdam", 20).iter().map(|s| s.stop_id.as_str()).collect();
        // Both prefix-match; ordered by name ("Blaak" < "Centraal"), then stop_id.
        assert_eq!(ids, ["R2", "R1"]);
        assert!(i.search("blaak", 20).iter().any(|s| s.stop_id == "R2"));
        assert!(i.search("nowhere", 20).is_empty());
    }

    /// The name limit caps distinct *names*, and every quay carrying a kept name is returned —
    /// which is what the old grouped-by-name response needs.
    #[test]
    fn search_limit_counts_names_not_stops() {
        let mut s = store();
        // A second quay sharing "Rotterdam Blaak".
        s.stops.insert(
            "R3".into(),
            stop("R3", "Rotterdam Blaak", 51.9181, 51.9181_f64.min(4.4871)),
        );
        let i = StopIndexes::build(Arc::new(s), NaiveDate::from_ymd_opt(2026, 7, 27).unwrap());

        let one = i.search("rotterdam", 1);
        assert_eq!(
            one.iter().map(|s| s.name.as_str()).collect::<Vec<_>>(),
            ["Rotterdam Blaak", "Rotterdam Blaak"],
            "one name kept, but both of its quays returned"
        );
    }

    /// Stations and gtfs-nl `stoparea:*` rows are not boardable and were excluded by the old
    /// SQL; they must not appear in viewport or search results.
    #[test]
    fn stations_and_stopareas_are_excluded() {
        let mut s = store();
        let mut station = stop("stoparea:1", "Rotterdam Centraal", 51.925, 4.469);
        station.location_type = 1;
        s.stops.insert(station.stop_id.clone(), station);
        let mut typed = stop("S9", "Rotterdam Station", 51.925, 4.470);
        typed.location_type = 1;
        s.stops.insert("S9".into(), typed);
        let i = StopIndexes::build(Arc::new(s), NaiveDate::from_ymd_opt(2026, 7, 27).unwrap());

        let found: Vec<&str> = i.search("rotterdam", 20).iter().map(|s| s.stop_id.as_str()).collect();
        assert!(!found.contains(&"stoparea:1"));
        assert!(!found.contains(&"S9"));
        let in_view: Vec<&str> = i
            .in_bbox(51.85, 4.40, 51.99, 4.55, 50)
            .iter()
            .map(|s| s.stop_id.as_str())
            .collect();
        assert!(!in_view.contains(&"stoparea:1") && !in_view.contains(&"S9"));
    }

    /// The old stop-times query took one service date with no window and no limit, so
    /// yesterday's carried-over calls must not leak in.
    #[test]
    fn service_date_calls_exclude_carryover_and_ignore_windows() {
        let i = idx();
        let calls = i.calls_on_service_date("R1");
        assert_eq!(calls.len(), 1);
        assert_eq!(calls[0].scheduled_arrival, 36_000);

        let mut s = store();
        // Runs yesterday only, departing after midnight → shifted onto today's axis.
        s.service_dates.insert("S1".into(), vec![20_260_726]);
        s.stop_times.insert(
            "T1".into(),
            vec![StopTime { stop_id: "R1".into(), stop_sequence: 1, arrival: 90_000, departure: 90_060 }],
        );
        let i = StopIndexes::build(Arc::new(s), NaiveDate::from_ymd_opt(2026, 7, 27).unwrap());
        assert!(
            i.calls_on_service_date("R1").is_empty(),
            "carried-over calls belong to the previous service date"
        );
        // ...but the windowed board still sees them.
        assert_eq!(i.departures("R1", 3_000, 1_200, 10).len(), 1);
    }

    #[test]
    fn departures_window_filters_and_joins_realtime_id() {
        let i = idx();
        // 10:00 local; the R1 departure is 10:01.
        let deps = i.departures("R1", 36_000, 600, 10);
        assert_eq!(deps.len(), 1);
        assert_eq!(deps[0].trip.trip_id, "T1");
        assert_eq!(deps[0].realtime_trip_id, Some("RET:M1:1001"));
        assert_eq!(deps[0].scheduled_departure, 36_060);

        // A window that ends before the departure yields nothing.
        assert!(i.departures("R1", 30_000, 60, 10).is_empty());
        // Unknown stop is empty, not an error.
        assert!(i.departures("NOPE", 0, 86_400, 10).is_empty());
    }

    #[test]
    fn trips_not_running_on_the_date_are_excluded() {
        let mut s = store();
        s.service_dates.insert("S1".into(), vec![20_260_101]); // some other day
        let i = StopIndexes::build(Arc::new(s), NaiveDate::from_ymd_opt(2026, 7, 27).unwrap());
        assert_eq!(i.call_count(), 0);
        assert!(i.departures("R1", 0, 86_400, 10).is_empty());
    }

    #[test]
    fn after_midnight_service_shifts_onto_todays_axis() {
        let mut s = store();
        // Trip runs *yesterday*, departing R1 at 25:01 (= 01:01 today).
        s.service_dates.insert("S1".into(), vec![20_260_726]);
        s.stop_times.insert(
            "T1".into(),
            vec![StopTime { stop_id: "R1".into(), stop_sequence: 1, arrival: 90_000, departure: 90_060 }],
        );
        let i = StopIndexes::build(Arc::new(s), NaiveDate::from_ymd_opt(2026, 7, 27).unwrap());
        let deps = i.departures("R1", 3_000, 1_200, 10); // 00:50 → 01:10 today
        assert_eq!(deps.len(), 1);
        assert_eq!(deps[0].scheduled_departure, 90_060 - DAY_SECS);
    }
}

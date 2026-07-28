//! Train punctuality, from NS InfoPlus RitInfo.
//!
//! The NS position feed (`NStreinpositiesInterface5`) publishes no punctuality whatsoever —
//! only position, speed and heading (measured: that's the complete field list). Without this
//! module every train would report `delay_seconds = 0`, i.e. claim to be on time, which is
//! worse than admitting we don't know.
//!
//! `InfoPlusRITInterface5` carries it: one message per train per journey revision, listing
//! every station with a *planned* and an *actual* time. Delay grows along a route, so a single
//! scalar captured when the message arrived would be wrong minutes later — a train +2 at its
//! next stop may be forecast +7 four stops on. We therefore keep the whole **delay curve** and
//! evaluate it against `now` on every position update, which costs a walk over ~14 entries.
//!
//! Measured cold-start coverage (5 min sample, 230 trains reporting positions): RitInfo
//! mentioned 34% of them, median 89 s to first mention. That is a *cold-start* figure, not
//! steady state — RitInfo is published on change, so a train's curve arrives when its journey
//! is created (often hours ahead) and again whenever its delay is revised. The store is
//! therefore snapshotted, so a restart doesn't re-enter that cold window. The alternative
//! source, `InfoPlusDVSInterface4`, covered 72% in the same window but at 6× the message rate
//! for the same bytes; RitInfo was chosen because CPU is the binding constraint here and it
//! carries the whole journey (plus `TreinDatum` and the `TreinSoort` code) in one message.

use std::collections::HashMap;

use chrono::{DateTime, Utc};
use dashmap::DashMap;
use serde::{Deserialize, Serialize};

/// One revision of a train's journey, as decoded from a RitInfo message.
#[derive(Debug, Clone, PartialEq)]
pub struct TrainUpdate {
    /// `RitInfo/TreinNummer` — the same identifier the position feed uses.
    pub number: String,
    /// `TreinDatum`: the operating day, which the position feed doesn't publish.
    pub operating_day: Option<String>,
    /// `TreinSoort/@Code` — `IC`, `SPR`, `ICD`, … the line code gtfs-nl also uses.
    pub line_code: Option<String>,
    /// Delay curve in schedule order; see [`TrainDelay::points`].
    pub points: Vec<DelayPoint>,
}

/// The delay NS forecasts at one point of the journey.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct DelayPoint {
    /// The *actual* (expected) instant the train passes this station.
    pub at: DateTime<Utc>,
    /// Actual minus planned, in seconds (+ late, − early).
    pub delay_seconds: i32,
}

/// A train's stored delay curve.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TrainDelay {
    /// Ascending by `at`. Empty means "RitInfo said nothing usable", which is not the same as
    /// on time, so [`TrainDelay::at`] yields `None`.
    pub points: Vec<DelayPoint>,
    pub operating_day: Option<String>,
    pub line_code: Option<String>,
    /// When we received the revision — drives pruning.
    pub updated_at: DateTime<Utc>,
}

impl TrainDelay {
    /// The delay to report at `now`: the forecast for the next station the train has yet to
    /// pass, falling back to the last point once it's past them all (a train that has arrived
    /// stays as late as it arrived).
    pub fn at(&self, now: DateTime<Utc>) -> Option<i32> {
        self.points
            .iter()
            .find(|p| p.at >= now)
            .or_else(|| self.points.last())
            .map(|p| p.delay_seconds)
    }
}

/// Delay curves for every train we've heard about, keyed by train number.
///
/// Sized by the number of *known* journeys, not the message rate: a revision replaces the
/// previous curve for that train wholesale.
#[derive(Default)]
pub struct TrainDelays {
    by_number: DashMap<String, TrainDelay>,
}

/// Serializable form for the snapshot (`DashMap` isn't directly (de)serialized here).
#[derive(Debug, Default, Serialize, Deserialize)]
pub struct TrainDelaySnapshot {
    pub entries: HashMap<String, TrainDelay>,
}

impl TrainDelays {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn len(&self) -> usize {
        self.by_number.len()
    }

    pub fn is_empty(&self) -> bool {
        self.by_number.is_empty()
    }

    /// Store a revision, replacing any previous curve for that train.
    pub fn apply(&self, u: TrainUpdate, now: DateTime<Utc>) {
        let mut points = u.points;
        points.sort_by_key(|p| p.at);
        self.by_number.insert(
            u.number,
            TrainDelay {
                points,
                operating_day: u.operating_day,
                line_code: u.line_code,
                updated_at: now,
            },
        );
    }

    pub fn get(&self, number: &str) -> Option<TrainDelay> {
        self.by_number.get(number).map(|d| d.clone())
    }

    /// Drop curves not revised since `cutoff`. Returns how many went.
    pub fn prune(&self, cutoff: DateTime<Utc>) -> usize {
        let before = self.by_number.len();
        self.by_number.retain(|_, d| d.updated_at >= cutoff);
        before - self.by_number.len()
    }

    pub fn snapshot(&self) -> TrainDelaySnapshot {
        TrainDelaySnapshot {
            entries: self.by_number.iter().map(|e| (e.key().clone(), e.clone())).collect(),
        }
    }

    pub fn restore(&self, snap: TrainDelaySnapshot) {
        for (k, v) in snap.entries {
            self.by_number.insert(k, v);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Duration;

    fn t(mins: i64) -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-07-28T12:00:00Z").unwrap().with_timezone(&Utc)
            + Duration::minutes(mins)
    }

    fn curve() -> TrainUpdate {
        TrainUpdate {
            number: "3548".into(),
            operating_day: Some("2026-07-28".into()),
            line_code: Some("IC".into()),
            points: vec![
                DelayPoint { at: t(5), delay_seconds: 120 },
                DelayPoint { at: t(20), delay_seconds: 300 },
                DelayPoint { at: t(40), delay_seconds: 240 },
            ],
        }
    }

    #[test]
    fn reports_the_forecast_for_the_next_station() {
        let s = TrainDelays::new();
        s.apply(curve(), t(0));
        let d = s.get("3548").unwrap();
        // Before the first station: its forecast.
        assert_eq!(d.at(t(0)), Some(120));
        // Between stations: the one still ahead, not the one just passed — delay grows along
        // a route and the forward-looking figure is the useful one.
        assert_eq!(d.at(t(10)), Some(300));
        assert_eq!(d.at(t(25)), Some(240));
        // Past the end: it arrived as late as it arrived.
        assert_eq!(d.at(t(99)), Some(240));
    }

    #[test]
    fn empty_curve_is_unknown_not_on_time() {
        let s = TrainDelays::new();
        s.apply(TrainUpdate { points: vec![], ..curve() }, t(0));
        assert_eq!(s.get("3548").unwrap().at(t(0)), None);
        assert!(s.get("9999").is_none());
    }

    #[test]
    fn a_revision_replaces_the_previous_curve() {
        let s = TrainDelays::new();
        s.apply(curve(), t(0));
        s.apply(
            TrainUpdate {
                points: vec![DelayPoint { at: t(5), delay_seconds: 0 }],
                ..curve()
            },
            t(1),
        );
        assert_eq!(s.len(), 1);
        assert_eq!(s.get("3548").unwrap().at(t(0)), Some(0), "recovered, not still +2");
    }

    #[test]
    fn points_are_sorted_so_out_of_order_input_still_reads_correctly() {
        let s = TrainDelays::new();
        let mut u = curve();
        u.points.reverse();
        s.apply(u, t(0));
        assert_eq!(s.get("3548").unwrap().at(t(10)), Some(300));
    }

    #[test]
    fn prune_drops_only_stale_curves() {
        let s = TrainDelays::new();
        s.apply(curve(), t(0));
        s.apply(TrainUpdate { number: "1".into(), ..curve() }, t(30));
        assert_eq!(s.prune(t(10)), 1);
        assert_eq!(s.len(), 1);
        assert!(s.get("1").is_some());
    }

    #[test]
    fn snapshot_round_trips() {
        let s = TrainDelays::new();
        s.apply(curve(), t(0));
        let restored = TrainDelays::new();
        restored.restore(s.snapshot());
        assert_eq!(restored.get("3548").unwrap().at(t(10)), Some(300));
    }
}

//! Next-line prediction from KV78Turbo block/omloop data.
//!
//! GTFS `block_id` and KV6 `blockcode` are empty in the NL feeds, so the vehicle→next-trip
//! chain can't come from the static schedule. KV78Turbo (`KV8passtimes`) *does* carry a
//! populated `BlockCode` and `LinePublicNumber` on future passages, which lets us chain a
//! vehicle's journeys: journeys sharing a `(dataowner, block)` are run by the same vehicle
//! in sequence, so the next journey (by start time) tells us the next public line.
//!
//! The store is fed by the KV78Turbo ingestion task and read at serialization time, joined
//! to a live KV6 vehicle by its `(dataowner, line_planning_number, journey_number)`.
//!
//! Memory is self-bounding: KV78Turbo only publishes a rolling near-future horizon, so
//! `journeys` holds roughly the currently-active + soon-to-start trips, and [`BlockStore::prune`]
//! drops anything not seen recently.

use std::collections::HashSet;

use chrono::{DateTime, Utc};
use dashmap::DashMap;
use serde::{Deserialize, Serialize};

/// A normalized per-journey fact decoded from one KV78Turbo message. One vehicle journey
/// spans many stop passages; the decoder collapses them to a single update carrying the
/// earliest departure seen in that message (the store keeps the min across messages).
#[derive(Debug, Clone)]
pub struct JourneyUpdate {
    pub dataowner: String,
    pub line_planning_number: String,
    pub journey_number: String,
    /// Block / omloop id — the chaining key. May be empty for operators that omit it.
    pub block_code: String,
    pub line_public_number: String,
    pub destination: String,
    /// Earliest stop departure seen for this journey in this message, if any.
    pub start: Option<DateTime<Utc>>,
}

/// The predicted next trip for a vehicle.
#[derive(Debug, Clone, PartialEq)]
pub struct NextTrip {
    pub line_public_number: String,
    pub destination: String,
    pub start: DateTime<Utc>,
}

/// Journey numbers are numeric strings in the NL feeds; parse them for ordering, sorting any
/// non-numeric value last so it can never masquerade as the immediate successor.
fn journey_ord(s: &str) -> u64 {
    s.parse().unwrap_or(u64::MAX)
}

/// Serializable snapshot of the block index (see [`BlockStore::snapshot`]).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BlockSnapshot {
    entries: Vec<SnapEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SnapEntry {
    owner: String,
    line: String,
    journey: String,
    block: String,
    public: String,
    dest: String,
    start: Option<DateTime<Utc>>,
    last_seen: DateTime<Utc>,
}

#[derive(Debug, Clone)]
struct JourneyRec {
    block_code: String,
    line_public_number: String,
    destination: String,
    start: Option<DateTime<Utc>>,
    last_seen: DateTime<Utc>,
}

/// `(dataowner, line_planning_number, journey_number)`.
type JourneyKey = (String, String, String);
/// `(line_planning_number, journey_number)` — a block member within one owner.
type Member = (String, String);

/// Live block index built from KV78Turbo. Sharded (`DashMap`) so the ingestion task can
/// write while API handlers read, without a global lock.
#[derive(Default)]
pub struct BlockStore {
    journeys: DashMap<JourneyKey, JourneyRec>,
    /// `(dataowner, block_code)` -> the journeys observed in that block.
    block_members: DashMap<(String, String), HashSet<Member>>,
}

impl BlockStore {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn len(&self) -> usize {
        self.journeys.len()
    }

    pub fn is_empty(&self) -> bool {
        self.journeys.is_empty()
    }

    /// Fold one journey update into the index.
    pub fn apply(&self, u: JourneyUpdate, now: DateTime<Utc>) {
        let key: JourneyKey = (u.dataowner.clone(), u.line_planning_number.clone(), u.journey_number.clone());

        let mut e = self.journeys.entry(key).or_insert_with(|| JourneyRec {
            block_code: String::new(),
            line_public_number: String::new(),
            destination: String::new(),
            start: None,
            last_seen: now,
        });
        e.last_seen = now;
        if e.block_code.is_empty() && !u.block_code.is_empty() {
            e.block_code = u.block_code.clone();
        }
        if e.line_public_number.is_empty() && !u.line_public_number.is_empty() {
            e.line_public_number = u.line_public_number;
        }
        if e.destination.is_empty() && !u.destination.is_empty() {
            e.destination = u.destination;
        }
        // Keep the earliest departure seen: the true journey start (first stop).
        if let Some(s) = u.start {
            e.start = Some(match e.start {
                Some(cur) if cur <= s => cur,
                _ => s,
            });
        }
        drop(e);

        if !u.block_code.is_empty() {
            self.block_members
                .entry((u.dataowner.clone(), u.block_code))
                .or_default()
                .insert((u.line_planning_number, u.journey_number));
        }
    }

    /// The public line number a journey serves, if known (from KV78Turbo).
    pub fn line_public(&self, dataowner: &str, line_planning_number: &str, journey_number: &str) -> Option<String> {
        self.journeys
            .get(&(dataowner.to_string(), line_planning_number.to_string(), journey_number.to_string()))
            .map(|r| r.line_public_number.clone())
            .filter(|s| !s.is_empty())
    }

    /// Predict the vehicle's next public line: the soonest journey in the same block that
    /// starts after the current one.
    ///
    /// The block is resolved from the **KV78 index** for the current journey (authoritative, and
    /// what [`block_members`](Self) is keyed by), falling back to the live vehicle's KV6
    /// `block_code` only when the current journey isn't in the index. This matters for RET, whose
    /// KV6 feed leaves `block_code` empty on many trips even though KV78 carries the block.
    /// `None` when no block can be resolved, the block is unknown to the index, or this is the
    /// last journey of the block.
    ///
    /// Ordering is by departure time; the journey number only breaks ties between block members
    /// that share a start. The reference point is the current trip's own start when it's in the
    /// index, otherwise `now` (a running trip has already started, so its not-yet-started
    /// successor is the earliest block member with `start > now`).
    pub fn predict_next(
        &self,
        dataowner: &str,
        block_code: &str,
        line_planning_number: &str,
        journey_number: &str,
        now: DateTime<Utc>,
    ) -> Option<NextTrip> {
        // Look up the current journey in the index to get its (authoritative) block and start.
        let key = (dataowner.to_string(), line_planning_number.to_string(), journey_number.to_string());
        let (idx_block, cur_start) = match self.journeys.get(&key) {
            Some(r) => ((!r.block_code.is_empty()).then(|| r.block_code.clone()), r.start),
            None => (None, None),
        };
        // Prefer the index block; fall back to the live KV6 block only if the journey is absent.
        let block = idx_block.unwrap_or_else(|| block_code.to_string());
        if block.is_empty() {
            return None; // no block from either source → can't chain
        }
        let members = self.block_members.get(&(dataowner.to_string(), block))?;
        let reference = cur_start.unwrap_or(now);
        let cur_jn = journey_ord(journey_number);

        let mut best: Option<((i128, i128), JourneyRec, DateTime<Utc>)> = None;
        for (line, journey) in members.iter() {
            if journey == journey_number {
                continue; // skip the current trip
            }
            let Some(rec) = self
                .journeys
                .get(&(dataowner.to_string(), line.clone(), journey.clone()))
            else {
                continue;
            };
            // A candidate must have a start so we can report its departure time.
            let Some(start) = rec.start else { continue };
            let cand_jn = journey_ord(journey);

            // Must start after the reference; an exact tie is broken by the higher journey
            // number (only meaningful when we actually have the current trip's start).
            let after = start > reference
                || (cur_start.is_some() && start == reference && cand_jn > cur_jn);
            if !after {
                continue; // earlier/parallel journey — not "next"
            }
            let key = (start.timestamp_millis() as i128, cand_jn as i128);
            if best.as_ref().is_none_or(|(bk, _, _)| key < *bk) {
                best = Some((key, rec.clone(), start));
            }
        }
        best.map(|(_, rec, start)| NextTrip {
            line_public_number: rec.line_public_number,
            destination: rec.destination,
            start,
        })
    }

    /// Serializable view of the whole index, for snapshotting to the `/data` volume so
    /// predictions survive a restart (rather than waiting for the KV78Turbo feed to refill).
    pub fn snapshot(&self) -> BlockSnapshot {
        let entries = self
            .journeys
            .iter()
            .map(|e| {
                let (k, v) = (e.key(), e.value());
                SnapEntry {
                    owner: k.0.clone(),
                    line: k.1.clone(),
                    journey: k.2.clone(),
                    block: v.block_code.clone(),
                    public: v.line_public_number.clone(),
                    dest: v.destination.clone(),
                    start: v.start,
                    last_seen: v.last_seen,
                }
            })
            .collect();
        BlockSnapshot { entries }
    }

    /// Rebuild the index (journeys + block membership) from a snapshot.
    pub fn restore(&self, snap: BlockSnapshot) {
        for e in snap.entries {
            self.journeys.insert(
                (e.owner.clone(), e.line.clone(), e.journey.clone()),
                JourneyRec {
                    block_code: e.block.clone(),
                    line_public_number: e.public,
                    destination: e.dest,
                    start: e.start,
                    last_seen: e.last_seen,
                },
            );
            if !e.block.is_empty() {
                self.block_members
                    .entry((e.owner, e.block))
                    .or_default()
                    .insert((e.line, e.journey));
            }
        }
    }

    /// Drop journeys not seen since `cutoff`, and clean their block membership. Bounds memory
    /// as trips roll off the KV78Turbo horizon.
    pub fn prune(&self, cutoff: DateTime<Utc>) -> usize {
        let stale: Vec<(JourneyKey, String)> = self
            .journeys
            .iter()
            .filter(|e| e.last_seen < cutoff)
            .map(|e| (e.key().clone(), e.value().block_code.clone()))
            .collect();
        for (key, block) in &stale {
            self.journeys.remove(key);
            if !block.is_empty() {
                let bk = (key.0.clone(), block.clone());
                if let Some(mut set) = self.block_members.get_mut(&bk) {
                    set.remove(&(key.1.clone(), key.2.clone()));
                }
                self.block_members.remove_if(&bk, |_, set| set.is_empty());
            }
        }
        stale.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn t(h: u32, m: u32) -> DateTime<Utc> {
        Utc.with_ymd_and_hms(2026, 7, 9, h, m, 0).unwrap()
    }

    fn upd(line: &str, journey: &str, block: &str, public: &str, dest: &str, start: DateTime<Utc>) -> JourneyUpdate {
        JourneyUpdate {
            dataowner: "RET".into(),
            line_planning_number: line.into(),
            journey_number: journey.into(),
            block_code: block.into(),
            line_public_number: public.into(),
            destination: dest.into(),
            start: Some(start),
        }
    }

    #[test]
    fn predicts_next_line_in_block() {
        let s = BlockStore::new();
        let now = t(12, 0);
        // Same block 77: journey A (line 76) at 13:00, then journey B (line 47) at 13:40.
        s.apply(upd("L76", "1001", "77", "76", "Centraal", t(13, 0)), now);
        s.apply(upd("L47", "1002", "77", "47", "Zuidplein", t(13, 40)), now);

        let next = s.predict_next("RET", "77", "L76", "1001", now).expect("should predict");
        assert_eq!(next.line_public_number, "47");
        assert_eq!(next.destination, "Zuidplein");
        assert_eq!(next.start, t(13, 40));
    }

    #[test]
    fn last_journey_of_block_has_no_next() {
        let s = BlockStore::new();
        let now = t(12, 0);
        s.apply(upd("L76", "1001", "77", "76", "Centraal", t(13, 0)), now);
        s.apply(upd("L47", "1002", "77", "47", "Zuidplein", t(13, 40)), now);
        assert!(s.predict_next("RET", "77", "L47", "1002", now).is_none());
    }

    #[test]
    fn different_blocks_do_not_chain() {
        let s = BlockStore::new();
        let now = t(12, 0);
        s.apply(upd("L76", "1001", "77", "76", "A", t(13, 0)), now);
        s.apply(upd("L47", "1002", "88", "47", "B", t(13, 40)), now);
        assert!(s.predict_next("RET", "77", "L76", "1001", now).is_none());
    }

    #[test]
    fn no_block_anywhere_returns_none() {
        let s = BlockStore::new();
        let now = t(12, 0);
        s.apply(upd("L76", "1001", "", "76", "A", t(13, 0)), now);
        // No block in the index and none on the vehicle → don't predict.
        assert!(s.predict_next("RET", "", "L76", "1001", now).is_none());
    }

    #[test]
    fn resolves_block_from_index_when_vehicle_block_missing() {
        // The RET case: KV78 knows the block (77), but the live vehicle's KV6 block_code is
        // empty. We must resolve the block from the index, not the (empty) live value.
        let s = BlockStore::new();
        let now = t(12, 0);
        s.apply(upd("L8", "1001", "77", "8", "Spangen", t(13, 0)), now);
        s.apply(upd("L8", "1002", "77", "8", "Schiebroek", t(13, 40)), now);
        let next = s.predict_next("RET", "", "L8", "1001", now).expect("resolves block from index");
        assert_eq!(next.line_public_number, "8");
        assert_eq!(next.destination, "Schiebroek");
    }

    #[test]
    fn falls_back_to_live_block_when_current_trip_absent_from_index() {
        // The current trip (1001) never made it into the index — only its successor (1002) did —
        // so we fall back to the vehicle's live KV6 block (77) to find the block's other journeys.
        let s = BlockStore::new();
        let now = t(12, 0);
        s.apply(upd("L47", "1002", "77", "47", "Zuidplein", t(13, 40)), now);
        let next = s.predict_next("RET", "77", "L76", "1001", now).expect("predicts via live block fallback");
        assert_eq!(next.line_public_number, "47");
        assert_eq!(next.start, t(13, 40));
    }

    #[test]
    fn snapshot_round_trips_and_still_predicts() {
        let s = BlockStore::new();
        let now = t(12, 0);
        s.apply(upd("L76", "1001", "77", "76", "Centraal", t(13, 0)), now);
        s.apply(upd("L47", "1002", "77", "47", "Zuidplein", t(13, 40)), now);

        // snapshot()/restore() is the persistence path (ovlive-persist bincodes BlockSnapshot).
        let restored = BlockStore::new();
        restored.restore(s.snapshot());

        assert_eq!(restored.len(), 2);
        let next = restored.predict_next("RET", "77", "L76", "1001", t(12, 0)).expect("prediction survives restore");
        assert_eq!(next.line_public_number, "47");
        assert_eq!(next.start, t(13, 40));
    }

    #[test]
    fn ties_on_start_broken_by_journey_number() {
        let s = BlockStore::new();
        let now = t(12, 0);
        s.apply(upd("L76", "1001", "77", "76", "A", t(13, 0)), now);
        // Two block members share the 13:40 start; the lower (i.e. next) journey number wins,
        // deterministically — regardless of the order they were applied.
        s.apply(upd("L47", "1003", "77", "47", "Later", t(13, 40)), now);
        s.apply(upd("L47", "1002", "77", "47", "NextUp", t(13, 40)), now);

        let next = s.predict_next("RET", "77", "L76", "1001", now).expect("predict with tie");
        assert_eq!(next.destination, "NextUp"); // journey 1002 < 1003
        assert_eq!(next.start, t(13, 40));
    }

    #[test]
    fn falls_back_to_now_when_current_start_missing() {
        let s = BlockStore::new();
        let now = t(12, 0);
        // Current trip has no known departure time (null VejoDepartureTime), so we can't use it
        // as the reference — `now` takes over: the successor is the earliest member after now.
        s.apply(JourneyUpdate { start: None, ..upd("L76", "1001", "77", "76", "A", t(0, 0)) }, now);
        s.apply(upd("L47", "1002", "77", "47", "Zuidplein", t(13, 40)), now);

        let next = s.predict_next("RET", "77", "L76", "1001", now).expect("predicts via now fallback");
        assert_eq!(next.line_public_number, "47");
        assert_eq!(next.start, t(13, 40));
    }

    #[test]
    fn prune_drops_stale_journeys() {
        let s = BlockStore::new();
        s.apply(upd("L76", "1001", "77", "76", "A", t(13, 0)), t(10, 0));
        s.apply(upd("L47", "1002", "77", "47", "B", t(13, 40)), t(12, 0));
        assert_eq!(s.len(), 2);
        // Prune anything not seen since 11:00 → drops journey 1001 only.
        let removed = s.prune(t(11, 0));
        assert_eq!(removed, 1);
        assert_eq!(s.len(), 1);
        // 1001 is gone; 1002 remains and is now the last journey of block 77 → no successor.
        assert!(s.predict_next("RET", "77", "L47", "1002", t(12, 0)).is_none());
    }
}

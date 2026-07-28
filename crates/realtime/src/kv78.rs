//! Decode KV78Turbo `KV8passtimes` into per-journey [`JourneyUpdate`]s for block chaining.
//!
//! Unlike KV6 (XML), KV78Turbo is a compact pipe-delimited "turbo" text format:
//!
//! ```text
//! \GKV8turbo_passtimes|...            (envelope header line)
//! \TDATEDPASSTIME|DATEDPASSTIME|start object
//! \LDataOwnerCode|OperationDate|LinePlanningNumber|JourneyNumber|...   (column labels)
//! RET|2026-07-09|M300|4001|...        (one row per stop passage)
//! ...
//! ```
//!
//! A `\L` line declares the columns for the rows that follow; `\0` means null. One vehicle
//! journey appears as many stop rows, so we collapse a message's rows to one update per
//! `(dataowner, line, journey)`, keeping the earliest departure (the journey's start).

use std::collections::HashMap;

use chrono::{DateTime, NaiveDateTime, TimeZone, Utc};
use ovlive_core::JourneyUpdate;

/// Columns we care about, resolved to indices when a `\L` header line is seen.
#[derive(Default, Clone, Copy)]
struct Cols {
    owner: Option<usize>,
    line: Option<usize>,
    journey: Option<usize>,
    block: Option<usize>,
    public: Option<usize>,
    dest: Option<usize>,
    vejo_dep: Option<usize>,
}

impl Cols {
    fn from_labels(labels: &str) -> Self {
        let mut c = Cols::default();
        for (i, name) in labels.split('|').enumerate() {
            match name.trim().to_ascii_lowercase().as_str() {
                "dataownercode" => c.owner = Some(i),
                "lineplanningnumber" => c.line = Some(i),
                "journeynumber" => c.journey = Some(i),
                "blockcode" => c.block = Some(i),
                "linepublicnumber" => c.public = Some(i),
                "destinationname" => c.dest = Some(i),
                "vejodeparturetime" => c.vejo_dep = Some(i),
                _ => {}
            }
        }
        c
    }
}

fn field<'a>(vals: &[&'a str], idx: Option<usize>) -> &'a str {
    match idx.and_then(|i| vals.get(i)).copied() {
        Some("\\0") | None => "",
        Some(v) => v,
    }
}

/// Parse a KV78Turbo departure timestamp. It comes as a naive local (Europe/Amsterdam)
/// datetime without offset (e.g. `2026-07-09T13:46:30`); we also accept a full RFC3339.
fn parse_departure(s: &str) -> Option<DateTime<Utc>> {
    if s.is_empty() {
        return None;
    }
    if let Ok(dt) = DateTime::parse_from_rfc3339(s) {
        return Some(dt.with_timezone(&Utc));
    }
    let naive = NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S").ok()?;
    chrono_tz::Europe::Amsterdam
        .from_local_datetime(&naive)
        .single()
        .map(|local| local.with_timezone(&Utc))
}

/// Decode one KV78Turbo message into per-journey updates (aggregated across its stop rows).
///
/// The per-stop columns (`ExpectedArrivalTime`, `TripStopStatus`, …) are deliberately
/// **discarded**: they can only be attached to a schedule via `UserStopCode`, which does not
/// join to gtfs-nl. Measured live over 817 stop-reporting vehicles: `UserStopCode` matches a
/// GTFS `stop_id` for **0%** and a `stop_code` for **30%**, and that 30% is almost entirely
/// Connexxion (CXX 100%, EBS 4.5%, ARR 3.5%, KEOLIS 10%, QBUZZ 0.9%, and RET/GVB/HTM 0%).
/// Retaining them would therefore cost per-row work on a ~940 record/s feed to enrich a
/// minority of stops and none of the big city operators.
pub fn parse_kv78(text: &str) -> Vec<JourneyUpdate> {
    let mut cols = Cols::default();
    let mut have_cols = false;
    let mut acc: HashMap<(String, String, String), JourneyUpdate> = HashMap::new();

    for line in text.lines() {
        if let Some(rest) = line.strip_prefix("\\L") {
            cols = Cols::from_labels(rest);
            have_cols = cols.owner.is_some() && cols.line.is_some() && cols.journey.is_some();
        } else if line.starts_with('\\') || line.is_empty() || !have_cols {
            continue; // \G \T \C control lines, or rows before any column header
        } else {
            let vals: Vec<&str> = line.split('|').collect();
            let owner = field(&vals, cols.owner);
            let line_planning = field(&vals, cols.line);
            let journey = field(&vals, cols.journey);
            if owner.is_empty() || line_planning.is_empty() || journey.is_empty() {
                continue;
            }
            let start = parse_departure(field(&vals, cols.vejo_dep));
            let entry = acc
                .entry((owner.to_string(), line_planning.to_string(), journey.to_string()))
                .or_insert_with(|| JourneyUpdate {
                    dataowner: owner.to_string(),
                    line_planning_number: line_planning.to_string(),
                    journey_number: journey.to_string(),
                    block_code: String::new(),
                    line_public_number: String::new(),
                    destination: String::new(),
                    start: None,
                });
            if entry.block_code.is_empty() {
                entry.block_code = field(&vals, cols.block).to_string();
            }
            if entry.line_public_number.is_empty() {
                entry.line_public_number = field(&vals, cols.public).to_string();
            }
            if entry.destination.is_empty() {
                entry.destination = field(&vals, cols.dest).to_string();
            }
            if let Some(s) = start {
                entry.start = Some(match entry.start {
                    Some(cur) if cur <= s => cur,
                    _ => s,
                });
            }
        }
    }

    acc.into_values().collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    // Trimmed real-shape message: one header, two journeys sharing block 41 (chaining),
    // each with two stops so the earliest departure must win.
    const SAMPLE: &str = "\\GKV8turbo_passtimes|KV8turbo_passtimes|OpenOV|||UTF-8|0.1|2026-07-09T13:51:27+02:00|\n\
\\TDATEDPASSTIME|DATEDPASSTIME|start object\n\
\\LDataOwnerCode|OperationDate|LinePlanningNumber|JourneyNumber|UserStopCode|TripStopStatus|JourneyStopType|TargetDepartureTime|VehicleNumber|BlockCode|LinePublicNumber|DestinationName|VejoDepartureTime\n\
RET|2026-07-09|M300|4001|HAL1|DRIVING|FIRST|14:00:00|2337|41|76|Centraal|2026-07-09T14:00:00\n\
RET|2026-07-09|M300|4001|HAL2|PLANNED|INTERMEDIATE|14:05:00|2337|41|76|Centraal|2026-07-09T14:05:00\n\
RET|2026-07-09|M301|4050|HAL9|PLANNED|FIRST|14:30:00|2337|41|47|Zuidplein|2026-07-09T14:30:00\n\
\\TDATEDPASSTIME|DATEDPASSTIME|end object\n";

    #[test]
    fn aggregates_journeys_and_earliest_start() {
        let mut ups = parse_kv78(SAMPLE);
        ups.sort_by(|a, b| a.journey_number.cmp(&b.journey_number));
        assert_eq!(ups.len(), 2);

        let j = &ups[0]; // 4001
        assert_eq!(j.journey_number, "4001");
        assert_eq!(j.block_code, "41");
        assert_eq!(j.line_public_number, "76");
        assert_eq!(j.destination, "Centraal");
        // Earliest of the two stops (14:00 local = 12:00Z in CEST).
        assert_eq!(j.start, parse_departure("2026-07-09T14:00:00"));

        assert_eq!(ups[1].line_public_number, "47");
    }

    #[test]
    fn null_marker_and_missing_cols_are_empty() {
        let msg = "\\LDataOwnerCode|LinePlanningNumber|JourneyNumber|BlockCode|LinePublicNumber\n\
RET|M300|4001|\\0|76\n";
        let ups = parse_kv78(msg);
        assert_eq!(ups.len(), 1);
        assert_eq!(ups[0].block_code, ""); // \0 -> empty
        assert_eq!(ups[0].line_public_number, "76");
        assert_eq!(ups[0].start, None); // no VejoDepartureTime column
    }

    /// A message's many stop rows must still collapse to one update per journey — the
    /// per-stop detail is intentionally dropped (see `parse_kv78`), so a 30-stop journey
    /// costs the same as a 1-stop one.
    #[test]
    fn many_stop_rows_collapse_to_one_update_per_journey() {
        let mut msg = String::from(
            "\\LDataOwnerCode|OperationDate|LinePlanningNumber|JourneyNumber|UserStopOrderNumber|UserStopCode|ExpectedArrivalTime|TripStopStatus|VejoDepartureTime\n",
        );
        for order in 1..=30 {
            msg.push_str(&format!(
                "EBS|2026-07-10|3070|1066|{order}|544116{order:02}|14:{:02}:00|PLANNED|2026-07-10T14:{:02}:00\n",
                order, order
            ));
        }
        let ups = parse_kv78(&msg);
        assert_eq!(ups.len(), 1, "30 stop rows -> 1 journey update");
        // Earliest departure across the rows wins (14:01 local = 12:01Z in CEST).
        assert_eq!(
            ups[0].start,
            Some("2026-07-10T12:01:00Z".parse::<DateTime<Utc>>().unwrap())
        );
    }
}

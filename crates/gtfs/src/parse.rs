//! Parse a `gtfs-nl.zip` into a [`GtfsStore`].
//!
//! Reads each needed file by streaming the CSV directly from its zip entry (no
//! `read_to_string` of the ~hundreds-of-MB `stop_times.txt`). Only the columns we use
//! are read; missing optional files are tolerated.

use std::collections::{HashMap, HashSet};
use std::io::{Cursor, Read, Seek};
use std::path::Path;

use anyhow::{Context, Result};
use chrono::{Datelike, Duration, NaiveDate};
use ovlive_core::VehicleType;
use zip::ZipArchive;

use crate::model::{GtfsStore, RouteInfo, StopInfo, StopTime, TripInfo};

/// Parse HH:MM:SS (possibly >24h) into seconds since local midnight.
fn parse_gtfs_time(s: &str) -> Option<i32> {
    let mut it = s.split(':');
    let h: i32 = it.next()?.trim().parse().ok()?;
    let m: i32 = it.next()?.trim().parse().ok()?;
    let sec: i32 = it.next().unwrap_or("0").trim().parse().ok()?;
    Some(h * 3600 + m * 60 + sec)
}

fn reader<R: Read>(r: R) -> csv::Reader<R> {
    csv::ReaderBuilder::new()
        .has_headers(true)
        .flexible(true)
        .from_reader(r)
}

/// Column-name → index map for a header record (GTFS column order is not fixed).
fn header_index(r: &csv::StringRecord) -> HashMap<String, usize> {
    r.iter()
        .enumerate()
        .map(|(i, h)| (h.trim().trim_start_matches('\u{feff}').to_string(), i))
        .collect()
}

fn index_of<R: Read + Seek>(zip: &mut ZipArchive<R>, name: &str) -> Option<usize> {
    (0..zip.len()).find(|&i| {
        zip.by_index(i)
            .map(|f| f.name().trim_end_matches('/').ends_with(name))
            .unwrap_or(false)
    })
}

/// Run `f` over a streaming CSV reader for `name`, if the file exists in the archive.
fn with_csv<R, F>(zip: &mut ZipArchive<R>, name: &str, mut f: F) -> Result<()>
where
    R: Read + Seek,
    F: FnMut(&HashMap<String, usize>, &csv::StringRecord),
{
    let Some(i) = index_of(zip, name) else {
        return Ok(());
    };
    let entry = zip.by_index(i).with_context(|| format!("open {name}"))?;
    let mut rdr = reader(entry);
    let hi = header_index(rdr.headers().with_context(|| format!("headers {name}"))?);
    let mut rec = csv::StringRecord::new();
    while rdr.read_record(&mut rec).unwrap_or(false) {
        f(&hi, &rec);
    }
    Ok(())
}

/// Parse from any seekable reader.
pub fn parse_reader<R: Read + Seek>(r: R) -> Result<GtfsStore> {
    let mut zip = ZipArchive::new(r).context("open gtfs zip")?;
    let mut store = GtfsStore::default();
    let get = |hi: &HashMap<String, usize>, rec: &csv::StringRecord, k: &str| -> String {
        hi.get(k).and_then(|&i| rec.get(i)).unwrap_or("").to_string()
    };

    with_csv(&mut zip, "feed_info.txt", |hi, rec| {
        if store.feed_version.is_empty() {
            store.feed_version = get(hi, rec, "feed_version");
        }
    })?;

    with_csv(&mut zip, "agency.txt", |hi, rec| {
        let id = get(hi, rec, "agency_id");
        if !id.is_empty() {
            store.agencies.insert(id, get(hi, rec, "agency_name"));
        }
    })?;

    with_csv(&mut zip, "routes.txt", |hi, rec| {
        let route_id = get(hi, rec, "route_id");
        if route_id.is_empty() {
            return;
        }
        let rt: i32 = get(hi, rec, "route_type").parse().unwrap_or(-1);
        let agency = get(hi, rec, "agency_id");
        let color = get(hi, rec, "route_color");
        let text_color = get(hi, rec, "route_text_color");
        store.routes.insert(
            route_id.clone(),
            RouteInfo {
                route_id,
                agency_id: (!agency.is_empty()).then_some(agency),
                short_name: get(hi, rec, "route_short_name"),
                long_name: get(hi, rec, "route_long_name"),
                vehicle_type: VehicleType::from_gtfs_route_type(rt),
                color: (!color.is_empty()).then_some(color),
                text_color: (!text_color.is_empty()).then_some(text_color),
            },
        );
    })?;

    with_csv(&mut zip, "trips.txt", |hi, rec| {
        let trip_id = get(hi, rec, "trip_id");
        if trip_id.is_empty() {
            return;
        }
        let block = get(hi, rec, "block_id");
        let shape = get(hi, rec, "shape_id");
        store.trips.insert(
            trip_id.clone(),
            TripInfo {
                trip_id: trip_id.clone(),
                route_id: get(hi, rec, "route_id"),
                headsign: get(hi, rec, "trip_headsign"),
                block_id: (!block.is_empty()).then_some(block),
                shape_id: (!shape.is_empty()).then_some(shape),
                service_id: get(hi, rec, "service_id"),
                long_name: get(hi, rec, "trip_long_name"),
            },
        );
        // OVapi realtime join: realtime_trip_id = "<dataowner>:<line>:<journey>".
        let rt = get(hi, rec, "realtime_trip_id");
        if !rt.is_empty() {
            store.trip_by_key.insert(rt, trip_id);
        }
    })?;

    with_csv(&mut zip, "stops.txt", |hi, rec| {
        let id = get(hi, rec, "stop_id");
        if id.is_empty() {
            return;
        }
        let code = get(hi, rec, "stop_code");
        let platform = get(hi, rec, "platform_code");
        let parent = get(hi, rec, "parent_station");
        store.stops.insert(
            id.clone(),
            StopInfo {
                stop_id: id,
                name: get(hi, rec, "stop_name"),
                lat: get(hi, rec, "stop_lat").parse().unwrap_or(f64::NAN),
                lon: get(hi, rec, "stop_lon").parse().unwrap_or(f64::NAN),
                code: (!code.is_empty()).then_some(code),
                platform_code: (!platform.is_empty()).then_some(platform),
                parent_station: (!parent.is_empty()).then_some(parent),
                location_type: get(hi, rec, "location_type").parse().unwrap_or(0),
            },
        );
    })?;

    parse_services(&mut zip, &mut store)?;

    with_csv(&mut zip, "stop_times.txt", |hi, rec| {
        let trip_id = get(hi, rec, "trip_id");
        if trip_id.is_empty() {
            return;
        }
        let st = StopTime {
            stop_id: get(hi, rec, "stop_id"),
            stop_sequence: get(hi, rec, "stop_sequence").parse().unwrap_or(0),
            arrival: parse_gtfs_time(&get(hi, rec, "arrival_time")).unwrap_or(0),
            departure: parse_gtfs_time(&get(hi, rec, "departure_time")).unwrap_or(0),
        };
        store.stop_times.entry(trip_id).or_default().push(st);
    })?;
    for times in store.stop_times.values_mut() {
        times.sort_by_key(|s| s.stop_sequence);
    }

    let mut shape_tmp: HashMap<String, Vec<(i64, [f64; 2])>> = HashMap::new();
    with_csv(&mut zip, "shapes.txt", |hi, rec| {
        let sid = get(hi, rec, "shape_id");
        if sid.is_empty() {
            return;
        }
        let seq: i64 = get(hi, rec, "shape_pt_sequence").parse().unwrap_or(0);
        let lat: f64 = get(hi, rec, "shape_pt_lat").parse().unwrap_or(f64::NAN);
        let lon: f64 = get(hi, rec, "shape_pt_lon").parse().unwrap_or(f64::NAN);
        shape_tmp.entry(sid).or_default().push((seq, [lat, lon]));
    })?;
    for (sid, mut pts) in shape_tmp {
        pts.sort_by_key(|(seq, _)| *seq);
        store.shapes.insert(sid, pts.into_iter().map(|(_, p)| p).collect());
    }

    Ok(store)
}

/// Build `service_id -> sorted YYYYMMDD dates` from the feed's calendar files.
///
/// gtfs-nl ships **only** `calendar_dates.txt` (every operating day is enumerated
/// explicitly, ~3.5 MB), but `calendar.txt` is expanded first when present so the parser
/// also handles conventional feeds. `exception_type` 1 adds a date, 2 removes one.
fn parse_services<R: Read + Seek>(zip: &mut ZipArchive<R>, store: &mut GtfsStore) -> Result<()> {
    let get = |hi: &HashMap<String, usize>, rec: &csv::StringRecord, k: &str| -> String {
        hi.get(k).and_then(|&i| rec.get(i)).unwrap_or("").to_string()
    };
    let mut added: HashMap<String, HashSet<u32>> = HashMap::new();
    let mut removed: HashMap<String, HashSet<u32>> = HashMap::new();

    with_csv(zip, "calendar.txt", |hi, rec| {
        let sid = get(hi, rec, "service_id");
        if sid.is_empty() {
            return;
        }
        let (Some(start), Some(end)) = (
            parse_gtfs_date(&get(hi, rec, "start_date")),
            parse_gtfs_date(&get(hi, rec, "end_date")),
        ) else {
            return;
        };
        const DAYS: [&str; 7] = [
            "monday",
            "tuesday",
            "wednesday",
            "thursday",
            "friday",
            "saturday",
            "sunday",
        ];
        let mask: Vec<bool> = DAYS.iter().map(|d| get(hi, rec, d) == "1").collect();
        let set = added.entry(sid).or_default();
        let mut day = start;
        // A malformed range must not turn into an unbounded loop; two years is far beyond
        // any real feed horizon (gtfs-nl publishes weeks).
        for _ in 0..(366 * 2) {
            if day > end {
                break;
            }
            if mask[day.weekday().num_days_from_monday() as usize] {
                set.insert(ymd_u32(day));
            }
            day += Duration::days(1);
        }
    })?;

    with_csv(zip, "calendar_dates.txt", |hi, rec| {
        let sid = get(hi, rec, "service_id");
        let Some(date) = parse_gtfs_date(&get(hi, rec, "date")) else {
            return;
        };
        if sid.is_empty() {
            return;
        }
        match get(hi, rec, "exception_type").as_str() {
            "2" => {
                removed.entry(sid).or_default().insert(ymd_u32(date));
            }
            // Default to "added": exception_type 1, and be lenient about a missing column.
            _ => {
                added.entry(sid).or_default().insert(ymd_u32(date));
            }
        }
    })?;

    store.service_dates = added
        .into_iter()
        .map(|(sid, dates)| {
            let excluded = removed.get(&sid);
            let mut v: Vec<u32> = match excluded {
                Some(ex) => dates.into_iter().filter(|d| !ex.contains(d)).collect(),
                None => dates.into_iter().collect(),
            };
            // Sorted so `GtfsStore::runs_on` can binary-search.
            v.sort_unstable();
            (sid, v)
        })
        .filter(|(_, dates)| !dates.is_empty())
        .collect();

    Ok(())
}

/// `YYYYMMDD` -> date.
fn parse_gtfs_date(s: &str) -> Option<NaiveDate> {
    NaiveDate::parse_from_str(s.trim(), "%Y%m%d").ok()
}

/// Date -> `YYYYMMDD` as an integer (compact, orderable, and cheap to compare).
fn ymd_u32(d: NaiveDate) -> u32 {
    d.year() as u32 * 10_000 + d.month() * 100 + d.day()
}

/// Parse from an in-memory byte slice (used by tests).
pub fn parse_zip(bytes: &[u8]) -> Result<GtfsStore> {
    parse_reader(Cursor::new(bytes))
}

/// Parse from a cached `gtfs-nl.zip` on disk.
pub fn parse_zip_file(path: &Path) -> Result<GtfsStore> {
    let f = std::fs::File::open(path).with_context(|| format!("open {}", path.display()))?;
    parse_reader(f)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_gtfs_time() {
        assert_eq!(parse_gtfs_time("01:02:03"), Some(3723));
        assert_eq!(parse_gtfs_time("25:00:00"), Some(90000)); // after-midnight service
        assert_eq!(parse_gtfs_time("bad"), None);
    }

    #[test]
    fn parses_gtfs_date() {
        assert_eq!(
            parse_gtfs_date("20260727"),
            NaiveDate::from_ymd_opt(2026, 7, 27)
        );
        assert_eq!(ymd_u32(NaiveDate::from_ymd_opt(2026, 7, 27).unwrap()), 20_260_727);
        assert_eq!(parse_gtfs_date("2026-07-27"), None);
    }

    /// Build a zip in memory containing the given `(name, contents)` files.
    fn zip_of(files: &[(&str, &str)]) -> Vec<u8> {
        use std::io::Write;
        let mut buf = Cursor::new(Vec::new());
        {
            let mut w = zip::ZipWriter::new(&mut buf);
            let opts: zip::write::FileOptions<'_, ()> = zip::write::FileOptions::default();
            for (name, body) in files {
                w.start_file(*name, opts).unwrap();
                w.write_all(body.as_bytes()).unwrap();
            }
            w.finish().unwrap();
        }
        buf.into_inner()
    }

    /// gtfs-nl ships no `calendar.txt`: every operating day is an explicit
    /// `calendar_dates.txt` row.
    #[test]
    fn calendar_dates_only_feed_resolves_service_days() {
        let bytes = zip_of(&[(
            "calendar_dates.txt",
            "service_id,date,exception_type\n\
             S1,20260727,1\n\
             S1,20260728,1\n\
             S1,20260729,2\n\
             S2,20260727,1\n",
        )]);
        let store = parse_zip(&bytes).unwrap();

        assert_eq!(store.service_dates.get("S1").unwrap(), &[20_260_727, 20_260_728]);
        assert!(store.runs_on("S1", 20_260_727));
        assert!(!store.runs_on("S1", 20_260_729), "exception_type 2 removes the day");
        assert!(!store.runs_on("S2", 20_260_728));
        assert!(!store.runs_on("unknown", 20_260_727));
    }

    /// A conventional feed with a weekday mask, plus a `calendar_dates.txt` override.
    #[test]
    fn calendar_weekday_mask_expands_and_exceptions_apply() {
        // 2026-07-27 is a Monday; 2026-07-28 a Tuesday.
        let bytes = zip_of(&[
            (
                "calendar.txt",
                "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n\
                 W1,1,0,0,0,0,0,0,20260727,20260810\n",
            ),
            (
                "calendar_dates.txt",
                "service_id,date,exception_type\n\
                 W1,20260728,1\n\
                 W1,20260803,2\n",
            ),
        ]);
        let store = parse_zip(&bytes).unwrap();

        assert!(store.runs_on("W1", 20_260_727), "Monday in range");
        assert!(store.runs_on("W1", 20_260_728), "added by exception");
        assert!(!store.runs_on("W1", 20_260_729), "Wednesday not in the mask");
        assert!(!store.runs_on("W1", 20_260_803), "Monday removed by exception");
        assert!(store.runs_on("W1", 20_260_810), "end_date is inclusive");
        assert!(!store.runs_on("W1", 20_260_817), "past end_date");
    }

    #[test]
    fn parses_stop_code_and_platform_and_trip_service() {
        let bytes = zip_of(&[
            (
                "stops.txt",
                "stop_id,stop_code,stop_name,stop_lat,stop_lon,platform_code,parent_station\n\
                 2400123,58001234,Rotterdam Blaak,51.918,4.487,3,stoparea:123\n\
                 2400124,,Nowhere,51.0,4.0,,\n",
            ),
            (
                "trips.txt",
                "trip_id,route_id,service_id,trip_headsign,trip_long_name,realtime_trip_id\n\
                 T1,R1,S1,Blaak,Metro D naar Blaak,RET:M1:1001\n",
            ),
        ]);
        let store = parse_zip(&bytes).unwrap();

        let s = store.stop("2400123").unwrap();
        assert_eq!(s.code.as_deref(), Some("58001234"));
        assert_eq!(s.platform_code.as_deref(), Some("3"));
        assert_eq!(s.parent_station.as_deref(), Some("stoparea:123"));
        // Blank optional columns stay None rather than becoming empty strings.
        let bare = store.stop("2400124").unwrap();
        assert_eq!(bare.code, None);
        assert_eq!(bare.platform_code, None);

        let t = store.trip("T1").unwrap();
        assert_eq!(t.service_id, "S1");
        assert_eq!(t.long_name, "Metro D naar Blaak");
        assert_eq!(store.trip_by_key.get("RET:M1:1001").map(String::as_str), Some("T1"));
    }
}

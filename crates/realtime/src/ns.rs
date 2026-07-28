//! Decode NS InfoPlus `NStreinpositiesInterface5` XML into normalized [`PosEvent`]s.
//!
//! NS publishes train GPS on its own datastream (port 7664), not on BISON KV6 — trains are
//! absent from KV6 entirely. The wire format is a *full snapshot* of every reporting train,
//! republished every ~11 s (measured), so there is no INIT/END lifecycle: a train simply
//! stops appearing when its run is over, and `LiveState`'s staleness sweep removes it.
//!
//! ```xml
//! <tns3:ArrayOfTreinLocation>
//!   <tns3:TreinLocation>
//!     <tns3:TreinNummer>8743</tns3:TreinNummer>
//!     <tns:TreinMaterieelDelen>
//!       <tns:MaterieelDeelNummer>2012</tns:MaterieelDeelNummer>
//!       <tns:Materieelvolgnummer>1</tns:Materieelvolgnummer>
//!       <tns:GpsDatumTijd>2026-07-28T08:25:43Z</tns:GpsDatumTijd>
//!       <tns:Bron>GNSS1</tns:Bron>
//!       <tns:Longitude>4.664842</tns:Longitude>
//!       <tns:Latitude>52.116924</tns:Latitude>
//!       <tns:Snelheid>79.0</tns:Snelheid>
//!       <tns:Richting>151.51</tns:Richting>
//!       <tns:Hdop>1.48</tns:Hdop>
//!     </tns:TreinMaterieelDelen>
//!   </tns3:TreinLocation>
//! </tns3:ArrayOfTreinLocation>
//! ```
//!
//! Two measured quirks drive the logic below (sample: 375 material parts, 294 trains):
//!
//! 1. **A train reports one fix per material part** — 216 trains had 1 part, 75 had 2, 3 had
//!    3. Coupled units move together, so emitting all of them would just stack near-identical
//!    dots. We emit one event per *train*, using the part with the lowest
//!    `Materieelvolgnummer` (consist order). Deliberately not "the freshest fix": parts
//!    report a second or two apart, so picking by timestamp would flip between units every
//!    cycle and slide the dot along the length of the train.
//! 2. **Stale and even future-dated fixes are republished.** Only 347/375 fixes were current;
//!    the rest ranged from minutes to *two weeks* old, and two were dated 23:59 the same day
//!    (a unit with no clock). Old fixes would appear and then immediately be pruned as stale
//!    — a visible ENTER/LEAVE flicker — and future-dated ones would never expire at all,
//!    leaving a permanent ghost. So both ends are rejected here, at parse time.

use chrono::{DateTime, Duration, Utc};
use ovlive_core::{MessageKind, PosEvent, VehicleKey, VehicleType};
use quick_xml::events::{BytesEnd, BytesStart, Event};
use quick_xml::reader::Reader;

/// Vehicle-key namespace for trains. Not an operator code like the KV6 dataowners: it's the
/// prefix gtfs-nl uses for every rail `realtime_trip_id` (`IFF:SPR:8743`), so keying trains
/// this way makes [`ovlive_core::LiveTrip::realtime_trip_id`] reproduce the GTFS value
/// exactly — which is what lets stop departure boards resolve a train to its live vehicle.
pub const TRAIN_DATAOWNER: &str = "IFF";

/// How far ahead of `now` a fix may be dated before we treat its clock as broken. Small:
/// this only absorbs ordinary skew between the unit, NS and us.
const MAX_CLOCK_SKEW: i64 = 60;

fn start_local(e: &BytesStart) -> String {
    String::from_utf8_lossy(e.local_name().into_inner()).into_owned()
}
fn end_local(e: &BytesEnd) -> String {
    String::from_utf8_lossy(e.local_name().into_inner()).into_owned()
}

/// One `TreinMaterieelDelen` row: the GPS report of a single material part.
#[derive(Default)]
struct Part {
    order: Option<i32>,
    lat: Option<f64>,
    lon: Option<f64>,
    speed: Option<f64>,
    course: Option<f32>,
    timestamp: Option<DateTime<Utc>>,
}

impl Part {
    fn set(&mut self, field: &str, val: &str) {
        let v = val.trim();
        if v.is_empty() {
            return;
        }
        match field {
            "Materieelvolgnummer" => self.order = v.parse().ok(),
            "Latitude" => self.lat = v.parse().ok(),
            "Longitude" => self.lon = v.parse().ok(),
            "Snelheid" => self.speed = v.parse().ok(),
            "Richting" => self.course = v.parse().ok(),
            // Fractional seconds appear on a minority of rows (27/375), which RFC3339 covers.
            "GpsDatumTijd" => {
                self.timestamp = DateTime::parse_from_rfc3339(v).ok().map(|d| d.with_timezone(&Utc))
            }
            _ => {}
        }
    }

    /// A usable fix: real coordinates inside the feed's area, timestamped within the window.
    fn usable(&self, now: DateTime<Utc>, max_age: Duration) -> bool {
        let (Some(lat), Some(lon), Some(ts)) = (self.lat, self.lon, self.timestamp) else {
            return false;
        };
        // A 0/0 fix is "no fix", not the Gulf of Guinea.
        if !(3.0..7.5).contains(&lon) || !(50.0..54.0).contains(&lat) {
            return false;
        }
        ts >= now - max_age && ts <= now + Duration::seconds(MAX_CLOCK_SKEW)
    }
}

/// Parse a treinposities snapshot into one event per reporting train.
///
/// `now` and `max_age` gate fix freshness (quirk 2 above); pass the receive time and
/// something comfortably below `STALE_TRIP_SECS`.
pub fn parse_ns_treinposities(xml: &str, now: DateTime<Utc>, max_age: Duration) -> Vec<PosEvent> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);

    let mut events = Vec::new();
    // Current train: its number, and the best usable part seen so far.
    let mut train: Option<String> = None;
    let mut best: Option<Part> = None;
    let mut part: Option<Part> = None;
    let mut field: Option<String> = None;

    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => match start_local(&e).as_str() {
                "TreinLocation" => {
                    train = None;
                    best = None;
                    part = None;
                    field = None;
                }
                "TreinMaterieelDelen" => {
                    part = Some(Part::default());
                    field = None;
                }
                name => field = Some(name.to_string()),
            },
            Ok(Event::Text(t)) => {
                let val = t.unescape().unwrap_or_default();
                match (part.as_mut(), field.as_deref()) {
                    (Some(p), Some(f)) => p.set(f, &val),
                    // Outside a part, the only leaf we want is the train number.
                    (None, Some("TreinNummer")) => {
                        let v = val.trim();
                        if !v.is_empty() {
                            train = Some(v.to_string());
                        }
                    }
                    _ => {}
                }
            }
            Ok(Event::End(e)) => {
                match end_local(&e).as_str() {
                    "TreinMaterieelDelen" => {
                        if let Some(p) = part.take() {
                            // Lowest Materieelvolgnummer wins; a part without one sorts last.
                            let better = match (&best, p.order) {
                                (None, _) => p.usable(now, max_age),
                                (Some(b), Some(o)) => {
                                    p.usable(now, max_age) && o < b.order.unwrap_or(i32::MAX)
                                }
                                (Some(_), None) => false,
                            };
                            if better {
                                best = Some(p);
                            }
                        }
                    }
                    "TreinLocation" => {
                        if let (Some(number), Some(p)) = (train.take(), best.take()) {
                            events.push(event_for(number, &p));
                        }
                    }
                    _ => {}
                }
                field = None;
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }
    events
}

fn event_for(number: String, p: &Part) -> PosEvent {
    PosEvent {
        key: VehicleKey {
            dataowner: TRAIN_DATAOWNER.to_string(),
            // The train number *is* the moving object's identity here. Material numbers
            // would be more faithful to "vehicle", but a train's leading unit can change
            // when the front one loses its fix, and that would churn the vehicle id.
            vehicle_number: number.clone(),
        },
        // No lifecycle in this feed: every row is "here is where this train is".
        kind: MessageKind::OnRoute,
        // The line code (`SPR`, `IC`, …) isn't in this feed — GTFS enrichment backfills it
        // from the matched trip's `realtime_trip_id`.
        line_planning_number: None,
        journey_number: Some(number),
        // Nor is the operating day; enrichment resolves it from the fix time.
        operating_day: None,
        block_code: None,
        rd_x: None,
        rd_y: None,
        lat: p.lat,
        lon: p.lon,
        // A GPS course is meaningless while stopped (it keeps the last heading or drifts),
        // so leave it unset and let the previous bearing stand — same intent as the
        // anti-jitter rule on the KV6 path.
        bearing: p.course.filter(|_| p.speed.unwrap_or(0.0) > 0.0),
        vehicle_type: Some(VehicleType::Train),
        // NS treinposities carries no punctuality at all (measured: the field doesn't exist).
        punctuality: None,
        user_stop_code: None,
        timestamp: p.timestamp.unwrap_or_else(Utc::now),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Two trains: 8743 has two coupled parts (the second one leading in list order but
    /// second in the consist), 6642 has one. Namespace prefixes match the real feed.
    fn sample(ts_8743: &str, ts_6642: &str) -> String {
        format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<tns3:ArrayOfTreinLocation xmlns:tns3="http://schemas.datacontract.org/2004/07/Cognos.Infrastructure.Models">
  <tns3:TreinLocation>
    <tns3:TreinNummer>8743</tns3:TreinNummer>
    <tns:TreinMaterieelDelen xmlns:tns="http://schemas.datacontract.org/2004/07/Cognos.Infrastructure.Models">
      <tns:MaterieelDeelNummer>2012</tns:MaterieelDeelNummer>
      <tns:Materieelvolgnummer>2</tns:Materieelvolgnummer>
      <tns:GpsDatumTijd>{ts_8743}</tns:GpsDatumTijd>
      <tns:Bron>GNSS1</tns:Bron>
      <tns:Longitude>4.700000</tns:Longitude>
      <tns:Latitude>52.200000</tns:Latitude>
      <tns:Elevation>0.0</tns:Elevation>
      <tns:Snelheid>80.0</tns:Snelheid>
      <tns:Richting>200.00</tns:Richting>
    </tns:TreinMaterieelDelen>
    <tns:TreinMaterieelDelen xmlns:tns="http://schemas.datacontract.org/2004/07/Cognos.Infrastructure.Models">
      <tns:MaterieelDeelNummer>2013</tns:MaterieelDeelNummer>
      <tns:Materieelvolgnummer>1</tns:Materieelvolgnummer>
      <tns:GpsDatumTijd>{ts_8743}</tns:GpsDatumTijd>
      <tns:Bron>GNSS1</tns:Bron>
      <tns:Longitude>4.664842</tns:Longitude>
      <tns:Latitude>52.116924</tns:Latitude>
      <tns:Snelheid>79.0</tns:Snelheid>
      <tns:Richting>151.51</tns:Richting>
    </tns:TreinMaterieelDelen>
  </tns3:TreinLocation>
  <tns3:TreinLocation>
    <tns3:TreinNummer>6642</tns3:TreinNummer>
    <tns:TreinMaterieelDelen xmlns:tns="http://schemas.datacontract.org/2004/07/Cognos.Infrastructure.Models">
      <tns:MaterieelDeelNummer>2401</tns:MaterieelDeelNummer>
      <tns:Materieelvolgnummer>1</tns:Materieelvolgnummer>
      <tns:GpsDatumTijd>{ts_6642}</tns:GpsDatumTijd>
      <tns:Longitude>5.100000</tns:Longitude>
      <tns:Latitude>52.090000</tns:Latitude>
      <tns:Snelheid>0.0</tns:Snelheid>
      <tns:Richting>93.00</tns:Richting>
    </tns:TreinMaterieelDelen>
  </tns3:TreinLocation>
</tns3:ArrayOfTreinLocation>"#
        )
    }

    fn now() -> DateTime<Utc> {
        DateTime::parse_from_rfc3339("2026-07-28T12:30:00Z").unwrap().with_timezone(&Utc)
    }

    fn window() -> Duration {
        Duration::seconds(180)
    }

    #[test]
    fn one_event_per_train_from_the_leading_part() {
        let evs = parse_ns_treinposities(
            &sample("2026-07-28T12:29:54Z", "2026-07-28T12:29:50Z"),
            now(),
            window(),
        );
        assert_eq!(evs.len(), 2, "one event per train, not per material part");

        let t = &evs[0];
        assert_eq!(t.key.dataowner, "IFF");
        assert_eq!(t.key.vehicle_number, "8743");
        assert_eq!(t.key.id(), "IFF:8743");
        assert_eq!(t.journey_number.as_deref(), Some("8743"));
        assert_eq!(t.vehicle_type, Some(VehicleType::Train));
        assert_eq!(t.kind, MessageKind::OnRoute);
        // Materieelvolgnummer 1, i.e. the second row in the document, not the first.
        assert_eq!(t.lat, Some(52.116924));
        assert_eq!(t.lon, Some(4.664842));
        assert_eq!(t.bearing, Some(151.51));
        // WGS84 comes straight through; nothing pretends to be Rijksdriehoek.
        assert_eq!((t.rd_x, t.rd_y), (None, None));
        // The feed has no punctuality, so a train must not claim to be on time by omission.
        assert_eq!(t.punctuality, None);
    }

    #[test]
    fn omits_course_while_stopped() {
        let evs = parse_ns_treinposities(
            &sample("2026-07-28T12:29:54Z", "2026-07-28T12:29:50Z"),
            now(),
            window(),
        );
        let stopped = evs.iter().find(|e| e.key.vehicle_number == "6642").unwrap();
        // Snelheid 0 → the reported Richting is stale, so no bearing is asserted.
        assert_eq!(stopped.bearing, None);
        assert_eq!(stopped.lat, Some(52.09));
    }

    #[test]
    fn rejects_stale_and_future_dated_fixes() {
        // 8743 two weeks old, 6642 dated end-of-day (the real feed publishes both).
        let evs = parse_ns_treinposities(
            &sample("2026-07-14T08:12:29Z", "2026-07-28T23:59:54Z"),
            now(),
            window(),
        );
        assert!(evs.is_empty(), "got {evs:?}");
    }

    #[test]
    fn falls_back_to_a_trailing_part_when_the_leader_is_stale() {
        // Leader (Materieelvolgnummer 1) shares the stale timestamp, so only part 2 is usable.
        let xml = sample("2026-07-14T08:12:29Z", "2026-07-28T12:29:50Z")
            .replace("<tns:GpsDatumTijd>2026-07-14T08:12:29Z</tns:GpsDatumTijd>\n      <tns:Bron>GNSS1</tns:Bron>\n      <tns:Longitude>4.700000</tns:Longitude>", "<tns:GpsDatumTijd>2026-07-28T12:29:54Z</tns:GpsDatumTijd>\n      <tns:Bron>GNSS1</tns:Bron>\n      <tns:Longitude>4.700000</tns:Longitude>");
        let evs = parse_ns_treinposities(&xml, now(), window());
        let t = evs.iter().find(|e| e.key.vehicle_number == "8743").expect("train present");
        assert_eq!(t.lon, Some(4.7), "should use the only part with a fresh fix");
    }

    #[test]
    fn skips_zero_and_out_of_area_fixes() {
        let xml = sample("2026-07-28T12:29:54Z", "2026-07-28T12:29:50Z")
            .replace("<tns:Latitude>52.116924</tns:Latitude>", "<tns:Latitude>0.0</tns:Latitude>")
            .replace("<tns:Longitude>4.664842</tns:Longitude>", "<tns:Longitude>0.0</tns:Longitude>");
        let evs = parse_ns_treinposities(&xml, now(), window());
        let t = evs.iter().find(|e| e.key.vehicle_number == "8743").expect("train present");
        // Falls back to the other part rather than dropping the train into the ocean.
        assert_eq!(t.lon, Some(4.7));
    }

    #[test]
    fn ignores_malformed_records() {
        assert!(parse_ns_treinposities("", now(), window()).is_empty());
        assert!(parse_ns_treinposities("<ArrayOfTreinLocation/>", now(), window()).is_empty());
        // A train with no usable part yields nothing rather than a positionless vehicle.
        let xml = r#"<ArrayOfTreinLocation><TreinLocation><TreinNummer>1</TreinNummer>
            <TreinMaterieelDelen><Materieelvolgnummer>1</Materieelvolgnummer></TreinMaterieelDelen>
            </TreinLocation></ArrayOfTreinLocation>"#;
        assert!(parse_ns_treinposities(xml, now(), window()).is_empty());
    }
}

//! Decode NS InfoPlus `InfoPlusRITInterface5` (RitInfo) into [`TrainUpdate`]s.
//!
//! This is where train punctuality comes from — the position feed has none. One message
//! describes one revision of one train's journey: every station it calls at, each with a
//! *planned* (`InfoStatus="Gepland"`) and an *actual* (`InfoStatus="Actueel"`) time. The delay
//! at a station is simply actual − planned, which is also what `ExacteVertrekVertraging`
//! spells out as an ISO 8601 duration; we take the difference and skip the duration parsing.
//!
//! ```xml
//! <RitInfo>
//!   <TreinNummer>3548</TreinNummer>
//!   <TreinDatum>2026-07-28</TreinDatum>
//!   <TreinSoort Code="IC">Intercity</TreinSoort>
//!   <LogischeRit><LogischeRitDeel><LogischeRitDeelStation>
//!     <Station><StationCode>VL</StationCode>…</Station>
//!     <VertrekTijd InfoStatus="Gepland">2026-07-28T11:03:00.000Z</VertrekTijd>
//!     <VertrekTijd InfoStatus="Actueel">2026-07-28T11:05:09.000Z</VertrekTijd>
//!     <ExacteVertrekVertraging>PT2M9S</ExacteVertrekVertraging>
//!   </LogischeRitDeelStation>…
//! </RitInfo>
//! ```
//!
//! Only `Actueel` instants go into the curve, because that's when the train is now expected to
//! be there — which is exactly the key [`ovlive_core::TrainDelay::at`] compares against `now`.
//! Departure times are preferred over arrival: a station's departure is the later of the two,
//! so a dwelling train still counts as "not yet past" this station.

use chrono::{DateTime, Utc};
use ovlive_core::{DelayPoint, TrainUpdate};
use quick_xml::events::{BytesEnd, BytesStart, Event};
use quick_xml::reader::Reader;

fn start_local(e: &BytesStart) -> String {
    String::from_utf8_lossy(e.local_name().into_inner()).into_owned()
}
fn end_local(e: &BytesEnd) -> String {
    String::from_utf8_lossy(e.local_name().into_inner()).into_owned()
}

/// Value of an attribute on a start tag, namespace prefix ignored.
fn attr(e: &BytesStart, name: &str) -> Option<String> {
    e.attributes().flatten().find_map(|a| {
        let key = String::from_utf8_lossy(a.key.local_name().into_inner()).into_owned();
        (key == name).then(|| String::from_utf8_lossy(&a.value).into_owned())
    })
}

fn ts(s: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(s.trim()).ok().map(|d| d.with_timezone(&Utc))
}

/// Planned/actual pair for one station, before it collapses to a [`DelayPoint`].
#[derive(Default)]
struct StationTimes {
    planned_dep: Option<DateTime<Utc>>,
    actual_dep: Option<DateTime<Utc>>,
    planned_arr: Option<DateTime<Utc>>,
    actual_arr: Option<DateTime<Utc>>,
}

impl StationTimes {
    fn point(&self) -> Option<DelayPoint> {
        // Departure first: it's the later event at a station, so a train still standing there
        // isn't treated as already past it.
        for (planned, actual) in [(self.planned_dep, self.actual_dep), (self.planned_arr, self.actual_arr)] {
            if let (Some(p), Some(a)) = (planned, actual) {
                return Some(DelayPoint { at: a, delay_seconds: (a - p).num_seconds() as i32 });
            }
        }
        None
    }
}

/// Parse one RitInfo document. `None` when it carries no train number.
pub fn parse_ns_rit(xml: &str) -> Option<TrainUpdate> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);

    let mut number: Option<String> = None;
    let mut operating_day: Option<String> = None;
    let mut line_code: Option<String> = None;
    let mut points: Vec<DelayPoint> = Vec::new();

    // Which leaf we're inside, and whether it's the planned or the actual variant.
    let mut field: Option<String> = None;
    let mut actual = false;
    let mut station: Option<StationTimes> = None;
    // `Station` blocks nest their own names; depth tells a station's own times from those of
    // the destination/`HerkenbareBestemming` sub-blocks, which carry no times but do nest.
    let mut in_station_block = false;

    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => {
                let name = start_local(&e);
                match name.as_str() {
                    "LogischeRitDeelStation" => {
                        station = Some(StationTimes::default());
                        in_station_block = true;
                    }
                    "TreinSoort" => {
                        // The code lives in the attribute; the text is the prose name.
                        line_code = attr(&e, "Code").filter(|c| !c.is_empty());
                        field = Some(name);
                        actual = false;
                    }
                    "VertrekTijd" | "AankomstTijd" => {
                        actual = attr(&e, "InfoStatus").as_deref() == Some("Actueel");
                        field = Some(name);
                    }
                    _ => {
                        field = Some(name);
                        actual = false;
                    }
                }
            }
            Ok(Event::Text(t)) => {
                let Some(f) = field.as_deref() else { continue };
                let val = t.unescape().unwrap_or_default();
                let v = val.trim();
                if v.is_empty() {
                    continue;
                }
                match f {
                    // Both appear only at the document level, so first non-empty wins.
                    "TreinNummer" if number.is_none() => number = Some(v.to_string()),
                    "TreinDatum" if operating_day.is_none() => operating_day = Some(v.to_string()),
                    "VertrekTijd" | "AankomstTijd" if in_station_block => {
                        if let (Some(st), Some(at)) = (station.as_mut(), ts(v)) {
                            let slot = match (f, actual) {
                                ("VertrekTijd", true) => &mut st.actual_dep,
                                ("VertrekTijd", false) => &mut st.planned_dep,
                                (_, true) => &mut st.actual_arr,
                                (_, false) => &mut st.planned_arr,
                            };
                            // A station can repeat a status (e.g. per journey part); keep the
                            // first, which is the one belonging to this call.
                            if slot.is_none() {
                                *slot = Some(at);
                            }
                        }
                    }
                    _ => {}
                }
            }
            Ok(Event::End(e)) => {
                if end_local(&e) == "LogischeRitDeelStation" {
                    if let Some(p) = station.take().and_then(|st| st.point()) {
                        points.push(p);
                    }
                    in_station_block = false;
                }
                field = None;
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }

    Some(TrainUpdate { number: number?, operating_day, line_code, points })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Trimmed to the elements that matter, but keeping the real nesting: a `Station` block
    /// with its own names, a destination sub-block, and both time variants.
    const SAMPLE: &str = r#"<?xml version="1.0"?>
<ns2:PutReisInformatieBoodschapIn xmlns="urn:ns:cdm:reisinformatie:data:rit:5" xmlns:ns2="urn:ns:cdm:reisinformatie:message:ritinfo:5">
 <ReisInformatieProductRitInfo Versie="9.2">
  <RitInfo>
   <TreinNummer>3548</TreinNummer>
   <TreinDatum>2026-07-28</TreinDatum>
   <TreinSoort Code="IC">Intercity</TreinSoort>
   <Vervoerder>NS</Vervoerder>
   <LogischeRit>
    <LogischeRitNummer>3548</LogischeRitNummer>
    <LogischeRitDeel>
     <LogischeRitDeelNummer>3548</LogischeRitDeelNummer>
     <LogischeRitDeelStation>
      <Station><StationCode>VL</StationCode><KorteNaam>Venlo</KorteNaam></Station>
      <TreinEindBestemming InfoStatus="Gepland">
       <StationCode>GV</StationCode><KorteNaam>Dn Haag HS</KorteNaam>
      </TreinEindBestemming>
      <Stopt InfoStatus="Actueel">J</Stopt>
      <VertrekTijd InfoStatus="Gepland">2026-07-28T11:03:00.000Z</VertrekTijd>
      <VertrekTijd InfoStatus="Actueel">2026-07-28T11:05:09.000Z</VertrekTijd>
      <ExacteVertrekVertraging>PT2M9S</ExacteVertrekVertraging>
     </LogischeRitDeelStation>
     <LogischeRitDeelStation>
      <Station><StationCode>EHV</StationCode><KorteNaam>Eindhoven</KorteNaam></Station>
      <AankomstTijd InfoStatus="Gepland">2026-07-28T11:33:00.000Z</AankomstTijd>
      <AankomstTijd InfoStatus="Actueel">2026-07-28T11:38:00.000Z</AankomstTijd>
      <VertrekTijd InfoStatus="Gepland">2026-07-28T11:35:00.000Z</VertrekTijd>
      <VertrekTijd InfoStatus="Actueel">2026-07-28T11:40:00.000Z</VertrekTijd>
     </LogischeRitDeelStation>
     <LogischeRitDeelStation>
      <Station><StationCode>GV</StationCode><KorteNaam>Dn Haag HS</KorteNaam></Station>
      <AankomstTijd InfoStatus="Gepland">2026-07-28T12:30:00.000Z</AankomstTijd>
      <AankomstTijd InfoStatus="Actueel">2026-07-28T12:33:00.000Z</AankomstTijd>
     </LogischeRitDeelStation>
    </LogischeRitDeel>
   </LogischeRit>
  </RitInfo>
 </ReisInformatieProductRitInfo>
</ns2:PutReisInformatieBoodschapIn>"#;

    fn at(s: &str) -> DateTime<Utc> {
        ts(s).unwrap()
    }

    #[test]
    fn extracts_the_delay_curve() {
        let u = parse_ns_rit(SAMPLE).expect("parsed");
        assert_eq!(u.number, "3548");
        assert_eq!(u.operating_day.as_deref(), Some("2026-07-28"));
        // From the attribute, not the "Intercity" text.
        assert_eq!(u.line_code.as_deref(), Some("IC"));

        assert_eq!(u.points.len(), 3, "one point per station: {:?}", u.points);
        // Venlo: departure only, +2m09s.
        assert_eq!(u.points[0].at, at("2026-07-28T11:05:09Z"));
        assert_eq!(u.points[0].delay_seconds, 129);
        // Eindhoven has both; the departure is used, so a dwelling train isn't "past" it.
        assert_eq!(u.points[1].at, at("2026-07-28T11:40:00Z"));
        assert_eq!(u.points[1].delay_seconds, 300);
        // Terminus: arrival only.
        assert_eq!(u.points[2].at, at("2026-07-28T12:33:00Z"));
        assert_eq!(u.points[2].delay_seconds, 180);
    }

    #[test]
    fn a_punctual_train_is_zero_not_unknown() {
        let xml = SAMPLE
            .replace("2026-07-28T11:05:09.000Z", "2026-07-28T11:03:00.000Z")
            .replace("2026-07-28T11:38:00.000Z", "2026-07-28T11:33:00.000Z")
            .replace("2026-07-28T11:40:00.000Z", "2026-07-28T11:35:00.000Z")
            .replace("2026-07-28T12:33:00.000Z", "2026-07-28T12:30:00.000Z");
        let u = parse_ns_rit(&xml).expect("parsed");
        assert_eq!(u.points.len(), 3);
        assert!(u.points.iter().all(|p| p.delay_seconds == 0));
    }

    #[test]
    fn stations_without_both_times_contribute_no_point() {
        let xml = r#"<RitInfo><TreinNummer>7</TreinNummer>
          <LogischeRitDeelStation>
            <Station><StationCode>AH</StationCode></Station>
            <VertrekTijd InfoStatus="Gepland">2026-07-28T11:03:00.000Z</VertrekTijd>
          </LogischeRitDeelStation></RitInfo>"#;
        let u = parse_ns_rit(xml).expect("parsed");
        assert_eq!(u.number, "7");
        // Planned but no actual = nothing known about punctuality here.
        assert!(u.points.is_empty());
    }

    #[test]
    fn ignores_documents_without_a_train_number() {
        assert!(parse_ns_rit("<RitInfo/>").is_none());
        assert!(parse_ns_rit("").is_none());
    }

    /// The curve is what the store evaluates against `now`; check the two agree end to end.
    #[test]
    fn curve_feeds_the_delay_lookup() {
        let u = parse_ns_rit(SAMPLE).expect("parsed");
        let store = ovlive_core::TrainDelays::new();
        store.apply(u, at("2026-07-28T11:00:00Z"));
        let d = store.get("3548").unwrap();
        assert_eq!(d.at(at("2026-07-28T11:04:00Z")), Some(129), "approaching Venlo");
        assert_eq!(d.at(at("2026-07-28T11:20:00Z")), Some(300), "Venlo done, Eindhoven next");
        assert_eq!(d.at(at("2026-07-28T13:00:00Z")), Some(180), "arrived 3 min late");
    }
}

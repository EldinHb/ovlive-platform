//! Decode BISON KV6 `posinfo` XML into normalized [`PosEvent`]s.
//!
//! A KV6 message contains a `<KV6posinfo>` wrapper holding one or more records whose
//! *element name* is the message type (`ONROUTE`, `DEPARTURE`, `ARRIVAL`, `ONSTOP`,
//! `INIT`, `DELAY`, `OFFROUTE`, `END`). Each record holds flat leaf fields. We stream
//! the document (no DOM) and build one event per record.

use chrono::{DateTime, Utc};
use ovlive_core::{MessageKind, PosEvent, VehicleKey};
use quick_xml::events::{BytesEnd, BytesStart, Event};
use quick_xml::reader::Reader;

fn kind_from(name: &str) -> Option<MessageKind> {
    Some(match name {
        "INIT" => MessageKind::Init,
        "ARRIVAL" => MessageKind::Arrival,
        "ONSTOP" => MessageKind::OnStop,
        "DEPARTURE" => MessageKind::Departure,
        "ONROUTE" => MessageKind::OnRoute,
        "DELAY" => MessageKind::Delay,
        "OFFROUTE" => MessageKind::Offroute,
        "END" => MessageKind::End,
        _ => return None,
    })
}

fn start_local(e: &BytesStart) -> String {
    String::from_utf8_lossy(e.local_name().into_inner()).into_owned()
}
fn end_local(e: &BytesEnd) -> String {
    String::from_utf8_lossy(e.local_name().into_inner()).into_owned()
}

#[derive(Default)]
struct Builder {
    kind: Option<MessageKind>,
    dataowner: Option<String>,
    vehicle_number: Option<String>,
    line: Option<String>,
    journey: Option<String>,
    operating_day: Option<String>,
    block_code: Option<String>,
    user_stop_code: Option<String>,
    punctuality: Option<i32>,
    rd_x: Option<f64>,
    rd_y: Option<f64>,
    timestamp: Option<DateTime<Utc>>,
}

impl Builder {
    fn set(&mut self, field: &str, val: &str) {
        let v = val.trim();
        if v.is_empty() {
            return;
        }
        match field {
            "dataownercode" => self.dataowner = Some(v.to_string()),
            "vehiclenumber" => self.vehicle_number = Some(v.to_string()),
            "lineplanningnumber" => self.line = Some(v.to_string()),
            "journeynumber" => self.journey = Some(v.to_string()),
            "operatingday" => self.operating_day = Some(v.to_string()),
            // Operators use either element for the same value; first non-empty wins.
            "blockcode" | "omloopnumber" => {
                if self.block_code.as_deref().unwrap_or("").is_empty() {
                    self.block_code = Some(v.to_string());
                }
            }
            "userstopcode" => self.user_stop_code = Some(v.to_string()),
            "punctuality" => self.punctuality = v.parse().ok(),
            "rd-x" => self.rd_x = v.parse().ok().filter(|x: &f64| *x > 0.0),
            "rd-y" => self.rd_y = v.parse().ok().filter(|y: &f64| *y > 0.0),
            "timestamp" => {
                self.timestamp = DateTime::parse_from_rfc3339(v)
                    .ok()
                    .map(|d| d.with_timezone(&Utc))
            }
            _ => {}
        }
    }

    fn build(self) -> Option<PosEvent> {
        let dataowner = self.dataowner?;
        let vehicle_number = self.vehicle_number?;
        Some(PosEvent {
            key: VehicleKey {
                dataowner,
                vehicle_number,
            },
            kind: self.kind?,
            line_planning_number: self.line,
            journey_number: self.journey,
            operating_day: self.operating_day,
            block_code: self.block_code,
            rd_x: self.rd_x,
            rd_y: self.rd_y,
            punctuality: self.punctuality,
            user_stop_code: self.user_stop_code,
            timestamp: self.timestamp.unwrap_or_else(Utc::now),
        })
    }
}

/// Parse a KV6 XML payload into events. Malformed records are skipped, not fatal.
pub fn parse_kv6(xml: &str) -> Vec<PosEvent> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);

    let mut events = Vec::new();
    let mut cur: Option<Builder> = None;
    let mut field: Option<String> = None;

    loop {
        match reader.read_event() {
            Ok(Event::Start(e)) => {
                let name = start_local(&e);
                match kind_from(&name) {
                    Some(kind) if cur.is_none() => {
                        cur = Some(Builder {
                            kind: Some(kind),
                            ..Default::default()
                        });
                        field = None;
                    }
                    _ if cur.is_some() => field = Some(name),
                    _ => {}
                }
            }
            Ok(Event::Text(t)) => {
                if let (Some(b), Some(f)) = (cur.as_mut(), field.as_ref()) {
                    let val = t.unescape().unwrap_or_default();
                    b.set(f, &val);
                }
            }
            Ok(Event::End(e)) => {
                let name = end_local(&e);
                let is_record_end = cur
                    .as_ref()
                    .and_then(|b| b.kind)
                    .map(|k| kind_from(&name) == Some(k))
                    .unwrap_or(false);
                if is_record_end {
                    if let Some(ev) = cur.take().and_then(Builder::build) {
                        events.push(ev);
                    }
                }
                field = None;
            }
            Ok(Event::Eof) | Err(_) => break,
            _ => {}
        }
    }
    events
}

#[cfg(test)]
mod tests {
    use super::*;

    const SAMPLE: &str = r#"<?xml version="1.0" encoding="UTF-8"?>
    <VV_TM_PUSH xmlns="bison" schema="8.2.0.0">
      <KV6posinfo>
        <ONROUTE>
          <dataownercode>RET</dataownercode>
          <lineplanningnumber>M1</lineplanningnumber>
          <operatingday>2026-07-07</operatingday>
          <journeynumber>4001</journeynumber>
          <timestamp>2026-07-07T12:00:00+02:00</timestamp>
          <vehiclenumber>1001</vehiclenumber>
          <punctuality>-30</punctuality>
          <rd-x>120700</rd-x>
          <rd-y>487200</rd-y>
          <blockcode>77</blockcode>
        </ONROUTE>
        <ARRIVAL>
          <dataownercode>RET</dataownercode>
          <lineplanningnumber>M1</lineplanningnumber>
          <journeynumber>4001</journeynumber>
          <timestamp>2026-07-07T12:01:00+02:00</timestamp>
          <vehiclenumber>1001</vehiclenumber>
          <userstopcode>HAL42</userstopcode>
          <rd-x>120750</rd-x>
          <rd-y>487210</rd-y>
        </ARRIVAL>
      </KV6posinfo>
    </VV_TM_PUSH>"#;

    #[test]
    fn parses_two_records() {
        let evs = parse_kv6(SAMPLE);
        assert_eq!(evs.len(), 2);
        assert_eq!(evs[0].kind, MessageKind::OnRoute);
        assert_eq!(evs[0].key.dataowner, "RET");
        assert_eq!(evs[0].key.vehicle_number, "1001");
        assert_eq!(evs[0].punctuality, Some(-30));
        assert_eq!(evs[0].rd_x, Some(120700.0));
        assert_eq!(evs[0].block_code.as_deref(), Some("77"));
        assert_eq!(evs[1].kind, MessageKind::Arrival);
        assert_eq!(evs[1].user_stop_code.as_deref(), Some("HAL42"));
    }

    #[test]
    fn skips_record_without_vehicle() {
        let xml = r#"<KV6posinfo><END><dataownercode>RET</dataownercode></END></KV6posinfo>"#;
        assert_eq!(parse_kv6(xml).len(), 0);
    }
}

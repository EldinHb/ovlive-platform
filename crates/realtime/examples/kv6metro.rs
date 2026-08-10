//! Throwaway diagnostic: sample BISON KV6 (port 7658) and dump the raw records RET
//! metros publish, so a human can see exactly which fields (and which positions) the
//! metro actually sends before anything parses them.
//!
//! Writes a Markdown report with (1) per-kind record counts for RET `M*` lines,
//! (2) an rd-x/rd-y value census, and (3) a handful of full raw records.
//!
//! Run: `cargo run --example kv6metro -p ovlive-realtime`
//! Env: SAMPLE_SECS (default 120), OUT (default data/kv6-ret-metro.md).
//!
//! NB fair-use: only ONE connection per datastream. This connects to KV6 (:7658), so
//! STOP the server first — it holds the one allowed KV6 SUB.

use std::collections::BTreeMap;
use std::fmt::Write as _;
use std::io::Read;
use std::time::{Duration, Instant};

use flate2::read::GzDecoder;
use zeromq::{Socket, SocketRecv, SubSocket};

fn gunzip(payload: &[u8]) -> Option<String> {
    let mut d = GzDecoder::new(payload);
    let mut s = String::new();
    if d.read_to_string(&mut s).is_ok() && !s.is_empty() {
        return Some(s);
    }
    String::from_utf8(payload.to_vec()).ok()
}

/// Extract the text of `<tag>text</tag>` inside `record`. Namespace-blind on purpose.
fn field<'a>(record: &'a str, tag: &str) -> Option<&'a str> {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let s = record.find(&open)? + open.len();
    let e = record[s..].find(&close)? + s;
    Some(record[s..e].trim())
}

const KINDS: [&str; 8] = [
    "INIT", "ARRIVAL", "ONSTOP", "DEPARTURE", "ONROUTE", "DELAY", "OFFROUTE", "END",
];

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let endpoint = std::env::var("ZMQ_KV6_ENDPOINT")
        .unwrap_or_else(|_| "tcp://pubsub.besteffort.ndovloket.nl:7658".into());
    let secs: u64 = std::env::var("SAMPLE_SECS").ok().and_then(|v| v.parse().ok()).unwrap_or(120);
    let out = std::env::var("OUT").unwrap_or_else(|_| "data/kv6-ret-metro.md".into());

    let mut socket = SubSocket::new();
    socket.connect(&endpoint).await?;
    // Subscribe to everything: the RET envelope name is part of what we're measuring.
    socket.subscribe("").await?;
    println!("subscribed on {endpoint}; sampling {secs}s");

    let deadline = Instant::now() + Duration::from_secs(secs);
    let mut envelopes: BTreeMap<String, u64> = BTreeMap::new();
    // kind -> count, for RET M* records only.
    let mut kind_counts: BTreeMap<String, u64> = BTreeMap::new();
    // rd-x classification for RET M* records: "missing" / "-1" / "positive" / "other".
    let mut rd_census: BTreeMap<String, u64> = BTreeMap::new();
    let mut punct_present = 0u64;
    let mut stopcodes: BTreeMap<String, u64> = BTreeMap::new();
    let mut lines: BTreeMap<String, u64> = BTreeMap::new();
    let mut samples: Vec<String> = Vec::new();
    let mut metro_records = 0u64;
    let mut msgs = 0u64;

    while Instant::now() < deadline {
        let left = deadline.saturating_duration_since(Instant::now());
        let Ok(Ok(msg)) = tokio::time::timeout(left, socket.recv()).await else { break };
        let frames = msg.into_vec();
        let env = String::from_utf8_lossy(&frames[0]).to_string();
        if frames.len() < 2 {
            continue;
        }
        let payload: Vec<u8> = frames[1..].iter().flat_map(|b| b.iter().copied()).collect();
        let Some(text) = gunzip(&payload) else { continue };
        msgs += 1;
        if !text.contains(">RET<") && !text.contains("RET</dataownercode>") {
            continue;
        }
        *envelopes.entry(env).or_default() += 1;

        // Walk records by kind element; keep only RET + lineplanningnumber starting M.
        for kind in KINDS {
            let open = format!("<{kind}>");
            let close = format!("</{kind}>");
            let mut rest = text.as_str();
            while let Some(s) = rest.find(&open) {
                let Some(e_rel) = rest[s..].find(&close) else { break };
                let record = &rest[s..s + e_rel + close.len()];
                rest = &rest[s + e_rel + close.len()..];

                if field(record, "dataownercode") != Some("RET") {
                    continue;
                }
                let line = field(record, "lineplanningnumber").unwrap_or("");
                if !line.starts_with('M') {
                    continue;
                }
                metro_records += 1;
                *kind_counts.entry(kind.to_string()).or_default() += 1;
                *lines.entry(line.to_string()).or_default() += 1;
                let rd = match field(record, "rd-x") {
                    None => "missing".to_string(),
                    Some("-1") => "-1".to_string(),
                    Some(v) if v.parse::<f64>().map(|x| x > 0.0).unwrap_or(false) => {
                        "positive".to_string()
                    }
                    Some(v) => format!("other({v})"),
                };
                *rd_census.entry(rd).or_default() += 1;
                if field(record, "punctuality").is_some() {
                    punct_present += 1;
                }
                if let Some(sc) = field(record, "userstopcode") {
                    *stopcodes.entry(sc.to_string()).or_default() += 1;
                }
                if samples.len() < 12 {
                    samples.push(record.to_string());
                }
            }
        }
    }

    let mut md = String::new();
    writeln!(md, "# KV6 RET metro sample\n")?;
    writeln!(md, "- endpoint: `{endpoint}`")?;
    writeln!(md, "- sampled: {secs}s, {msgs} decodable KV6 messages")?;
    writeln!(md, "- RET `M*` records seen: {metro_records}, punctuality present on {punct_present}\n")?;
    writeln!(md, "## Envelopes carrying RET records\n\n| envelope | messages |\n|---|---|")?;
    for (e, n) in &envelopes {
        writeln!(md, "| `{e}` | {n} |")?;
    }
    writeln!(md, "\n## Record kinds (RET M\\*)\n\n| kind | count |\n|---|---|")?;
    for (k, n) in &kind_counts {
        writeln!(md, "| `{k}` | {n} |")?;
    }
    writeln!(md, "\n## Lines seen\n\n| line | records |\n|---|---|")?;
    for (l, n) in &lines {
        writeln!(md, "| `{l}` | {n} |")?;
    }
    writeln!(md, "\n## rd-x census (RET M\\*)\n\n| rd-x | count |\n|---|---|")?;
    for (r, n) in &rd_census {
        writeln!(md, "| `{r}` | {n} |")?;
    }
    writeln!(md, "\n## Distinct userstopcodes (first 40)\n\n| code | count |\n|---|---|")?;
    for (c, n) in stopcodes.iter().take(40) {
        writeln!(md, "| `{c}` | {n} |")?;
    }
    writeln!(md, "\n## Sample raw records\n")?;
    for s in &samples {
        writeln!(md, "```xml\n{s}\n```")?;
    }

    std::fs::write(&out, md)?;
    println!(
        "wrote {out} ({metro_records} metro records across {msgs} messages)"
    );
    Ok(())
}

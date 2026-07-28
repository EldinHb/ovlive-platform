//! Throwaway diagnostic: measure how well the NS InfoPlus **RitInfo** feed covers the trains
//! that are actually reporting positions, and what delays it carries.
//!
//! `NStreinpositiesInterface5` has no punctuality at all, so train delay has to come from
//! `InfoPlusRITInterface5`. But RitInfo is an *event* feed — a message per train when its
//! journey info changes — not a snapshot, so the question that decides whether it's usable is
//! empirical: of the trains currently on the map, how many have we heard a RitInfo for, and
//! how quickly?
//!
//! Both envelopes are read over ONE SUB connection (they share datastream `:7664`), which is
//! also how the server consumes them.
//!
//! Run: `cargo run --release --example nsdelay -p ovlive-realtime`
//! Env: SAMPLE_SECS (default 180), OUT (default data/ns-delay-coverage.md).
//!
//! NB fair-use: one connection per datastream — stop the server before running this.

use std::collections::{BTreeMap, HashMap, HashSet};
use std::fmt::Write as _;
use std::io::Read;
use std::time::{Duration, Instant};

use chrono::{DateTime, Utc};
use flate2::read::GzDecoder;
use zeromq::{Socket, SocketRecv, SubSocket};

const POS_TOPIC: &str = "/RIG/NStreinpositiesInterface5";
const RIT_TOPIC: &str = "/RIG/InfoPlusRITInterface5";
/// The departure-board feed: one message per station board, republished as delays move. Much
/// higher volume than RitInfo, and the reason this diagnostic compares the two.
const DVS_TOPIC: &str = "/RIG/InfoPlusDVSInterface4";

fn gunzip(payload: &[u8]) -> Option<String> {
    let mut d = GzDecoder::new(payload);
    let mut s = String::new();
    d.read_to_string(&mut s).ok().map(|_| s)
}

/// Drop namespace prefixes from tag names, so one extractor works on both the prefixed
/// positions feed (`<tns3:TreinNummer>`) and the default-namespaced InfoPlus ones.
fn strip_ns(xml: &str) -> String {
    let mut out = String::with_capacity(xml.len());
    let mut rest = xml;
    while let Some(i) = rest.find('<') {
        out.push_str(&rest[..=i]);
        let after = &rest[i + 1..];
        let head: String = after.chars().take_while(|c| *c != '>' && *c != ' ').collect();
        // "/tns3:TreinNummer" or "tns3:TreinNummer" -> keep the slash, drop the prefix.
        let (slash, name) = match head.strip_prefix('/') {
            Some(n) => ("/", n),
            None => ("", head.as_str()),
        };
        let local = name.rsplit(':').next().unwrap_or(name);
        out.push_str(slash);
        out.push_str(local);
        rest = &after[head.len()..];
    }
    out.push_str(rest);
    out
}

/// All `<Tag>text</Tag>` / `<Tag attr=…>text</Tag>` values for one tag, closing tags ignored.
fn values(xml: &str, tag: &str) -> Vec<String> {
    let open = format!("<{tag}");
    let close = format!("</{tag}>");
    let mut out = Vec::new();
    let mut rest = xml;
    while let Some(i) = rest.find(&open) {
        let after = &rest[i + open.len()..];
        // Must be the element itself, not a longer name sharing the prefix.
        let Some(c) = after.chars().next() else { break };
        if c != '>' && c != ' ' && c != '/' {
            rest = after;
            continue;
        }
        // Step past the rest of the start tag, then take text up to this tag's close.
        let Some(gt) = after.find('>') else { break };
        let body = &after[gt + 1..];
        match body.find(&close) {
            Some(j) => out.push(body[..j].to_string()),
            None => break,
        }
        rest = body;
    }
    out
}

/// One station block of a RitInfo message, reduced to what a delay needs.
struct Stop {
    planned_dep: Option<DateTime<Utc>>,
    actual_dep: Option<DateTime<Utc>>,
    planned_arr: Option<DateTime<Utc>>,
    actual_arr: Option<DateTime<Utc>>,
}

fn ts(s: &str) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(s.trim()).ok().map(|d| d.with_timezone(&Utc))
}

/// Split a RitInfo document into its per-station blocks and pull times out of each.
fn parse_rit(xml: &str) -> Option<(String, String, Vec<Stop>)> {
    let number = values(xml, "TreinNummer").into_iter().next()?;
    let soort = values(xml, "TreinSoort")
        .into_iter()
        .next()
        .unwrap_or_default();
    let mut stops = Vec::new();
    for block in xml.split("<LogischeRitDeelStation>").skip(1) {
        let block = block.split("</LogischeRitDeelStation>").next().unwrap_or(block);
        // Gepland comes before Actueel in every message sampled, but match on the attribute
        // rather than order.
        let mut planned_dep = None;
        let mut actual_dep = None;
        let mut planned_arr = None;
        let mut actual_arr = None;
        for (tag, planned, actual) in [
            ("VertrekTijd", &mut planned_dep, &mut actual_dep),
            ("AankomstTijd", &mut planned_arr, &mut actual_arr),
        ] {
            for seg in block.split(&format!("<{tag} ")).skip(1) {
                let is_actual = seg.starts_with("InfoStatus=\"Actueel\"");
                let Some(v) = seg.split('>').nth(1).and_then(|t| t.split('<').next()) else {
                    continue;
                };
                let slot = if is_actual { &mut *actual } else { &mut *planned };
                if slot.is_none() {
                    *slot = ts(v);
                }
            }
        }
        stops.push(Stop { planned_dep, actual_dep, planned_arr, actual_arr });
    }
    Some((number, soort, stops))
}

/// The train's delay *right now*: at the next stop it hasn't departed yet, else at its last.
fn current_delay(stops: &[Stop], now: DateTime<Utc>) -> Option<i64> {
    let next = stops
        .iter()
        .find(|s| s.actual_dep.is_some_and(|a| a >= now))
        .or_else(|| stops.last());
    let s = next?;
    if let (Some(p), Some(a)) = (s.planned_dep, s.actual_dep) {
        return Some((a - p).num_seconds());
    }
    if let (Some(p), Some(a)) = (s.planned_arr, s.actual_arr) {
        return Some((a - p).num_seconds());
    }
    None
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let endpoint = "tcp://pubsub.besteffort.ndovloket.nl:7664";
    let secs: u64 = std::env::var("SAMPLE_SECS").ok().and_then(|v| v.parse().ok()).unwrap_or(180);
    let out = std::env::var("OUT").unwrap_or_else(|_| "data/ns-delay-coverage.md".into());

    let mut socket = SubSocket::new();
    socket.connect(endpoint).await?;
    socket.subscribe(POS_TOPIC).await?;
    socket.subscribe(RIT_TOPIC).await?;
    socket.subscribe(DVS_TOPIC).await?;
    eprintln!("sampling both envelopes on {endpoint} for {secs}s");

    let start = Instant::now();
    let deadline = start + Duration::from_secs(secs);
    // train -> first time we saw a RitInfo for it (seconds into the run)
    let mut rit_first: HashMap<String, u64> = HashMap::new();
    let mut rit_msgs = 0u64;
    let mut pos_msgs = 0u64;
    let mut live: HashSet<String> = HashSet::new();
    let mut delays: HashMap<String, i64> = HashMap::new();
    let mut soorten: BTreeMap<String, u64> = BTreeMap::new();
    let mut dvs_msgs = 0u64;
    let mut dvs_first: HashMap<String, u64> = HashMap::new();
    let mut dvs_bytes = 0usize;
    let mut rit_bytes = 0usize;
    let mut stops_per_rit: Vec<usize> = Vec::new();

    while Instant::now() < deadline {
        let left = deadline.saturating_duration_since(Instant::now());
        let Ok(Ok(msg)) = tokio::time::timeout(left, socket.recv()).await else { break };
        let frames = msg.into_vec();
        if frames.len() < 2 {
            continue;
        }
        let env = String::from_utf8_lossy(&frames[0]).to_string();
        let payload: Vec<u8> = frames[1..].iter().flat_map(|b| b.iter().copied()).collect();
        let Some(raw) = gunzip(&payload) else { continue };
        let xml = strip_ns(&raw);
        let elapsed = start.elapsed().as_secs();

        if env.contains("NStreinposities") {
            pos_msgs += 1;
            for n in values(&xml, "TreinNummer") {
                live.insert(n);
            }
        } else if env.contains("DVS") {
            dvs_msgs += 1;
            dvs_bytes += xml.len();
            for n in values(&xml, "TreinNummer") {
                dvs_first.entry(n).or_insert(elapsed);
            }
        } else if env.contains("RIT") {
            rit_msgs += 1;
            rit_bytes += xml.len();
            if let Some((number, soort, stops)) = parse_rit(&xml) {
                rit_first.entry(number.clone()).or_insert(elapsed);
                *soorten.entry(soort).or_default() += 1;
                stops_per_rit.push(stops.len());
                if let Some(d) = current_delay(&stops, Utc::now()) {
                    delays.insert(number, d);
                }
            }
        }
    }

    let covered: Vec<&String> = live.iter().filter(|n| rit_first.contains_key(*n)).collect();
    let dvs_covered = live.iter().filter(|n| dvs_first.contains_key(*n)).count();
    let mut dvs_times: Vec<u64> = live.iter().filter_map(|n| dvs_first.get(n).copied()).collect();
    dvs_times.sort_unstable();
    let with_delay = live.iter().filter(|n| delays.contains_key(*n)).count();
    let mut times: Vec<u64> = covered.iter().filter_map(|n| rit_first.get(*n).copied()).collect();
    times.sort_unstable();

    let mut md = String::new();
    writeln!(md, "# NS RitInfo delay coverage vs live train positions\n")?;
    writeln!(md, "- sampled {secs}s on `{endpoint}` (one SUB, two envelopes)")?;
    writeln!(md, "- positions: {pos_msgs} messages, {} distinct trains seen", live.len())?;
    writeln!(md, "- RitInfo: {rit_msgs} messages, {} distinct trains", rit_first.len())?;
    writeln!(
        md,
        "- **live trains with a RitInfo: {}/{} = {:.1}%**",
        covered.len(),
        live.len(),
        100.0 * covered.len() as f64 / live.len().max(1) as f64
    )?;
    writeln!(
        md,
        "- live trains with a usable delay: {}/{} = {:.1}%\n",
        with_delay,
        live.len(),
        100.0 * with_delay as f64 / live.len().max(1) as f64
    )?;
    if !times.is_empty() {
        writeln!(
            md,
            "Seconds into the run before a live train's first RitInfo: p50 {}s, p90 {}s, max {}s\n",
            times[times.len() / 2],
            times[times.len() * 9 / 10],
            times[times.len() - 1]
        )?;
    }
    if !stops_per_rit.is_empty() {
        stops_per_rit.sort_unstable();
        writeln!(
            md,
            "Station blocks per RitInfo: min {} / median {} / max {}\n",
            stops_per_rit[0],
            stops_per_rit[stops_per_rit.len() / 2],
            stops_per_rit[stops_per_rit.len() - 1]
        )?;
    }
    writeln!(
        md,
        "- DVS: {dvs_msgs} messages ({} KiB), {} distinct trains; **covers {}/{} = {:.1}% of live trains**",
        dvs_bytes / 1024,
        dvs_first.len(),
        dvs_covered,
        live.len(),
        100.0 * dvs_covered as f64 / live.len().max(1) as f64
    )?;
    writeln!(md, "- RitInfo payload: {} KiB over the run\n", rit_bytes / 1024)?;
    if !dvs_times.is_empty() {
        writeln!(
            md,
            "Seconds before a live train's first DVS mention: p50 {}s, p90 {}s, max {}s\n",
            dvs_times[dvs_times.len() / 2],
            dvs_times[dvs_times.len() * 9 / 10],
            dvs_times[dvs_times.len() - 1]
        )?;
    }
    writeln!(md, "## TreinSoort seen\n\n| soort | messages |\n|---|---|")?;
    for (k, v) in &soorten {
        writeln!(md, "| {k} | {v} |")?;
    }
    let mut ds: Vec<i64> = delays.values().copied().collect();
    ds.sort_unstable();
    if !ds.is_empty() {
        let ontime = ds.iter().filter(|d| **d == 0).count();
        let late = ds.iter().filter(|d| **d > 0).count();
        writeln!(
            md,
            "\n## Delays\n\n{} trains: {} exactly 0, {} late, {} early. min {}s / median {}s / max {}s\n",
            ds.len(),
            ontime,
            late,
            ds.len() - ontime - late,
            ds[0],
            ds[ds.len() / 2],
            ds[ds.len() - 1]
        )?;
        writeln!(md, "| train | delay (s) |\n|---|---|")?;
        let mut rows: Vec<(&String, &i64)> = delays.iter().collect();
        rows.sort_by_key(|(_, d)| -**d);
        for (n, d) in rows.iter().take(15) {
            writeln!(md, "| {n} | {d} |")?;
        }
    }

    std::fs::write(&out, md)?;
    eprintln!("wrote {out}");
    Ok(())
}

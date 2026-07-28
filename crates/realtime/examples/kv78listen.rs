//! Throwaway diagnostic: listen to the KV78Turbo (`KV8passtimes`) feed for a while and
//! capture everything about one operator's line, so a human can read the raw wire format.
//!
//! Saves a Markdown report with (1) a full sample raw message, (2) the matching stop rows
//! for the chosen operator+public line, and (3) the aggregated journeys as the server would
//! parse them (`parse_kv78`).
//!
//! Run: `cargo run --example kv78listen -p ovlive-realtime`
//! Env: SAMPLE_SECS (default 30), OWNER (default RET), LINE (public number, default 42),
//!      OUT (output file, default data/kv78-<owner>-line<line>.md).
//!
//! NB fair-use: only ONE connection per datastream — don't run this while the server's
//! KV78 stream is also connected.

use std::collections::{BTreeMap, BTreeSet};
use std::fmt::Write as _;
use std::time::{Duration, Instant};

use chrono::{DateTime, NaiveDateTime, TimeZone, Utc};
use flate2::read::GzDecoder;
use ovlive_realtime::parse_kv78;
use std::io::Read;
use zeromq::{Socket, SocketRecv, SubSocket};

fn gunzip(payload: &[u8]) -> Option<String> {
    let mut d = GzDecoder::new(payload);
    let mut s = String::new();
    d.read_to_string(&mut s).ok().map(|_| s)
}

/// Parse an absolute KV78 timestamp (`Vejo…Time`): naive Europe/Amsterdam local, or RFC3339.
fn parse_abs(s: &str) -> Option<DateTime<Utc>> {
    if s.is_empty() || s == "\\0" {
        return None;
    }
    if let Ok(dt) = DateTime::parse_from_rfc3339(s) {
        return Some(dt.with_timezone(&Utc));
    }
    let naive = NaiveDateTime::parse_from_str(s, "%Y-%m-%dT%H:%M:%S").ok()?;
    chrono_tz::Europe::Amsterdam.from_local_datetime(&naive).single().map(|l| l.with_timezone(&Utc))
}

/// Format a duration in signed `±MmSSs` (e.g. `+7m03s`, `−1m20s`).
fn fmt_signed(secs: i64) -> String {
    let sign = if secs < 0 { "−" } else { "+" };
    let s = secs.abs();
    format!("{sign}{}m{:02}s", s / 60, s % 60)
}

/// What we track per journey to time its first appearance in the feed.
struct JSeen {
    first_seen: DateTime<Utc>,        // wall-clock time we first received a row for it
    start: Option<DateTime<Utc>>,     // min VejoDepartureTime (trip start)
    end: Option<DateTime<Utc>>,       // max VejoArrivalTime (trip end)
    public: String,
    dest: String,
    vehicle: String,
    block: String,
}

/// A value formatted for a Markdown table cell: null/empty → em dash, pipes escaped.
fn cell(s: &str) -> String {
    if s.is_empty() || s == "\\0" {
        "—".into()
    } else {
        s.replace('|', "\\|")
    }
}

/// Column indices for the fields we want, resolved from a `\L` header line.
struct Cols {
    owner: Option<usize>,
    public: Option<usize>,
    planning: Option<usize>,
    journey: Option<usize>,
    vehicle: Option<usize>,
    block: Option<usize>,
    dest: Option<usize>,
    vejo_dep: Option<usize>,
    vejo_arr: Option<usize>,
}
impl Cols {
    fn from_header(labels: &str) -> Self {
        let mut c = Cols {
            owner: None, public: None, planning: None, journey: None,
            vehicle: None, block: None, dest: None, vejo_dep: None, vejo_arr: None,
        };
        for (i, name) in labels.split('|').enumerate() {
            match name.trim().to_ascii_lowercase().as_str() {
                "dataownercode" => c.owner = Some(i),
                "linepublicnumber" => c.public = Some(i),
                "lineplanningnumber" => c.planning = Some(i),
                "journeynumber" => c.journey = Some(i),
                "vehiclenumber" => c.vehicle = Some(i),
                "blockcode" => c.block = Some(i),
                "destinationname" => c.dest = Some(i),
                "vejodeparturetime" => c.vejo_dep = Some(i),
                "vejoarrivaltime" => c.vejo_arr = Some(i),
                _ => {}
            }
        }
        c
    }
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let secs: u64 = std::env::var("SAMPLE_SECS").ok().and_then(|v| v.parse().ok()).unwrap_or(30);
    let owner = std::env::var("OWNER").unwrap_or_else(|_| "RET".into());
    let line = std::env::var("LINE").unwrap_or_else(|_| "42".into());
    // Which column `LINE` matches against: MATCH=planning → LinePlanningNumber (internal id),
    // otherwise LinePublicNumber (what riders see). Default public.
    let by_planning = std::env::var("MATCH").map(|m| m.eq_ignore_ascii_case("planning")).unwrap_or(false);
    let field_name = if by_planning { "LinePlanningNumber" } else { "LinePublicNumber" };
    // Filter override precedence: BLOCK > VEHICLE > line. All still scoped to OWNER.
    let block = std::env::var("BLOCK").ok().filter(|v| !v.is_empty());
    let vehicle = std::env::var("VEHICLE").ok().filter(|v| !v.is_empty());

    let (subject, tag) = match (&block, &vehicle) {
        (Some(b), _) => (format!("{owner} block {b}"), format!("block{b}")),
        (None, Some(v)) => (format!("{owner} vehicle {v}"), format!("veh{v}")),
        (None, None) => (
            format!("{owner} {field_name} {line}"),
            format!("{}{}", if by_planning { "plan" } else { "pub" }, line),
        ),
    };
    let out = std::env::var("OUT")
        .unwrap_or_else(|_| format!("data/kv78-{}-{}.md", owner.to_lowercase(), tag));

    eprintln!("connecting to KV78Turbo; capturing {subject} for {secs}s...");
    let mut socket = SubSocket::new();
    socket.connect("tcp://pubsub.besteffort.ndovloket.nl:7817").await?;
    socket.subscribe("/GOVI/KV8passtimes/").await?;

    // What we collect.
    let mut messages = 0u64;
    let mut sample_raw: Option<String> = None; // first full message, verbatim
    let mut match_header: Option<String> = None; // the \L header for matched rows
    let mut match_rows: Vec<String> = Vec::new(); // raw stop rows for owner+line
    // journey -> (planning line, public line, block, destination, start)
    let mut journeys: BTreeMap<String, (String, String, String, String, String)> = BTreeMap::new();
    // journey -> vehicle number (from the raw rows; parse_kv78 doesn't carry it)
    let mut journey_vehicle: BTreeMap<String, String> = BTreeMap::new();
    // Journey numbers that matched the filter — used to pick the aggregated journeys, since a
    // vehicle filter can't be expressed on parse_kv78's output (it has no vehicle number).
    let mut matched_journeys: BTreeSet<String> = BTreeSet::new();
    // Bonus context: which public lines this operator is currently sending.
    let mut owner_lines: BTreeMap<String, u32> = BTreeMap::new();
    // Per-journey first-appearance timing (the "when does the next journey show up" question).
    let mut seen: BTreeMap<String, JSeen> = BTreeMap::new();
    let t0 = Utc::now();

    let deadline = Instant::now() + Duration::from_secs(secs);
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            break;
        }
        let msg = match tokio::time::timeout(remaining.min(Duration::from_secs(5)), socket.recv()).await {
            Ok(res) => res?,
            Err(_) => continue, // timeout tick; re-check deadline
        };
        let frames = msg.into_vec();
        if frames.len() < 2 {
            continue; // topic-only heartbeat
        }
        let payload: Vec<u8> = frames[1..].iter().flat_map(|b| b.iter().copied()).collect();
        let Some(text) = gunzip(&payload) else { continue };
        messages += 1;
        if sample_raw.is_none() {
            sample_raw = Some(text.clone());
        }

        // Scan raw rows: track the current \L header, filter data rows to owner+line.
        let mut cols: Option<Cols> = None;
        for l in text.lines() {
            if let Some(rest) = l.strip_prefix("\\L") {
                cols = Some(Cols::from_header(rest));
            } else if l.starts_with('\\') || l.is_empty() {
                continue;
            } else if let Some(c) = &cols {
                let vals: Vec<&str> = l.split('|').collect();
                let get = |i: Option<usize>| i.and_then(|i| vals.get(i)).copied().unwrap_or("");
                if get(c.owner) != owner {
                    continue;
                }
                let pub_line = get(c.public);
                *owner_lines.entry(pub_line.to_string()).or_default() += 1;
                // Match by block (if BLOCK set), else vehicle (if VEHICLE set), else the line column.
                let matched = match (&block, &vehicle) {
                    (Some(b), _) => get(c.block) == b.as_str(),
                    (None, Some(v)) => get(c.vehicle) == v.as_str(),
                    (None, None) => (if by_planning { get(c.planning) } else { pub_line }) == line,
                };
                if matched {
                    if match_header.is_none() {
                        // Reconstruct the header we matched against for the report.
                        if let Some(h) = text.lines().find(|x| x.starts_with("\\L")) {
                            match_header = Some(h.trim_start_matches("\\L").to_string());
                        }
                    }
                    let journey = get(c.journey);
                    let veh = get(c.vehicle);
                    if !journey.is_empty() {
                        matched_journeys.insert(journey.to_string());
                        if !veh.is_empty() && veh != "\\0" {
                            journey_vehicle.insert(journey.to_string(), veh.to_string());
                        }
                        // Record when this journey was first seen, plus its start/end bounds.
                        let e = seen.entry(journey.to_string()).or_insert_with(|| JSeen {
                            first_seen: Utc::now(),
                            start: None,
                            end: None,
                            public: String::new(),
                            dest: String::new(),
                            vehicle: String::new(),
                            block: String::new(),
                        });
                        if let Some(d) = parse_abs(get(c.vejo_dep)) {
                            e.start = Some(e.start.map_or(d, |cur| cur.min(d)));
                        }
                        if let Some(a) = parse_abs(get(c.vejo_arr)) {
                            e.end = Some(e.end.map_or(a, |cur| cur.max(a)));
                        }
                        if e.public.is_empty() {
                            e.public = get(c.public).to_string();
                        }
                        if e.dest.is_empty() && get(c.dest) != "\\0" {
                            e.dest = get(c.dest).to_string();
                        }
                        if e.vehicle.is_empty() && veh != "\\0" {
                            e.vehicle = veh.to_string();
                        }
                        if e.block.is_empty() && get(c.block) != "\\0" {
                            e.block = get(c.block).to_string();
                        }
                    }
                    match_rows.push(l.to_string());
                }
            }
        }

        // Aggregated journeys (server view) — those whose journey number matched the filter.
        for u in parse_kv78(&text) {
            if u.dataowner == owner && matched_journeys.contains(&u.journey_number) {
                let start = u
                    .start
                    .map(|s| s.with_timezone(&chrono_tz::Europe::Amsterdam).format("%Y-%m-%d %H:%M").to_string())
                    .unwrap_or_else(|| "—".into());
                journeys.insert(
                    u.journey_number.clone(),
                    (
                        u.line_planning_number.clone(),
                        u.line_public_number.clone(),
                        u.block_code.clone(),
                        u.destination.clone(),
                        start,
                    ),
                );
            }
        }
    }

    // Build the report as Markdown tables.
    let mut r = String::new();
    let filter_desc = match (&block, &vehicle) {
        (Some(b), _) => format!("`BlockCode` = **{b}**"),
        (None, Some(v)) => format!("`VehicleNumber` = **{v}**"),
        (None, None) => format!("`{field_name}` = **{line}**"),
    };
    let _ = writeln!(r, "# KV78Turbo (KV8passtimes) live capture — {subject}\n");
    let _ = writeln!(r, "Operator **{owner}**, {filter_desc} · sampled {secs} s · **{messages} messages**.\n");

    // 1. Structure.
    let _ = writeln!(r, "## 1. Message structure\n");
    let _ = writeln!(r, "ZeroMQ SUB on `tcp://…:7817`, topic `/GOVI/KV8passtimes/`; multipart, gzip, pipe-delimited text (not XML).\n");
    let _ = writeln!(r, "| Line prefix | Kind | Meaning |");
    let _ = writeln!(r, "| --- | --- | --- |");
    let _ = writeln!(r, "| `\\G…` | envelope | feed name, source, encoding, timestamp |");
    let _ = writeln!(r, "| `\\T…` | object marker | start/end of a batch of rows |");
    let _ = writeln!(r, "| `\\C…` | context | batch metadata |");
    let _ = writeln!(r, "| `\\L…` | column labels | columns for the rows below |");
    let _ = writeln!(r, "| *(none)* | data row | one stop passage; `\\0` = null |\n");

    // Header labels for the matched rows (resolved once).
    let labels: Vec<&str> = match_header.as_deref().unwrap_or("").split('|').collect();
    let idx = |name: &str| labels.iter().position(|l| l.eq_ignore_ascii_case(name));

    // 2. Curated matched-rows table.
    let want = [
        "JourneyNumber", "VehicleNumber", "LinePlanningNumber", "LinePublicNumber", "UserStopCode",
        "TripStopStatus", "TargetDepartureTime", "ExpectedDepartureTime", "BlockCode", "DestinationName",
    ];
    let _ = writeln!(r, "## 2. {subject} — stop rows ({})\n", match_rows.len());
    if match_rows.is_empty() {
        let _ = writeln!(r, "_None in this window (likely off-peak)._\n");
    } else {
        let _ = writeln!(r, "| {} |", want.join(" | "));
        let _ = writeln!(r, "|{}", " --- |".repeat(want.len()));
        for row in match_rows.iter().take(100) {
            let vals: Vec<&str> = row.split('|').collect();
            let cells: Vec<String> = want
                .iter()
                .map(|w| cell(idx(w).and_then(|i| vals.get(i)).copied().unwrap_or("")))
                .collect();
            let _ = writeln!(r, "| {} |", cells.join(" | "));
        }
        let _ = writeln!(r);
    }

    // 3. Full field dump of the first matched row.
    if let Some(row) = match_rows.first() {
        let vals: Vec<&str> = row.split('|').collect();
        let _ = writeln!(r, "## 3. First {subject} row — all fields\n");
        let _ = writeln!(r, "| Field | Value |");
        let _ = writeln!(r, "| --- | --- |");
        for (i, lbl) in labels.iter().enumerate() {
            let _ = writeln!(r, "| {} | {} |", cell(lbl), cell(vals.get(i).copied().unwrap_or("")));
        }
        let _ = writeln!(r);
    }

    // 4. Aggregated journeys (server view).
    let _ = writeln!(r, "## 4. {subject} — journeys (server view, {})\n", journeys.len());
    if journeys.is_empty() {
        let _ = writeln!(r, "_None._\n");
    } else {
        let _ = writeln!(r, "| Journey | Vehicle | Planning line | Public line | Block | Destination | Starts |");
        let _ = writeln!(r, "| --- | --- | --- | --- | --- | --- | --- |");
        for (j, (plan, public, block, dest, start)) in &journeys {
            let veh = journey_vehicle.get(j).map(String::as_str).unwrap_or("");
            let _ = writeln!(
                r, "| {} | {} | {} | {} | {} | {} | {} |",
                cell(j), cell(veh), cell(plan), cell(public), cell(block), cell(dest), cell(start),
            );
        }
        let _ = writeln!(r);
    }

    // 5. Appearance timing — when each journey's message first came through.
    let ams = |dt: DateTime<Utc>| dt.with_timezone(&chrono_tz::Europe::Amsterdam).format("%H:%M:%S").to_string();
    // The feed cycles through all in-horizon journeys over ~25-30 s after connect, so anything
    // first seen within the first 60 s was almost certainly already present — not a fresh arrival.
    let epsilon = chrono::Duration::seconds(60);
    let _ = writeln!(r, "## 5. Appearance timing — when journeys enter the feed\n");
    let _ = writeln!(
        r,
        "Capture started **{}** (Amsterdam). *First seen* = wall-clock time we first received a \
         row for a journey. Only journeys first seen **>60 s after start** count as genuine new \
         appearances (the rest were already in the feed when we connected). *Lead* = start − first \
         seen (how far ahead of its own departure the message arrived; positive = before it departs).\n",
        ams(t0)
    );

    let mut rows_seen: Vec<(&String, &JSeen)> = seen.iter().collect();
    rows_seen.sort_by_key(|(_, j)| j.start.unwrap_or(t0));
    let mut leads: Vec<i64> = Vec::new();
    let _ = writeln!(r, "| Journey | Public | Dest | Vehicle | Block | First seen | Starts | Lead |");
    let _ = writeln!(r, "| --- | --- | --- | --- | --- | --- | --- | --- |");
    for (jn, j) in &rows_seen {
        if j.first_seen <= t0 + epsilon {
            continue; // already present at connect — its true first-appearance predates us
        }
        let (starts, lead) = match j.start {
            Some(s) => {
                let secs = (s - j.first_seen).num_seconds();
                leads.push(secs);
                (ams(s), fmt_signed(secs))
            }
            None => ("—".into(), "—".into()),
        };
        let _ = writeln!(
            r, "| {} | {} | {} | {} | {} | {} | {} | {} |",
            cell(jn), cell(&j.public), cell(&j.dest), cell(&j.vehicle), cell(&j.block),
            ams(j.first_seen), starts, lead,
        );
    }
    let mut future: Vec<i64> = leads.iter().copied().filter(|&s| s >= 0).collect();
    let already_running = leads.len() - future.len();
    if future.is_empty() {
        let _ = writeln!(r, "\n_No future journeys first appeared during this window — try a longer capture or a more frequent line._\n");
    } else {
        future.sort_unstable();
        let n = future.len();
        let _ = writeln!(
            r, "\n**Lead before departure**, {n} journey(s) that appeared *before* they started: \
            min {}, median {}, max {}.{}\n",
            fmt_signed(future[0]), fmt_signed(future[n / 2]), fmt_signed(future[n - 1]),
            if already_running > 0 {
                format!(" ({already_running} other new appearance(s) were already in progress when first matched.)")
            } else {
                String::new()
            },
        );
    }

    // How the appearance relates to the PREVIOUS trip's end in the same block.
    let _ = writeln!(r, "### Relative to the previous trip in the same block\n");
    let _ = writeln!(r, "*vs prev end* = next journey's first-seen − previous trip's scheduled end (VejoArrivalTime). Negative = the next journey appeared while the current trip was still running.\n");
    let _ = writeln!(r, "| Block | Prev journey | Prev ends | Next journey | Next first seen | vs prev end | Next starts |");
    let _ = writeln!(r, "| --- | --- | --- | --- | --- | --- | --- |");
    let mut by_block: BTreeMap<String, Vec<(&String, &JSeen)>> = BTreeMap::new();
    for (jn, j) in &rows_seen {
        if !j.block.is_empty() {
            by_block.entry(j.block.clone()).or_default().push((jn, j));
        }
    }
    let mut any_pair = false;
    for (blk, mut js) in by_block {
        js.sort_by_key(|(_, j)| j.start.unwrap_or(t0));
        for w in js.windows(2) {
            let (pj, p) = w[0];
            let (nj, n) = w[1];
            if n.first_seen <= t0 + epsilon {
                continue; // only pairs where the NEXT journey genuinely appeared in-window
            }
            let Some(pend) = p.end else { continue };
            let starts = n.start.map(ams).unwrap_or_else(|| "—".into());
            let _ = writeln!(
                r, "| {} | {} | {} | {} | {} | {} | {} |",
                cell(&blk), cell(pj), ams(pend), cell(nj), ams(n.first_seen),
                fmt_signed((n.first_seen - pend).num_seconds()), starts,
            );
            any_pair = true;
        }
    }
    if !any_pair {
        let _ = writeln!(r, "| _(no in-window block transitions captured)_ | | | | | | |");
    }
    let _ = writeln!(r);

    // 6. All of this operator's public lines seen.
    let _ = writeln!(r, "## 6. All {owner} public lines seen this window\n");
    let _ = writeln!(r, "| Line | Rows |");
    let _ = writeln!(r, "| --- | --- |");
    let mut lines: Vec<_> = owner_lines.iter().collect();
    lines.sort_by(|a, b| b.1.cmp(a.1).then(a.0.cmp(b.0)));
    for (pl, n) in lines {
        let _ = writeln!(r, "| {} | {} |", if pl.is_empty() { "(blank)".into() } else { cell(pl) }, n);
    }
    let _ = writeln!(r);

    // 6. Trimmed raw sample (control lines + first few data rows) so the wire format stays visible.
    if let Some(raw) = &sample_raw {
        let _ = writeln!(r, "## 7. Trimmed raw sample (first message)\n");
        let _ = writeln!(r, "```text");
        let mut data_rows = 0;
        for l in raw.lines() {
            if l.starts_with('\\') {
                let _ = writeln!(r, "{l}");
            } else if data_rows < 3 {
                let _ = writeln!(r, "{l}");
                data_rows += 1;
            }
        }
        let _ = writeln!(r, "…(remaining data rows omitted)");
        let _ = writeln!(r, "```");
    }

    std::fs::write(&out, &r)?;
    eprintln!(
        "done: {messages} messages; {} matched rows; {} journeys for {subject}. Wrote {out}",
        match_rows.len(),
        journeys.len()
    );
    Ok(())
}

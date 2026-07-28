//! Validate the parser + stop indexes against the **cached** `data/gtfs-nl.zip`.
//!
//! Parser changes must never be checked by re-downloading the ~230 MB archive (see the
//! data-source policy in CLAUDE.md), so this reads the local cache only and refuses to run
//! without it. Reports the counts and memory-relevant sizes the stops endpoints depend on.
//!
//! Run: `cargo run --release --example validate_feed -p ovlive-gtfs`
//! Env: `GTFS_ZIP` (default `data/gtfs-nl.zip`), `DATE` (`YYYY-MM-DD`, default today).

use std::path::Path;
use std::sync::Arc;
use std::time::Instant;

use chrono::NaiveDate;
use ovlive_gtfs::{parse_zip_file, service_date, StopIndexes};

fn main() -> anyhow::Result<()> {
    let zip = std::env::var("GTFS_ZIP").unwrap_or_else(|_| "data/gtfs-nl.zip".into());
    let path = Path::new(&zip);
    anyhow::ensure!(
        path.exists(),
        "no cached feed at {zip}; this tool never downloads (see the data-source policy). \
         Start the server once, or set GTFS_ZIP."
    );

    let date = match std::env::var("DATE") {
        Ok(d) => NaiveDate::parse_from_str(&d, "%Y-%m-%d")?,
        Err(_) => service_date(chrono::Utc::now(), chrono_tz::Europe::Amsterdam),
    };

    println!("parsing {zip} ...");
    let t = Instant::now();
    let store = Arc::new(parse_zip_file(path)?);
    println!("parsed in {:.1}s", t.elapsed().as_secs_f64());
    println!(
        "  feed_version={} agencies={} routes={} trips={} stops={} shapes={} rt_joins={}",
        store.feed_version,
        store.agencies.len(),
        store.routes.len(),
        store.trips.len(),
        store.stops.len(),
        store.shapes.len(),
        store.trip_by_key.len(),
    );

    let stop_times: usize = store.stop_times.values().map(|v| v.len()).sum();
    println!("  stop_times rows={stop_times}");

    // The new columns: how much of the feed actually populates them?
    let with_code = store.stops.values().filter(|s| s.code.is_some()).count();
    let with_platform = store.stops.values().filter(|s| s.platform_code.is_some()).count();
    let with_parent = store.stops.values().filter(|s| s.parent_station.is_some()).count();
    let with_service = store.trips.values().filter(|t| !t.service_id.is_empty()).count();
    println!(
        "  stops with stop_code={with_code} platform_code={with_platform} parent_station={with_parent}"
    );
    println!(
        "  services={} trips with service_id={with_service}/{}",
        store.service_dates.len(),
        store.trips.len()
    );
    anyhow::ensure!(with_code > 0, "no stop_code parsed — the passtime join would be dead");
    anyhow::ensure!(!store.service_dates.is_empty(), "no service calendar parsed");

    // How many trips actually run on the target date — the day-scoping premise.
    let ymd = date.format("%Y%m%d").to_string().parse::<u32>()?;
    let running = store.trips.values().filter(|t| store.runs_on(&t.service_id, ymd)).count();
    println!(
        "  trips running on {date}: {running} ({:.1}% of the feed)",
        100.0 * running as f64 / store.trips.len().max(1) as f64
    );
    anyhow::ensure!(running > 0, "no trips run on {date} — check the calendar parse");

    // The train join: NS InfoPlus identifies a train only by its number, so `train_trips` is
    // the sole path from a live train to its schedule. Assert the non-obvious parts — that
    // candidates are per operating pattern rather than collapsed, and that a number resolves
    // to exactly one trip on a given day.
    let candidates: usize = store.train_trips.values().map(|v| v.len()).sum();
    let resolved = store
        .train_trips
        .keys()
        .filter(|n| store.resolve_train_trip(n, date).is_some())
        .count();
    println!(
        "  train numbers={} candidate rail trips={} ({:.1} per number); resolve on {date} -> {resolved}",
        store.train_trips.len(),
        candidates,
        candidates as f64 / store.train_trips.len().max(1) as f64,
        );
    anyhow::ensure!(
        store.train_trips.len() > 1000,
        "only {} train numbers indexed — the NS position feed would not join",
        store.train_trips.len()
    );
    anyhow::ensure!(
        candidates > store.train_trips.len(),
        "one candidate per number means duplicates were collapsed; day resolution needs them all"
    );
    anyhow::ensure!(resolved > 0, "no train number resolves to a trip running on {date}");
    // Every trip must carry its *own* realtime id: inverting the collapsed `trip_by_key`
    // instead is what silently stopped departure boards resolving live vehicles.
    let with_rt = store.trips.values().filter(|t| t.realtime_trip_id.is_some()).count();
    println!(
        "  trips with their own realtime_trip_id={with_rt}/{} (distinct ids={})",
        store.trips.len(),
        store.trip_by_key.len()
    );
    anyhow::ensure!(
        with_rt > store.trip_by_key.len(),
        "per-trip realtime ids ({with_rt}) should outnumber distinct ids ({}) — they share",
        store.trip_by_key.len()
    );

    println!("building stop indexes for {date} ...");
    let t = Instant::now();
    let idx = StopIndexes::build(store.clone(), date);
    println!(
        "built in {:.1}s; {} scheduled calls indexed ({:.1}% of all stop_times)",
        t.elapsed().as_secs_f64(),
        idx.call_count(),
        100.0 * idx.call_count() as f64 / stop_times.max(1) as f64
    );

    // Spot-check each index against a real place.
    let hits = idx.in_bbox(51.90, 4.44, 51.94, 4.52, 50);
    println!("  bbox around Rotterdam centre -> {} stops", hits.len());
    let found = idx.search("Rotterdam Centraal", 5);
    println!("  search 'Rotterdam Centraal' -> {} stops", found.len());
    for s in &found {
        println!("    {} {} ({:?})", s.stop_id, s.name, s.code);
    }
    anyhow::ensure!(!hits.is_empty() && !found.is_empty(), "stop indexes look empty");

    // A departure board at the busiest matched stop, over the whole day.
    if let Some(stop) = found.first() {
        let deps = idx.departures(&stop.stop_id, 0, 86_400, 10);
        println!("  departures at {} today -> {} shown", stop.name, deps.len());
        for d in deps.iter().take(5) {
            println!(
                "    {:>6}s line {:<5} -> {:<30} rt={:?}",
                d.scheduled_departure,
                d.route.map(|r| r.short_name.as_str()).unwrap_or("?"),
                d.trip.headsign,
                d.realtime_trip_id
            );
        }
    }

    println!("OK");
    Ok(())
}

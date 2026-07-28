//! End-to-end live proof of next-line prediction.
//!
//! Runs the real KV6 + KV78Turbo streams into the real `BlockStore`, then prints live
//! vehicles alongside their predicted next public line. This is exactly what the server
//! does; it just prints instead of serving.
//!
//! Run: `cargo run --example nextlinelive -p ovlive-realtime`  Env: SAMPLE_SECS (default 90).

use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use chrono::Utc;
use ovlive_core::BlockStore;
use ovlive_realtime::{run_journey_stream, run_stream, StreamConfig, StreamKind};
use tokio::sync::mpsc;

#[tokio::main]
async fn main() {
    let secs: u64 = std::env::var("SAMPLE_SECS").ok().and_then(|v| v.parse().ok()).unwrap_or(90);
    let idle = Duration::from_secs(60);

    let blocks = Arc::new(BlockStore::new());

    // KV78Turbo -> block index.
    let (j_tx, mut j_rx) = mpsc::channel(50_000);
    tokio::spawn(run_journey_stream(
        StreamConfig {
            name: "KV78Turbo".into(),
            endpoint: "tcp://pubsub.besteffort.ndovloket.nl:7817".into(),
            kind: StreamKind::Kv78Turbo,
            topics: vec!["/GOVI/KV8passtimes/".into()],
            idle_timeout: idle,
            max_fix_age: idle, // unused by the BISON kinds
        },
        j_tx,
    ));
    {
        let blocks = blocks.clone();
        tokio::spawn(async move {
            while let Some(u) = j_rx.recv().await {
                blocks.apply(u, Utc::now());
            }
        });
    }

    // KV6 -> latest (dataowner, line_planning, journey) per vehicle.
    let (ev_tx, mut ev_rx) = mpsc::channel(50_000);
    tokio::spawn(run_stream(
        StreamConfig {
            name: "KV6".into(),
            endpoint: "tcp://pubsub.besteffort.ndovloket.nl:7658".into(),
            kind: StreamKind::Kv6,
            topics: vec![],
            idle_timeout: idle,
            max_fix_age: idle, // unused by the BISON kinds
        },
        ev_tx,
    ));

    eprintln!("warming up {secs}s (building block index + tracking vehicles)...");
    let mut vehicles: HashMap<(String, String), (String, String)> = HashMap::new(); // (owner,veh)->(line,journey)
    let deadline = Instant::now() + Duration::from_secs(secs);
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            break;
        }
        match tokio::time::timeout(remaining.min(Duration::from_secs(5)), ev_rx.recv()).await {
            Ok(Some(ev)) => {
                if let (Some(line), Some(journey)) = (ev.line_planning_number.clone(), ev.journey_number.clone()) {
                    vehicles.insert((ev.key.dataowner.clone(), ev.key.vehicle_number.clone()), (line, journey));
                }
            }
            Ok(None) => break,
            Err(_) => {}
        }
    }

    // Predict for every tracked vehicle.
    let mut hits: Vec<String> = Vec::new();
    let mut with_block = 0usize;
    for ((owner, veh), (line, journey)) in &vehicles {
        if blocks.line_public(owner, line, journey).is_some() {
            with_block += 1;
        }
        // Empty live block code: resolve the block from the KV78 index, which is what the
        // server does (KV6 `blockcode` is ~0-2% filled and cleared mid-journey for RET).
        if let Some(next) = blocks.predict_next(owner, "", line, journey, Utc::now()) {
            let cur = blocks.line_public(owner, line, journey).unwrap_or_else(|| format!("({line})"));
            let dest = if next.destination.is_empty() { String::new() } else { format!(" → {}", next.destination) };
            hits.push(format!(
                "{owner}:{veh}  line {cur}  ⇒  NEXT line {}{}  (starts {})",
                next.line_public_number,
                dest,
                next.start.with_timezone(&chrono_tz::Europe::Amsterdam).format("%H:%M"),
            ));
        }
    }
    hits.sort();

    println!("\n================ NEXT-LINE PREDICTION (live) ================");
    println!("block index:      {} journeys", blocks.len());
    println!("KV6 vehicles:     {}", vehicles.len());
    println!("matched to KV78:  {}", with_block);
    println!("predictions made: {}\n", hits.len());
    for h in hits.iter().take(30) {
        println!("  {h}");
    }
    if hits.is_empty() {
        println!("  (none yet — try a longer SAMPLE_SECS; the next journey must already be in the KV78 horizon)");
    }
}

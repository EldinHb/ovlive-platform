//! OVLive server: wires GTFS ingestion, realtime ZMQ ingestion, the in-memory state
//! with its tick/prune/snapshot loop, and the HTTP + WebSocket API into one process.

mod config;

use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result};
use chrono::Utc;
use config::Config;
use dashmap::DashMap;
use ovlive_core::{BlockSnapshot, BlockStore, LiveState, LiveTrip, TrainDelaySnapshot, TrainDelays};
use ovlive_gtfs::{
    load_and_swap, refresh_once, seconds_until_next, FeedMeta, GtfsConfig, GtfsService, GtfsStore,
};
use ovlive_persist::{snapshot, Db};
use ovlive_realtime::{run_infoplus_stream, run_journey_stream, run_stream, StreamConfig, StreamKind};
use tokio::sync::{mpsc, watch};
use tracing::{error, info, warn};
use tracing_subscriber::EnvFilter;

const GTFS_SNAP: &str = "gtfs.snap";
const GTFS_META: &str = "gtfs_meta.bin";
const GTFS_ZIP: &str = "gtfs-nl.zip";
const RT_SNAP: &str = "realtime.snap";
const BLOCK_SNAP: &str = "blocks.snap";
const TRAIN_SNAP: &str = "train_delays.snap";

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info,ovlive=debug".into()))
        .init();

    let cfg = Config::from_env();
    info!("OVLive starting; data_dir={}", cfg.data_dir);
    std::fs::create_dir_all(&cfg.data_dir).ok();

    // --- Database + admin seed ---
    let db = Db::connect(&cfg.database_url).await.context("connect database")?;
    db.migrate().await.context("migrate database")?;
    db.seed_admin(&cfg.admin_email, &cfg.admin_password).await.ok();

    // --- GTFS: restore snapshot, else download once, then schedule daily refresh ---
    let gtfs = GtfsService::new();
    let gtfs_cfg = GtfsConfig {
        url: cfg.gtfs_url.clone(),
        user_agent: cfg.gtfs_user_agent.clone(),
        refresh_hour: cfg.gtfs_refresh_hour,
        timezone: cfg.gtfs_tz,
    };
    let data_dir = cfg.data_dir.clone();
    bootstrap_gtfs(&gtfs, &gtfs_cfg, &data_dir).await;
    rebuild_stop_indexes(&gtfs, cfg.gtfs_tz).await;
    spawn_gtfs_refresh(gtfs.clone(), gtfs_cfg, data_dir.clone(), cfg.gtfs_tz);
    spawn_stop_index_refresh(gtfs.clone(), cfg.gtfs_tz);

    // --- Train punctuality (NS InfoPlus RitInfo) ---
    // Built before `LiveState` because train positions consult it on every update. Restored
    // from disk so a restart doesn't re-enter the cold window where delays are unknown.
    let train_delays = Arc::new(TrainDelays::new());
    if cfg.zmq_ns_enabled && cfg.zmq_ns_rit_enabled {
        if let Ok(Some(snap)) =
            snapshot::load::<TrainDelaySnapshot>(&snapshot::path_in(&data_dir, TRAIN_SNAP))
        {
            train_delays.restore(snap);
            let cutoff = Utc::now() - chrono::Duration::seconds(cfg.train_delay_prune_secs);
            let pruned = train_delays.prune(cutoff);
            info!(
                "restored {} train delay curves ({} pruned as stale)",
                train_delays.len(),
                pruned
            );
        }
    }

    // --- Live state: restore realtime snapshot ---
    let live = Arc::new(LiveState::new(cfg.stale_trip_secs).with_train_delays(train_delays.clone()));
    if let Ok(Some(trips)) = snapshot::load::<Vec<LiveTrip>>(&snapshot::path_in(&data_dir, RT_SNAP)) {
        let n = trips.len();
        live.load(trips);
        let pruned = live.prune_stale(Utc::now());
        info!("restored {} live trips ({} pruned as stale)", n, pruned.len());
    }

    // --- Ingestion: ZMQ streams -> applier ---
    // Both position feeds normalize to `PosEvent` and share one applier: KV6 for road/rail
    // transit, NS InfoPlus for trains (which KV6 doesn't carry).
    let (ev_tx, mut ev_rx) = mpsc::channel(50_000);
    tokio::spawn(run_stream(
        StreamConfig {
            name: "KV6".into(),
            endpoint: cfg.zmq_kv6_endpoint.clone(),
            kind: StreamKind::Kv6,
            topics: cfg.zmq_kv6_topics.clone(),
            idle_timeout: Duration::from_secs(cfg.zmq_idle_timeout_secs),
            max_fix_age: Duration::from_secs(cfg.ns_max_fix_age_secs),
        },
        ev_tx.clone(),
    ));
    if cfg.zmq_ns_enabled {
        // One connection, both envelopes: positions to the applier, RitInfo to the delay store.
        let (rit_tx, mut rit_rx) = mpsc::channel(10_000);
        tokio::spawn(run_infoplus_stream(
            StreamConfig {
                name: "NS InfoPlus".into(),
                endpoint: cfg.zmq_ns_endpoint.clone(),
                kind: StreamKind::NsTreinposities,
                topics: cfg.zmq_ns_topics.clone(),
                idle_timeout: Duration::from_secs(cfg.zmq_idle_timeout_secs),
                max_fix_age: Duration::from_secs(cfg.ns_max_fix_age_secs),
            },
            ev_tx.clone(),
            cfg.zmq_ns_rit_enabled.then(|| rit_tx.clone()),
        ));
        if cfg.zmq_ns_rit_enabled {
            let delays = train_delays.clone();
            tokio::spawn(async move {
                while let Some(u) = rit_rx.recv().await {
                    delays.apply(u, Utc::now());
                }
            });
            spawn_train_delay_upkeep(train_delays.clone(), cfg.train_delay_prune_secs, data_dir.clone());
        } else {
            info!("NS RitInfo disabled; train punctuality will be reported as unknown");
        }
    } else {
        info!("NS train positions disabled; trains will not appear");
    }
    {
        let live = live.clone();
        let gtfs = gtfs.clone();
        tokio::spawn(async move {
            while let Some(ev) = ev_rx.recv().await {
                live.apply(ev, gtfs.as_ref());
            }
        });
    }

    // --- KV78Turbo ingestion -> block index (next-line prediction) ---
    let blocks = Arc::new(BlockStore::new());
    if cfg.zmq_kv78_enabled {
        // Restore the block index so predictions work immediately (before the feed refills).
        if let Ok(Some(snap)) = snapshot::load::<BlockSnapshot>(&snapshot::path_in(&data_dir, BLOCK_SNAP)) {
            blocks.restore(snap);
            let cutoff = Utc::now() - chrono::Duration::seconds(cfg.block_prune_secs);
            let pruned = blocks.prune(cutoff);
            info!("restored block index: {} journeys ({} pruned as stale)", blocks.len(), pruned);
        }

        let (j_tx, mut j_rx) = mpsc::channel(50_000);
        tokio::spawn(run_journey_stream(
            StreamConfig {
                name: "KV78Turbo".into(),
                endpoint: cfg.zmq_kv78_endpoint.clone(),
                kind: StreamKind::Kv78Turbo,
                topics: cfg.zmq_kv78_topics.clone(),
                idle_timeout: Duration::from_secs(cfg.zmq_idle_timeout_secs),
                max_fix_age: Duration::from_secs(cfg.ns_max_fix_age_secs),
            },
            j_tx,
        ));
        let blocks_ing = blocks.clone();
        tokio::spawn(async move {
            while let Some(u) = j_rx.recv().await {
                blocks_ing.apply(u, Utc::now());
            }
        });
        // Prune journeys that have rolled off the KV78Turbo horizon, then snapshot the index.
        let blocks_prune = blocks.clone();
        let prune_secs = cfg.block_prune_secs;
        let block_dir = data_dir.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(60));
            loop {
                interval.tick().await;
                let cutoff = Utc::now() - chrono::Duration::seconds(prune_secs);
                let removed = blocks_prune.prune(cutoff);
                if removed > 0 {
                    tracing::debug!("pruned {} stale journeys ({} left)", removed, blocks_prune.len());
                }
                let path = snapshot::path_in(&block_dir, BLOCK_SNAP);
                let snap = blocks_prune.snapshot();
                match tokio::task::spawn_blocking(move || snapshot::save(&path, &snap)).await {
                    Ok(Ok(())) => tracing::debug!("block index: {} journeys snapshotted", blocks_prune.len()),
                    Ok(Err(e)) => warn!("block snapshot save failed: {e}"),
                    Err(e) => warn!("block snapshot task panicked: {e}"),
                }
            }
        });
    } else {
        info!("KV78Turbo disabled; next-line prediction unavailable");
    }

    // --- Tick loop: publish spatial index, prune stale, snapshot realtime ---
    let (index_tx, index_rx) = watch::channel(live.build_index());
    spawn_tick_loop(live.clone(), index_tx, &cfg, data_dir.clone());

    // --- HTTP + WS ---
    let state = ovlive_api::AppState {
        live: live.clone(),
        gtfs: gtfs.clone(),
        blocks: blocks.clone(),
        db,
        index_rx,
        limiters: Arc::new(DashMap::new()),
        public_limiter: ovlive_api::direct_limiter(cfg.public_rate_per_min),
        tick_hz: cfg.ws_tick_hz,
        tz: cfg.gtfs_tz,
        legacy: ovlive_api::LegacyLimits {
            max_viewport_area: cfg.max_viewport_area,
            max_spatial_results: cfg.max_spatial_results,
            max_stops_results: cfg.max_stops_results,
        },
    };
    let app = ovlive_api::router(state);

    let listener = tokio::net::TcpListener::bind(&cfg.bind_addr)
        .await
        .with_context(|| format!("bind {}", cfg.bind_addr))?;
    info!("listening on http://{} (docs at /docs)", cfg.bind_addr);
    axum::serve(listener, app).await.context("serve")?;
    Ok(())
}

/// Bring up GTFS with the least remote traffic possible:
/// 1. parsed snapshot on disk  → use it (fastest, no parse, no download);
/// 2. cached `gtfs-nl.zip`      → re-parse locally (no download);
/// 3. otherwise                 → conditional download (and cache the zip).
async fn bootstrap_gtfs(gtfs: &GtfsService, cfg: &GtfsConfig, data_dir: &str) {
    // 1. Parsed snapshot.
    match snapshot::load::<GtfsStore>(&snapshot::path_in(data_dir, GTFS_SNAP)) {
        Ok(Some(store)) => {
            gtfs.swap(store);
            info!("restored GTFS from parsed snapshot (no download)");
            return;
        }
        Ok(None) => {}
        Err(e) => warn!("unreadable GTFS snapshot ({e}); trying cached zip"),
    }

    // 2. Cached raw zip — re-parse without hitting the remote.
    let zip_path = snapshot::path_in(data_dir, GTFS_ZIP);
    if zip_path.exists() {
        info!("parsing cached {} (no download)", zip_path.display());
        match load_and_swap(gtfs, &zip_path).await {
            Ok(store) => {
                let _ = snapshot::save(&snapshot::path_in(data_dir, GTFS_SNAP), store.as_ref());
                return;
            }
            Err(e) => warn!("cached zip unparseable ({e}); will download"),
        }
    }

    // 3. Download once (conditionally), caching the zip.
    info!("no local GTFS; downloading once at startup");
    let meta: FeedMeta = snapshot::load(&snapshot::path_in(data_dir, GTFS_META))
        .ok()
        .flatten()
        .unwrap_or_default();
    if let Err(e) = do_refresh(gtfs, cfg, &meta, data_dir).await {
        error!("initial GTFS download failed: {e}");
    }
}

fn spawn_gtfs_refresh(gtfs: Arc<GtfsService>, cfg: GtfsConfig, data_dir: String, tz: chrono_tz::Tz) {
    tokio::spawn(async move {
        loop {
            let secs = seconds_until_next(cfg.refresh_hour, cfg.timezone);
            info!("next GTFS check in {}h{:02}m", secs / 3600, (secs % 3600) / 60);
            tokio::time::sleep(Duration::from_secs(secs)).await;
            let meta: FeedMeta = snapshot::load(&snapshot::path_in(&data_dir, GTFS_META))
                .ok()
                .flatten()
                .unwrap_or_default();
            match do_refresh(&gtfs, &cfg, &meta, &data_dir).await {
                // A new feed invalidates the stop indexes built from the old one.
                Ok(true) => rebuild_stop_indexes(&gtfs, tz).await,
                Ok(false) => {}
                Err(e) => warn!("scheduled GTFS refresh failed: {e}"),
            }
        }
    });
}

/// Rebuild the day-scoped stop indexes for today. CPU-heavy (walks every trip in the feed),
/// so it runs on the blocking pool; called on boot, after a feed swap, and each local midnight.
///
/// Only the deprecated `/v1/stops/*` endpoints read these — remove with them.
async fn rebuild_stop_indexes(gtfs: &Arc<GtfsService>, tz: chrono_tz::Tz) {
    let svc = gtfs.clone();
    let date = ovlive_gtfs::service_date(Utc::now(), tz);
    if let Err(e) = tokio::task::spawn_blocking(move || svc.rebuild_stop_indexes(date)).await {
        warn!("stop index build failed: {e}");
    }
}

/// Re-anchor the stop departure boards just after each local midnight, when "today" changes.
fn spawn_stop_index_refresh(gtfs: Arc<GtfsService>, tz: chrono_tz::Tz) {
    tokio::spawn(async move {
        loop {
            // A minute past midnight, so the local date has definitely rolled over.
            let secs = seconds_until_next(0, tz) + 60;
            tokio::time::sleep(Duration::from_secs(secs)).await;
            rebuild_stop_indexes(&gtfs, tz).await;
        }
    });
}

/// Conditionally download to the cached zip + parse; on a fresh feed, persist the
/// parsed snapshot + validators. Returns whether a new feed was actually swapped in.
async fn do_refresh(
    gtfs: &GtfsService,
    cfg: &GtfsConfig,
    meta: &FeedMeta,
    data_dir: &str,
) -> Result<bool> {
    let zip_path = snapshot::path_in(data_dir, GTFS_ZIP);
    if let Some((new_meta, store)) = refresh_once(gtfs, cfg, meta, &zip_path).await? {
        snapshot::save(&snapshot::path_in(data_dir, GTFS_SNAP), store.as_ref())
            .context("save gtfs snapshot")?;
        snapshot::save(&snapshot::path_in(data_dir, GTFS_META), &new_meta)
            .context("save gtfs meta")?;
        return Ok(true);
    }
    Ok(false)
}

/// Prune stale delay curves and snapshot the store, so a restart keeps train punctuality.
fn spawn_train_delay_upkeep(delays: Arc<TrainDelays>, prune_secs: i64, data_dir: String) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(120));
        loop {
            interval.tick().await;
            let removed = delays.prune(Utc::now() - chrono::Duration::seconds(prune_secs));
            if removed > 0 {
                tracing::debug!("pruned {} stale train delay curves ({} left)", removed, delays.len());
            }
            let path = snapshot::path_in(&data_dir, TRAIN_SNAP);
            let snap = delays.snapshot();
            match tokio::task::spawn_blocking(move || snapshot::save(&path, &snap)).await {
                Ok(Ok(())) => tracing::debug!("{} train delay curves snapshotted", delays.len()),
                Ok(Err(e)) => warn!("train delay snapshot save failed: {e}"),
                Err(e) => warn!("train delay snapshot task panicked: {e}"),
            }
        }
    });
}

fn spawn_tick_loop(
    live: Arc<LiveState>,
    index_tx: watch::Sender<Arc<ovlive_core::VehicleIndex>>,
    cfg: &Config,
    data_dir: String,
) {
    let tick_hz = cfg.ws_tick_hz.max(1);
    let period = Duration::from_millis((1000 / tick_hz) as u64);
    let sweep_every = (cfg.sweep_interval_secs * tick_hz as u64).max(1);
    let snap_every = (cfg.snapshot_interval_secs * tick_hz as u64).max(1);

    tokio::spawn(async move {
        let mut ticks: u64 = 0;
        let mut interval = tokio::time::interval(period);
        loop {
            interval.tick().await;
            ticks += 1;

            if ticks.is_multiple_of(sweep_every) {
                let removed = live.prune_stale(Utc::now());
                if !removed.is_empty() {
                    tracing::debug!("pruned {} stale trips", removed.len());
                }
            }

            // Republish the spatial snapshot for WS/REST consumers.
            let _ = index_tx.send(live.build_index());

            if ticks.is_multiple_of(snap_every) {
                let trips: Vec<LiveTrip> = live.all_trips();
                let path = snapshot::path_in(&data_dir, RT_SNAP);
                if let Err(e) = tokio::task::spawn_blocking(move || snapshot::save(&path, &trips)).await {
                    warn!("realtime snapshot task failed: {e}");
                }
            }
        }
    });
}

//! Shared application state handed to every handler.

use std::num::NonZeroU32;
use std::sync::Arc;

use chrono_tz::Tz;
use dashmap::DashMap;
use governor::{DefaultDirectRateLimiter, Quota, RateLimiter};
use ovlive_core::{BlockStore, LiveState, VehicleIndex};
use ovlive_gtfs::GtfsService;
use ovlive_persist::Db;
use tokio::sync::watch;
use uuid::Uuid;

#[derive(Clone)]
pub struct AppState {
    /// Authoritative in-memory live-trip set (written by ingestion).
    pub live: Arc<LiveState>,
    /// Currently loaded GTFS feed (for enrichment + detail lookups).
    pub gtfs: Arc<GtfsService>,
    /// Live block index (KV78Turbo) for next-line prediction.
    pub blocks: Arc<BlockStore>,
    /// Accounts + API keys.
    pub db: Db,
    /// Latest spatial snapshot, republished each server tick.
    pub index_rx: watch::Receiver<Arc<VehicleIndex>>,
    /// Per-API-key rate limiters, created lazily.
    pub limiters: Arc<DashMap<Uuid, Arc<DefaultDirectRateLimiter>>>,
    /// Shared limiter guarding anonymous (keyless) access to the public data endpoints,
    /// which is how the official web app connects. Bounds abuse without per-user auth.
    pub public_limiter: Arc<DefaultDirectRateLimiter>,
    /// WS diff tick rate (Hz).
    pub tick_hz: u32,
    /// Local timezone for service dates and schedule times (Europe/Amsterdam).
    pub tz: Tz,
    /// Limits for the deprecated compatibility endpoints; remove with them.
    pub legacy: LegacyLimits,
}

/// The pre-Rust API's viewport/result caps, kept so the compatibility endpoints reject and
/// truncate identically. Defaults match its `MAX_VIEWPORT_AREA` / `MAX_SPATIAL_RESULTS` /
/// `MAX_STOPS_RESULTS`.
#[derive(Clone, Copy, Debug)]
pub struct LegacyLimits {
    /// Max viewport area in square degrees; larger requests are rejected. 0 disables.
    pub max_viewport_area: f64,
    pub max_spatial_results: usize,
    pub max_stops_results: usize,
}

impl Default for LegacyLimits {
    fn default() -> Self {
        Self {
            max_viewport_area: 2.0,
            max_spatial_results: 1500,
            max_stops_results: 500,
        }
    }
}

impl AppState {
    pub fn latest_index(&self) -> Arc<VehicleIndex> {
        self.index_rx.borrow().clone()
    }
}

/// Build a standalone per-minute rate limiter (used for the shared public limiter).
pub fn direct_limiter(per_min: u32) -> Arc<DefaultDirectRateLimiter> {
    let n = NonZeroU32::new(per_min.max(1)).unwrap();
    Arc::new(RateLimiter::direct(Quota::per_minute(n)))
}

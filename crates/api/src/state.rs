//! Shared application state handed to every handler.

use std::net::IpAddr;
use std::num::NonZeroU32;
use std::sync::Arc;

use chrono_tz::Tz;
use dashmap::DashMap;
use governor::{DefaultDirectRateLimiter, DefaultKeyedRateLimiter, Quota, RateLimiter};
use ovlive_core::{LiveState, VehicleIndex};
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
    /// Accounts + API keys.
    pub db: Db,
    /// Latest spatial snapshot, republished each server tick.
    pub index_rx: watch::Receiver<Arc<VehicleIndex>>,
    /// Layered request limits: per client IP, per account, per key.
    pub limits: RateLimits,
    /// WS diff tick rate (Hz).
    pub tick_hz: u32,
    /// Local timezone for service dates and schedule times (Europe/Amsterdam).
    pub tz: Tz,
    /// Limits for the deprecated compatibility endpoints; remove with them.
    pub legacy: LegacyLimits,
}

/// Request limits, applied outermost-first: every request is bounded per **client IP**, an
/// authenticated one additionally per **account** and then per **key**.
///
/// The per-IP tier replaced a single process-wide bucket for anonymous traffic. That bucket was
/// shared by every visitor of the web app at once, so one scraper spent the whole allowance and
/// everybody else got 429s — and behind a reverse proxy or Cloudflare Tunnel there is no
/// per-visitor accounting at all unless the real client IP is recovered from the proxy headers
/// (see `client_ip` in `auth.rs`). It is therefore set *far* higher than the account tier:
/// ordinary use of the map (a viewport fetch, stop layers, departure boards, a detail poll every
/// 8 s) must never come close, while a runaway client is still bounded.
#[derive(Clone)]
pub struct RateLimits {
    /// Per client IP, for every request. The coarse outer bound.
    pub per_ip: Arc<DefaultKeyedRateLimiter<IpAddr>>,
    /// Per account, across all of that account's keys — so minting a second key doesn't
    /// multiply a consumer's allowance.
    pub per_user: Arc<DefaultKeyedRateLimiter<Uuid>>,
    /// Per API key, using each key's own `rate_per_min` from the database. Created lazily,
    /// which is why this is a map of direct limiters rather than one keyed limiter: the quota
    /// differs per key.
    pub per_key: Arc<DashMap<Uuid, Arc<DefaultDirectRateLimiter>>>,
}

impl RateLimits {
    pub fn new(ip_per_min: u32, user_per_min: u32) -> Self {
        Self {
            per_ip: Arc::new(RateLimiter::keyed(Quota::per_minute(nonzero(ip_per_min)))),
            per_user: Arc::new(RateLimiter::keyed(Quota::per_minute(nonzero(user_per_min)))),
            per_key: Arc::new(DashMap::new()),
        }
    }

    /// Drop buckets that are back to full, so the keyed maps don't grow once per IP seen.
    /// Call periodically — an unbounded map keyed on remote input is a memory leak.
    pub fn gc(&self) {
        self.per_ip.retain_recent();
        self.per_user.retain_recent();
    }
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

fn nonzero(per_min: u32) -> NonZeroU32 {
    NonZeroU32::new(per_min.max(1)).unwrap()
}

/// Build a standalone per-minute rate limiter (one API key's own quota).
pub fn direct_limiter(per_min: u32) -> Arc<DefaultDirectRateLimiter> {
    Arc::new(RateLimiter::direct(Quota::per_minute(nonzero(per_min))))
}

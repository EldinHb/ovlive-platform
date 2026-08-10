//! GTFS ingestion: conditional download, parse into an in-memory store, hot-swap the
//! live feed, and enrich realtime trips. See CLAUDE.md for the (strict) download policy.

mod download;
mod model;
mod parse;
mod stops;

use std::path::Path;
use std::sync::Arc;

use anyhow::Result;
use arc_swap::ArcSwapOption;
use chrono::{DateTime, Datelike, NaiveDate, TimeZone, Timelike, Utc};
use chrono_tz::Tz;
use ovlive_core::{Enricher, LiveTrip};
use tracing::info;

pub use download::{conditional_download_to, DownloadOutcome, FeedMeta};
pub use model::{GtfsStore, RouteInfo, StopInfo, TripInfo, TripStop};
pub use parse::{parse_zip, parse_zip_file};
pub use stops::{Departure, StopIndexes};

/// Deliberately has no `Default`. `user_agent` must identify the specific deployment doing the
/// fetching, and a derived default would hand every caller a plausible-looking one — either an
/// empty string, which is worse than no header, or whatever address was last hardcoded here,
/// which routes operator complaints to the wrong person. Callers construct it explicitly from
/// their own config; the server sources `user_agent` from a required env var.
#[derive(Debug, Clone)]
pub struct GtfsConfig {
    pub url: String,
    pub user_agent: String,
    /// Local hour of day to check for a new feed (default 3 = 03:00).
    pub refresh_hour: u32,
    pub timezone: Tz,
}

/// Holds the currently-loaded feed and enriches live trips against it.
#[derive(Default)]
pub struct GtfsService {
    store: ArcSwapOption<GtfsStore>,
    /// Stop indexes: the (day-independent) viewport grid behind `/v1/stops/viewport`, plus the
    /// day-scoped departure board for the deprecated `/v1/stops/*` endpoints. Rebuilt on every
    /// feed swap and at local midnight; `None` until the first build finishes.
    stops: ArcSwapOption<StopIndexes>,
}

impl GtfsService {
    pub fn new() -> Arc<Self> {
        Arc::new(Self::default())
    }

    pub fn current(&self) -> Option<Arc<GtfsStore>> {
        self.store.load_full()
    }

    pub fn is_loaded(&self) -> bool {
        self.store.load().is_some()
    }

    /// The current stop indexes, if built. Each one owns the feed it was built from, so
    /// callers never see an index/feed mismatch.
    pub fn stop_indexes(&self) -> Option<Arc<StopIndexes>> {
        self.stops.load_full()
    }

    pub fn swap(&self, store: GtfsStore) {
        let counts = format!(
            "routes={} trips={} stops={} shapes={} joins={} services={}",
            store.routes.len(),
            store.trips.len(),
            store.stops.len(),
            store.shapes.len(),
            store.trip_by_key.len(),
            store.service_dates.len()
        );
        self.store.store(Some(Arc::new(store)));
        info!(target: "ovlive::gtfs", "GTFS feed loaded ({counts})");
    }

    /// (Re)build the stop indexes for `date` against the loaded feed. No-op with no feed.
    /// Blocking and CPU-heavy (it walks every trip), so callers should use
    /// `spawn_blocking`; it runs at most a few times a day.
    pub fn rebuild_stop_indexes(&self, date: NaiveDate) {
        let Some(store) = self.store.load_full() else {
            return;
        };
        let idx = StopIndexes::build(store, date);
        info!(
            target: "ovlive::gtfs",
            "stop indexes built for {date} ({} scheduled calls indexed)",
            idx.call_count()
        );
        self.stops.store(Some(Arc::new(idx)));
    }
}

/// Today's service date in `tz` — the day a departure board is anchored to.
pub fn service_date(now: DateTime<Utc>, tz: Tz) -> NaiveDate {
    now.with_timezone(&tz).date_naive()
}

/// Seconds since local midnight of `now` in `tz`. The axis every scheduled time in
/// [`StopIndexes::departures`] is expressed on.
pub fn secs_since_local_midnight(now: DateTime<Utc>, tz: Tz) -> i32 {
    let local = now.with_timezone(&tz);
    (local.hour() * 3600 + local.minute() * 60 + local.second()) as i32
}

/// The UTC instant of local midnight on `date` in `tz` — the epoch that turns a
/// seconds-since-midnight schedule value into an absolute timestamp.
///
/// On a DST spring-forward day midnight itself is never ambiguous in Europe/Amsterdam (the
/// transition is at 02:00), but we still fall back to the later of two mappings rather than
/// failing, so a schedule can always be rendered.
pub fn local_midnight_utc(date: NaiveDate, tz: Tz) -> Option<DateTime<Utc>> {
    let naive = date.and_hms_opt(0, 0, 0)?;
    let local = tz
        .from_local_datetime(&naive)
        .single()
        .or_else(|| tz.from_local_datetime(&naive).latest())?;
    Some(local.with_timezone(&Utc))
}

impl Enricher for GtfsService {
    fn enrich(&self, trip: &mut LiveTrip) {
        if let Some(store) = self.store.load_full() {
            store.enrich(trip);
        }
    }

    fn scheduled_position(&self, trip: &LiveTrip) -> Option<(f64, f64)> {
        self.store.load_full()?.scheduled_position(trip)
    }
}

/// Conditionally download to the cached `zip_path`, parse, and swap in the new feed.
/// Returns the new [`FeedMeta`] + store if a fresh feed was fetched, or `None` on `304`.
/// The downloaded archive is kept at `zip_path` for local re-parsing (policy: never
/// re-download just to re-parse).
pub async fn refresh_once(
    service: &GtfsService,
    cfg: &GtfsConfig,
    prev: &FeedMeta,
    zip_path: &Path,
) -> Result<Option<(FeedMeta, Arc<GtfsStore>)>> {
    match conditional_download_to(&cfg.url, &cfg.user_agent, prev, zip_path).await? {
        DownloadOutcome::NotModified => {
            info!(target: "ovlive::gtfs", "GTFS unchanged (304)");
            Ok(None)
        }
        DownloadOutcome::Fetched { meta } => {
            info!(target: "ovlive::gtfs", "GTFS fetched; parsing {}", zip_path.display());
            let store = load_and_swap(service, zip_path).await?;
            Ok(Some((meta, store)))
        }
    }
}

/// Parse a cached zip off the async runtime and swap it in as the live feed.
pub async fn load_and_swap(service: &GtfsService, zip_path: &Path) -> Result<Arc<GtfsStore>> {
    let path = zip_path.to_path_buf();
    let store = tokio::task::spawn_blocking(move || parse_zip_file(&path)).await??;
    let arc = Arc::new(store);
    service.store.store(Some(arc.clone()));
    info!(
        target: "ovlive::gtfs",
        "GTFS feed loaded (routes={} trips={} stops={} joins={})",
        arc.routes.len(), arc.trips.len(), arc.stops.len(), arc.trip_by_key.len()
    );
    Ok(arc)
}

/// Seconds from `now` until the next occurrence of `hour:00` in `tz`.
pub fn seconds_until_next(hour: u32, tz: Tz) -> u64 {
    let now = Utc::now().with_timezone(&tz);
    let mut target = tz
        .with_ymd_and_hms(now.year(), now.month(), now.day(), hour, 0, 0)
        .single()
        .unwrap_or(now);
    if target <= now {
        target += chrono::Duration::days(1);
    }
    (target - now).num_seconds().max(0) as u64
}

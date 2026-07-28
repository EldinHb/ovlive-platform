//! Environment-driven configuration.

use std::str::FromStr;

use chrono_tz::Tz;

pub struct Config {
    pub bind_addr: String,
    pub database_url: String,
    pub data_dir: String,

    pub gtfs_url: String,
    pub gtfs_user_agent: String,
    pub gtfs_refresh_hour: u32,
    pub gtfs_tz: Tz,

    pub zmq_kv6_endpoint: String,
    pub zmq_kv6_topics: Vec<String>,
    /// KV78Turbo feed (`KV8passtimes`) — powers next-line prediction. Disable with
    /// `ZMQ_KV78_ENABLED=false` to skip the extra SUB connection + parsing.
    pub zmq_kv78_enabled: bool,
    pub zmq_kv78_endpoint: String,
    pub zmq_kv78_topics: Vec<String>,
    /// Drop journeys from the block index not seen within this window (seconds). KV78Turbo
    /// only publishes a near-future horizon, so this bounds memory.
    pub block_prune_secs: i64,
    /// Reconnect the realtime SUB socket if no frame arrives within this many seconds
    /// (watchdog for silently-dead connections). See `StreamConfig::idle_timeout`.
    pub zmq_idle_timeout_secs: u64,

    pub stale_trip_secs: i64,
    pub sweep_interval_secs: u64,
    pub snapshot_interval_secs: u64,
    pub ws_tick_hz: u32,
    /// Requests/minute allowed for anonymous (keyless) public access, shared across all
    /// such clients — the official web app path. Generous by default; a global abuse guard.
    pub public_rate_per_min: u32,

    pub admin_email: String,
    pub admin_password: String,

    /// Caps for the deprecated compatibility endpoints, matching the pre-Rust API's env vars
    /// so existing deployments keep their tuning. Remove with those endpoints.
    pub max_viewport_area: f64,
    pub max_spatial_results: usize,
    pub max_stops_results: usize,
}

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

fn env_parse<T: FromStr>(key: &str, default: T) -> T {
    std::env::var(key).ok().and_then(|v| v.parse().ok()).unwrap_or(default)
}

impl Config {
    pub fn from_env() -> Self {
        let topics = env_or("ZMQ_KV6_TOPICS", "");
        let kv78_topics = env_or("ZMQ_KV78_TOPICS", "/GOVI/KV8passtimes/");
        Config {
            bind_addr: env_or("BIND_ADDR", "0.0.0.0:8080"),
            database_url: env_or("DATABASE_URL", "postgres://ovlive:ovlive@localhost:5432/ovlive"),
            data_dir: env_or("DATA_DIR", "./data"),

            gtfs_url: env_or("GTFS_URL", "https://gtfs.ovapi.nl/gtfs-nl.zip"),
            gtfs_user_agent: env_or("GTFS_USER_AGENT", "OVLive/0.1 (+contact: change-me@example.com)"),
            gtfs_refresh_hour: env_parse("GTFS_REFRESH_HOUR", 3),
            gtfs_tz: env_or("GTFS_REFRESH_TZ", "Europe/Amsterdam")
                .parse()
                .unwrap_or(chrono_tz::Europe::Amsterdam),

            zmq_kv6_endpoint: env_or("ZMQ_KV6_ENDPOINT", "tcp://pubsub.besteffort.ndovloket.nl:7658"),
            zmq_kv6_topics: topics
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect(),
            zmq_kv78_enabled: env_parse("ZMQ_KV78_ENABLED", true),
            zmq_kv78_endpoint: env_or("ZMQ_KV78_ENDPOINT", "tcp://pubsub.besteffort.ndovloket.nl:7817"),
            zmq_kv78_topics: kv78_topics
                .split(',')
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
                .collect(),
            block_prune_secs: env_parse("BLOCK_PRUNE_SECS", 1800),
            zmq_idle_timeout_secs: env_parse("ZMQ_IDLE_TIMEOUT_SECS", 60),

            stale_trip_secs: env_parse("STALE_TRIP_SECS", 240),
            sweep_interval_secs: env_parse("SWEEP_INTERVAL_SECS", 30),
            snapshot_interval_secs: env_parse("SNAPSHOT_INTERVAL_SECS", 20),
            ws_tick_hz: env_parse("WS_TICK_HZ", 3),
            public_rate_per_min: env_parse("PUBLIC_RATE_PER_MIN", 6000),

            admin_email: env_or("ADMIN_EMAIL", "admin@example.com"),
            admin_password: env_or("ADMIN_PASSWORD", "change-me-please"),

            max_viewport_area: env_parse("MAX_VIEWPORT_AREA", 2.0),
            max_spatial_results: env_parse("MAX_SPATIAL_RESULTS", 1500),
            max_stops_results: env_parse("MAX_STOPS_RESULTS", 500),
        }
    }
}

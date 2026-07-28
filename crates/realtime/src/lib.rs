//! Realtime ingestion from the NDOV best-effort ZMQ feeds.
//!
//! One SUB connection per datastream (fair-use policy). Each message is multipart:
//! frame 0 is the topic envelope, the remaining frames concatenate to gzip-compressed
//! XML. We decompress, decode (KV6 for now), and forward normalized [`PosEvent`]s over
//! an mpsc channel to the state applier in `ovlive-server`.

mod kv6;
mod kv78;

use std::io::Read;
use std::time::Duration;

use flate2::read::GzDecoder;
use ovlive_core::{JourneyUpdate, PosEvent};
use tokio::sync::mpsc::Sender;
use tracing::{debug, info, warn};
use zeromq::{Socket, SocketRecv, SubSocket};

pub use kv6::parse_kv6;
pub use kv78::parse_kv78;

/// Which BISON envelope a stream carries. Only KV6 (vehicle positions) is decoded today.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StreamKind {
    Kv6,
    Kv78Turbo,
}

#[derive(Debug, Clone)]
pub struct StreamConfig {
    pub name: String,
    pub endpoint: String,
    pub kind: StreamKind,
    /// Envelope prefixes to subscribe to. Empty = subscribe to everything.
    pub topics: Vec<String>,
    /// Watchdog: if no frame (not even a heartbeat) arrives within this window, treat the
    /// SUB socket as silently dead and reconnect. The pure-Rust `zeromq` `recv()` never
    /// errors on a half-open connection, so without this a stalled feed would hang forever.
    pub idle_timeout: Duration,
}

fn gunzip(payload: &[u8]) -> Option<String> {
    let mut d = GzDecoder::new(payload);
    let mut s = String::new();
    match d.read_to_string(&mut s) {
        Ok(_) => Some(s),
        Err(e) => {
            debug!(target: "ovlive::rt", "gunzip failed: {e}");
            None
        }
    }
}

fn decode(kind: StreamKind, payload: &[u8]) -> Vec<PosEvent> {
    match kind {
        StreamKind::Kv6 => gunzip(payload).map(|xml| parse_kv6(&xml)).unwrap_or_default(),
        // KV78Turbo (KV8 journey updates) is not decoded in v1 — positions come from KV6.
        StreamKind::Kv78Turbo => Vec::new(),
    }
}

/// Run one stream forever, reconnecting with capped backoff. Returns only if `tx` closes.
pub async fn run_stream(cfg: StreamConfig, tx: Sender<PosEvent>) {
    let mut backoff = Duration::from_secs(1);
    loop {
        match connect_and_pump(&cfg, &tx).await {
            Ok(()) => {
                // tx closed → shutdown requested.
                info!(target: "ovlive::rt", stream = %cfg.name, "stream consumer closed; stopping");
                return;
            }
            Err(e) => {
                warn!(target: "ovlive::rt", stream = %cfg.name, "stream error: {e}; reconnecting in {:?}", backoff);
                tokio::time::sleep(backoff).await;
                backoff = (backoff * 2).min(Duration::from_secs(30));
            }
        }
    }
}

async fn connect_and_pump(cfg: &StreamConfig, tx: &Sender<PosEvent>) -> anyhow::Result<()> {
    let mut socket = SubSocket::new();
    socket.connect(&cfg.endpoint).await?;
    if cfg.topics.is_empty() {
        socket.subscribe("").await?;
    } else {
        for t in &cfg.topics {
            socket.subscribe(t).await?;
        }
    }
    info!(target: "ovlive::rt", stream = %cfg.name, endpoint = %cfg.endpoint, "subscribed");

    let mut msgs: u64 = 0;
    loop {
        // Any frame — a real message OR a topic-only heartbeat — proves the socket is
        // still live and resets the window. Only true silence trips the watchdog.
        let msg = match tokio::time::timeout(cfg.idle_timeout, socket.recv()).await {
            Ok(res) => res?,
            Err(_) => anyhow::bail!(
                "no data for {:?}; assuming dead socket",
                cfg.idle_timeout
            ),
        };
        let frames = msg.into_vec();
        if frames.len() < 2 {
            continue; // topic-only / heartbeat
        }
        // Concatenate all frames after the envelope, then decompress+decode.
        let payload: Vec<u8> = frames[1..].iter().flat_map(|b| b.iter().copied()).collect();
        for ev in decode(cfg.kind, &payload) {
            if tx.send(ev).await.is_err() {
                return Ok(()); // consumer gone
            }
        }
        msgs += 1;
        if msgs.is_multiple_of(5000) {
            debug!(target: "ovlive::rt", stream = %cfg.name, "processed {msgs} messages");
        }
    }
}

/// Run the KV78Turbo stream forever, decoding `KV8passtimes` into per-journey
/// [`JourneyUpdate`]s for block/next-line chaining. Same reconnect/watchdog policy as
/// [`run_stream`]. Returns only when `tx` closes.
pub async fn run_journey_stream(cfg: StreamConfig, tx: Sender<JourneyUpdate>) {
    let mut backoff = Duration::from_secs(1);
    loop {
        match connect_and_pump_journeys(&cfg, &tx).await {
            Ok(()) => {
                info!(target: "ovlive::rt", stream = %cfg.name, "journey consumer closed; stopping");
                return;
            }
            Err(e) => {
                warn!(target: "ovlive::rt", stream = %cfg.name, "stream error: {e}; reconnecting in {:?}", backoff);
                tokio::time::sleep(backoff).await;
                backoff = (backoff * 2).min(Duration::from_secs(30));
            }
        }
    }
}

async fn connect_and_pump_journeys(cfg: &StreamConfig, tx: &Sender<JourneyUpdate>) -> anyhow::Result<()> {
    let mut socket = SubSocket::new();
    socket.connect(&cfg.endpoint).await?;
    if cfg.topics.is_empty() {
        socket.subscribe("").await?;
    } else {
        for t in &cfg.topics {
            socket.subscribe(t).await?;
        }
    }
    info!(target: "ovlive::rt", stream = %cfg.name, endpoint = %cfg.endpoint, "subscribed");

    loop {
        let msg = match tokio::time::timeout(cfg.idle_timeout, socket.recv()).await {
            Ok(res) => res?,
            Err(_) => anyhow::bail!("no data for {:?}; assuming dead socket", cfg.idle_timeout),
        };
        let frames = msg.into_vec();
        if frames.len() < 2 {
            continue; // topic-only / heartbeat
        }
        let payload: Vec<u8> = frames[1..].iter().flat_map(|b| b.iter().copied()).collect();
        let Some(text) = gunzip(&payload) else { continue };
        for u in parse_kv78(&text) {
            if tx.send(u).await.is_err() {
                return Ok(()); // consumer gone
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::sync::mpsc;
    use zeromq::{PubSocket, Socket};

    /// A real ZMQ publisher that completes the ZMTP handshake but never publishes — the
    /// exact "silently dead" case that hangs `recv()` forever without an error. The
    /// watchdog must turn that silence into an `Err` so `run_stream` reconnects.
    #[tokio::test]
    async fn watchdog_bails_on_silent_socket() {
        let endpoint = "tcp://127.0.0.1:45917";
        let mut publisher = PubSocket::new();
        publisher.bind(endpoint).await.expect("bind publisher");

        let cfg = StreamConfig {
            name: "test".into(),
            endpoint: endpoint.into(),
            kind: StreamKind::Kv6,
            topics: vec![],
            idle_timeout: Duration::from_millis(300),
        };
        let (tx, _rx) = mpsc::channel(8);

        let start = std::time::Instant::now();
        let res = connect_and_pump(&cfg, &tx).await;
        let elapsed = start.elapsed();

        let err = res.expect_err("should bail when no frames arrive");
        assert!(err.to_string().contains("no data"), "unexpected error: {err}");
        // Fired on the watchdog: not before the window, and comfortably within it.
        assert!(elapsed >= Duration::from_millis(300), "bailed too early: {elapsed:?}");
        assert!(elapsed < Duration::from_secs(5), "bailed too late: {elapsed:?}");

        drop(publisher);
    }
}

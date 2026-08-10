//! WebSocket `/v1/stream`: protobuf frames, per-connection viewport diffing.
//!
//! Each connection holds its viewport + filters and the set of vehicles it last saw.
//! On a fixed tick (`WS_TICK_HZ`) we read the latest shared spatial index, query the
//! connection's bbox, and emit ENTER / MOVE / LEAVE diffs. The tick bounds CPU: no
//! matter how fast upstream messages arrive, per-client work happens at a fixed rate.

use std::collections::HashMap;
use std::time::Duration;

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::State;
use axum::response::Response;
use futures::{SinkExt, StreamExt};
use ovlive_core::{BBox, Filters};
use ovlive_proto::v1 as pb;
use prost::Message as _;
use tracing::debug;

use crate::auth::OptionalApiKeyUser;
use crate::convert::{pb_filters_to_core, pb_viewport_to_bbox, to_move, to_state};
use crate::state::AppState;

pub async fn ws_handler(
    ws: WebSocketUpgrade,
    _auth: OptionalApiKeyUser,
    State(state): State<AppState>,
) -> Response {
    ws.on_upgrade(move |socket| run(socket, state))
}

/// What we last sent for a vehicle, to detect meaningful changes.
#[derive(Clone, Copy)]
struct Sent {
    lat: f64,
    lon: f64,
    delay: i32,
    at_stop: bool,
}

struct Subscription {
    bbox: BBox,
    filters: Filters,
    /// Vehicle ids streamed unconditionally, even when outside the viewport/filters — so a
    /// selected vehicle stays on the map (and keeps updating) after the user pans away.
    pinned: Vec<String>,
    sent: HashMap<String, Sent>,
    force_snapshot: bool,
}

fn changed(prev: &Sent, lat: f64, lon: f64, delay: i32, at_stop: bool) -> bool {
    (lat - prev.lat).abs() > 1e-6
        || (lon - prev.lon).abs() > 1e-6
        || delay != prev.delay
        || at_stop != prev.at_stop
}

/// How long a connection may go without a frame before we send a WebSocket Ping.
///
/// A subscription with nothing to report sends **nothing** (`build_update` returns `None`), and
/// that is a normal steady state: an empty viewport, a filter that matches no vehicle, or a tab
/// left open overnight. Proxies reap a silent socket — Cloudflare closes an idle proxied
/// WebSocket after ~100 s, which no `proxy_read_timeout` on our own nginx can override — and the
/// client then reconnects on a loop. A ping well inside that window keeps the socket accounted
/// for as traffic. Axum answers a client's Ping automatically; this is the other direction, and
/// browsers reply Pong without the page being involved.
const KEEPALIVE: Duration = Duration::from_secs(30);

async fn run(socket: WebSocket, state: AppState) {
    let (mut tx, mut rx) = socket.split();
    let mut sub: Option<Subscription> = None;
    let period = Duration::from_millis((1000 / state.tick_hz.max(1)) as u64);
    let mut ticker = tokio::time::interval(period);
    // Reset on every frame we send, so the ping only fires during genuine silence rather than
    // adding a periodic frame to the 3 Hz stream a busy viewport already produces.
    let mut idle = tokio::time::interval(KEEPALIVE);
    idle.reset();

    loop {
        tokio::select! {
            incoming = rx.next() => {
                match incoming {
                    Some(Ok(Message::Binary(bytes))) => {
                        match pb::ClientMessage::decode(bytes.as_ref()) {
                            Ok(msg) => {
                                if let Some(reply) = apply_client_msg(msg, &mut sub) {
                                    if tx.send(Message::Binary(reply)).await.is_err() { break; }
                                    idle.reset();
                                }
                            }
                            Err(e) => debug!(target: "ovlive::ws", "bad client frame: {e}"),
                        }
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(_)) => {} // ignore text/ping/pong
                    Some(Err(_)) => break,
                }
            }
            _ = ticker.tick() => {
                if let Some(sub) = sub.as_mut() {
                    if let Some(frame) = build_update(sub, &state) {
                        if tx.send(Message::Binary(frame)).await.is_err() { break; }
                        idle.reset();
                    }
                }
            }
            _ = idle.tick() => {
                if tx.send(Message::Ping(Vec::new())).await.is_err() { break; }
            }
        }
    }
}

/// Apply a client message; returns an optional immediate reply frame (e.g. pong).
fn apply_client_msg(msg: pb::ClientMessage, sub: &mut Option<Subscription>) -> Option<Vec<u8>> {
    match msg.payload? {
        pb::client_message::Payload::Subscribe(s) => {
            let bbox = s.viewport.as_ref().map(pb_viewport_to_bbox)?;
            let filters = s.filters.as_ref().map(pb_filters_to_core).unwrap_or_default();
            *sub = Some(Subscription {
                bbox,
                filters,
                pinned: s.pinned,
                sent: HashMap::new(),
                force_snapshot: true,
            });
            None
        }
        pb::client_message::Payload::UpdateViewport(u) => {
            if let (Some(s), Some(vp)) = (sub.as_mut(), u.viewport.as_ref()) {
                s.bbox = pb_viewport_to_bbox(vp);
                if let Some(f) = u.filters.as_ref() {
                    s.filters = pb_filters_to_core(f);
                }
                s.pinned = u.pinned;
            }
            None
        }
        pb::client_message::Payload::Ping(_) => Some(encode_pong()),
    }
}

fn build_update(sub: &mut Subscription, state: &AppState) -> Option<Vec<u8>> {
    let idx = state.latest_index();
    let hits = idx.query(sub.bbox, &sub.filters);

    let mut entered = Vec::new();
    let mut moved = Vec::new();
    let mut present = std::collections::HashSet::with_capacity(hits.len());

    for t in hits {
        present.insert(t.id.clone());
        let now = Sent { lat: t.lat, lon: t.lon, delay: t.delay_seconds, at_stop: t.at_stop };
        match sub.sent.get(&t.id) {
            None => {
                entered.push(to_state(t));
                sub.sent.insert(t.id.clone(), now);
            }
            Some(prev) if changed(prev, t.lat, t.lon, t.delay_seconds, t.at_stop) => {
                moved.push(to_move(t));
                sub.sent.insert(t.id.clone(), now);
            }
            _ => {}
        }
    }

    // Pinned (selected) vehicles are streamed even when outside the viewport/filters, so
    // they stay on the map after the user pans away. Marked `present` so they're never
    // reported as "left" while the trip still exists; when it ends, `get` returns None and
    // the normal left-sweep below removes it. Duplicates with the bbox query are skipped.
    for id in &sub.pinned {
        if present.contains(id) {
            continue;
        }
        if let Some(t) = idx.get(id) {
            present.insert(t.id.clone());
            let now = Sent { lat: t.lat, lon: t.lon, delay: t.delay_seconds, at_stop: t.at_stop };
            match sub.sent.get(&t.id) {
                None => {
                    entered.push(to_state(t));
                    sub.sent.insert(t.id.clone(), now);
                }
                Some(prev) if changed(prev, t.lat, t.lon, t.delay_seconds, t.at_stop) => {
                    moved.push(to_move(t));
                    sub.sent.insert(t.id.clone(), now);
                }
                _ => {}
            }
        }
    }

    // Anything we had but no longer see has left the viewport (or ended).
    let left: Vec<String> = sub
        .sent
        .keys()
        .filter(|id| !present.contains(*id))
        .cloned()
        .collect();
    for id in &left {
        sub.sent.remove(id);
    }

    let is_snapshot = sub.force_snapshot;
    sub.force_snapshot = false;

    if !is_snapshot && entered.is_empty() && moved.is_empty() && left.is_empty() {
        return None; // nothing to say this tick
    }

    let msg = pb::ServerMessage {
        payload: Some(pb::server_message::Payload::Update(pb::Update {
            entered,
            moved,
            left,
            is_snapshot,
        })),
    };
    Some(msg.encode_to_vec())
}

fn encode_pong() -> Vec<u8> {
    pb::ServerMessage {
        payload: Some(pb::server_message::Payload::Pong(true)),
    }
    .encode_to_vec()
}

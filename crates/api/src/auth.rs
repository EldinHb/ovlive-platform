//! Authentication extractors: API-key (data endpoints) and HTTP Basic (account/admin),
//! plus the layered rate limiting described on [`crate::state::RateLimits`].

use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::Arc;

use axum::extract::{ConnectInfo, FromRequestParts};
use axum::http::{request::Parts, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use base64::{engine::general_purpose::STANDARD, Engine};
use governor::DefaultDirectRateLimiter;
use ovlive_persist::{ApiKey, User};
use serde_json::json;

use crate::state::AppState;

fn err(code: StatusCode, msg: &str) -> Response {
    (code, Json(json!({ "error": msg }))).into_response()
}

fn too_many(msg: &str) -> Response {
    err(StatusCode::TOO_MANY_REQUESTS, msg)
}

/// The IP to account the request to.
///
/// The socket peer is the reverse proxy, not the visitor: in the production stack every request
/// arrives from nginx, which itself received it from `cloudflared`, so accounting by peer would
/// put the entire internet in one bucket. `CF-Connecting-IP` (set by Cloudflare, and the header
/// to trust behind it) and the leftmost `X-Forwarded-For` hop carry the real client.
///
/// Both are trivially forgeable by whoever can reach this port, so they are only honoured when
/// the peer is itself private or loopback — i.e. a proxy on our own network. A request straight
/// off the internet is accounted to its socket address no matter what it claims. Falls back to
/// `0.0.0.0` when there is no peer at all (only reachable in tests), which shares one bucket
/// rather than silently exempting the request.
fn client_ip(parts: &Parts) -> IpAddr {
    let peer = parts
        .extensions
        .get::<ConnectInfo<SocketAddr>>()
        .map(|ci| ci.0.ip());

    if peer.is_none_or(is_trusted_proxy) {
        if let Some(ip) = header_ip(parts, "cf-connecting-ip") {
            return ip;
        }
        if let Some(ip) = forwarded_for(parts) {
            return ip;
        }
    }
    peer.unwrap_or(IpAddr::V4(Ipv4Addr::UNSPECIFIED))
}

/// Whether a peer may speak for another IP: loopback, RFC1918/CGNAT, link-local, or IPv6 ULA —
/// the address ranges a sidecar proxy actually lands on inside a container network.
fn is_trusted_proxy(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => {
            v4.is_loopback() || v4.is_private() || v4.is_link_local() || v4.octets()[0] == 100
        }
        IpAddr::V6(v6) => {
            v6.is_loopback()
                || (v6.segments()[0] & 0xfe00) == 0xfc00
                || (v6.segments()[0] & 0xffc0) == 0xfe80
        }
    }
}

fn header_ip(parts: &Parts, name: &str) -> Option<IpAddr> {
    parts.headers.get(name)?.to_str().ok()?.trim().parse().ok()
}

fn forwarded_for(parts: &Parts) -> Option<IpAddr> {
    parts
        .headers
        .get("x-forwarded-for")?
        .to_str()
        .ok()?
        .split(',')
        .next()?
        .trim()
        .parse()
        .ok()
}

/// Charge the request to its client IP. Applies to *every* request, keyed or not, as the
/// outermost bound; the quota is set high enough that normal use of the map never reaches it.
// `Response` is what every caller's `Rejection` already is (axum's extractor contract), so
// boxing the error here would only be unboxed again at each `?`.
#[allow(clippy::result_large_err)]
fn check_ip(state: &AppState, parts: &Parts) -> Result<(), Response> {
    if state.limits.per_ip.check_key(&client_ip(parts)).is_err() {
        return Err(too_many("rate limit exceeded for this IP"));
    }
    Ok(())
}

/// Charge an authenticated request to the account and then to the key it used.
#[allow(clippy::result_large_err)] // same as `check_ip`
fn check_user_and_key(state: &AppState, user: &User, key: &ApiKey) -> Result<(), Response> {
    if state.limits.per_user.check_key(&user.id).is_err() {
        return Err(too_many("rate limit exceeded for this account"));
    }
    if key_limiter(state, key).check().is_err() {
        return Err(too_many("rate limit exceeded for this key"));
    }
    Ok(())
}

/// A request authenticated by a valid, non-revoked API key (Bearer, `X-API-Key`, or
/// `?key=` for WebSocket clients). Rate-limited per key.
#[allow(dead_code)] // fields are part of the public extractor; handlers may read them
pub struct ApiKeyUser {
    pub user: User,
    pub key: ApiKey,
}

fn api_key_from_parts(parts: &Parts) -> Option<String> {
    if let Some(v) = parts.headers.get(axum::http::header::AUTHORIZATION) {
        if let Ok(s) = v.to_str() {
            if let Some(rest) = s.strip_prefix("Bearer ") {
                return Some(rest.trim().to_string());
            }
        }
    }
    if let Some(v) = parts.headers.get("x-api-key") {
        if let Ok(s) = v.to_str() {
            return Some(s.trim().to_string());
        }
    }
    parts.uri.query().and_then(|q| {
        q.split('&')
            .find_map(|kv| kv.strip_prefix("key=").map(|v| v.to_string()))
    })
}

fn key_limiter(state: &AppState, key: &ApiKey) -> Arc<DefaultDirectRateLimiter> {
    state
        .limits
        .per_key
        .entry(key.id)
        .or_insert_with(|| crate::state::direct_limiter(key.rate_per_min.max(1) as u32))
        .clone()
}

#[axum::async_trait]
impl FromRequestParts<AppState> for ApiKeyUser {
    type Rejection = Response;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Response> {
        check_ip(state, parts)?;
        let key = api_key_from_parts(parts)
            .ok_or_else(|| err(StatusCode::UNAUTHORIZED, "missing API key"))?;
        let (key, user) = state
            .db
            .authenticate_key(&key)
            .await
            .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "auth error"))?
            .ok_or_else(|| err(StatusCode::UNAUTHORIZED, "invalid or revoked API key"))?;

        check_user_and_key(state, &user, &key)?;
        Ok(ApiKeyUser { user, key })
    }
}

/// A request to a public data endpoint. The API key is **optional**:
/// - No key → anonymous public access. This is what the official web app uses; end users
///   never supply a key. Bounded per client IP, so one heavy visitor throttles only itself.
/// - Valid key → treated as an API consumer: authenticated, then bounded per account and per
///   key (attributable limits). Available for third-party programmatic use.
/// - Present but invalid/revoked key → rejected with 401, so a misconfigured consumer
///   gets a clear error instead of silently falling back to the public tier.
pub struct OptionalApiKeyUser(#[allow(dead_code)] pub Option<ApiKeyUser>);

#[axum::async_trait]
impl FromRequestParts<AppState> for OptionalApiKeyUser {
    type Rejection = Response;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Response> {
        check_ip(state, parts)?;
        match api_key_from_parts(parts) {
            Some(raw) => {
                let (key, user) = state
                    .db
                    .authenticate_key(&raw)
                    .await
                    .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "auth error"))?
                    .ok_or_else(|| err(StatusCode::UNAUTHORIZED, "invalid or revoked API key"))?;
                check_user_and_key(state, &user, &key)?;
                Ok(OptionalApiKeyUser(Some(ApiKeyUser { user, key })))
            }
            None => Ok(OptionalApiKeyUser(None)),
        }
    }
}

fn basic_credentials(parts: &Parts) -> Option<(String, String)> {
    let v = parts.headers.get(axum::http::header::AUTHORIZATION)?.to_str().ok()?;
    let b64 = v.strip_prefix("Basic ")?;
    let decoded = STANDARD.decode(b64.trim()).ok()?;
    let s = String::from_utf8(decoded).ok()?;
    let (email, password) = s.split_once(':')?;
    Some((email.to_string(), password.to_string()))
}

/// A request authenticated by HTTP Basic (email:password) — for managing one's own keys.
pub struct BasicUser(pub User);

#[axum::async_trait]
impl FromRequestParts<AppState> for BasicUser {
    type Rejection = Response;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Response> {
        // Password verification is Argon2 — deliberately expensive — so an unbounded caller
        // could both brute-force and burn CPU. Charge the attempt before doing the work.
        check_ip(state, parts)?;
        let (email, password) = basic_credentials(parts).ok_or_else(|| {
            (
                StatusCode::UNAUTHORIZED,
                [("WWW-Authenticate", "Basic realm=\"OVLive\"")],
                Json(json!({ "error": "basic auth required" })),
            )
                .into_response()
        })?;
        let user = state
            .db
            .authenticate(&email, &password)
            .await
            .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "auth error"))?
            .ok_or_else(|| err(StatusCode::UNAUTHORIZED, "invalid credentials"))?;
        Ok(BasicUser(user))
    }
}

/// Like [`BasicUser`] but requires `is_admin`.
#[allow(dead_code)] // handlers destructure but may ignore the inner user
pub struct AdminUser(pub User);

#[axum::async_trait]
impl FromRequestParts<AppState> for AdminUser {
    type Rejection = Response;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Response> {
        let BasicUser(user) = BasicUser::from_request_parts(parts, state).await?;
        if !user.is_admin {
            return Err(err(StatusCode::FORBIDDEN, "admin only"));
        }
        Ok(AdminUser(user))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::http::Request;
    use std::net::Ipv6Addr;

    /// Build request parts with an optional socket peer and proxy headers.
    fn parts(peer: Option<&str>, headers: &[(&str, &str)]) -> Parts {
        let mut b = Request::builder().uri("/v1/vehicles");
        for (k, v) in headers {
            b = b.header(*k, *v);
        }
        let (mut parts, _) = b.body(()).unwrap().into_parts();
        if let Some(p) = peer {
            let addr: SocketAddr = format!("{p}:443").parse().unwrap();
            parts.extensions.insert(ConnectInfo(addr));
        }
        parts
    }

    fn ip(s: &str) -> IpAddr {
        s.parse().unwrap()
    }

    #[test]
    fn trusts_proxy_headers_only_from_a_private_peer() {
        // nginx in the compose network forwarding what Cloudflare told it.
        let p = parts(Some("172.18.0.4"), &[("cf-connecting-ip", "203.0.113.9")]);
        assert_eq!(client_ip(&p), ip("203.0.113.9"));

        // The same claim straight off the internet is a spoof: charge the real socket.
        let p = parts(Some("203.0.113.1"), &[("cf-connecting-ip", "198.51.100.7")]);
        assert_eq!(client_ip(&p), ip("203.0.113.1"));
    }

    #[test]
    fn prefers_cf_connecting_ip_then_leftmost_forwarded_for() {
        let p = parts(
            Some("127.0.0.1"),
            &[
                ("cf-connecting-ip", "203.0.113.9"),
                ("x-forwarded-for", "198.51.100.7, 172.18.0.4"),
            ],
        );
        assert_eq!(client_ip(&p), ip("203.0.113.9"));

        // Without the Cloudflare header, the client is the leftmost hop, not the proxy.
        let xff = [("x-forwarded-for", "198.51.100.7, 172.18.0.4")];
        let p = parts(Some("127.0.0.1"), &xff);
        assert_eq!(client_ip(&p), ip("198.51.100.7"));
    }

    #[test]
    fn falls_back_to_the_peer_and_never_exempts_a_request() {
        // No headers at all: the peer is the client (direct hit on the published port).
        let p = parts(Some("192.168.1.50"), &[]);
        assert_eq!(client_ip(&p), ip("192.168.1.50"));

        // Garbage header from a trusted peer must not become "no limit".
        let p = parts(Some("10.0.0.2"), &[("cf-connecting-ip", "not-an-ip")]);
        assert_eq!(client_ip(&p), ip("10.0.0.2"));

        // No peer either (only reachable in tests): one shared bucket, not an exemption.
        let p = parts(None, &[]);
        assert_eq!(client_ip(&p), IpAddr::V4(Ipv4Addr::UNSPECIFIED));
    }

    #[test]
    fn classifies_container_and_public_peers() {
        for private in ["127.0.0.1", "10.1.2.3", "172.18.0.4", "192.168.0.9", "100.64.0.1"] {
            assert!(is_trusted_proxy(ip(private)), "{private} should be trusted");
        }
        for public in ["203.0.113.1", "8.8.8.8"] {
            assert!(!is_trusted_proxy(ip(public)), "{public} is not a proxy");
        }
        assert!(is_trusted_proxy(IpAddr::V6(Ipv6Addr::LOCALHOST)));
        assert!(is_trusted_proxy(ip("fd00::1"))); // ULA, what a compose network hands out
        assert!(!is_trusted_proxy(ip("2606:4700::1111"))); // public v6
    }
}

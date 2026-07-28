//! Authentication extractors: API-key (data endpoints) and HTTP Basic (account/admin),
//! plus per-key rate limiting.

use std::num::NonZeroU32;
use std::sync::Arc;

use axum::extract::FromRequestParts;
use axum::http::{request::Parts, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::Json;
use base64::{engine::general_purpose::STANDARD, Engine};
use governor::{DefaultDirectRateLimiter, Quota, RateLimiter};
use ovlive_persist::{ApiKey, User};
use serde_json::json;

use crate::state::AppState;

fn err(code: StatusCode, msg: &str) -> Response {
    (code, Json(json!({ "error": msg }))).into_response()
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

fn rate_limiter(state: &AppState, key: &ApiKey) -> Arc<DefaultDirectRateLimiter> {
    state
        .limiters
        .entry(key.id)
        .or_insert_with(|| {
            let n = NonZeroU32::new(key.rate_per_min.max(1) as u32).unwrap();
            Arc::new(RateLimiter::direct(Quota::per_minute(n)))
        })
        .clone()
}

#[axum::async_trait]
impl FromRequestParts<AppState> for ApiKeyUser {
    type Rejection = Response;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Response> {
        let key = api_key_from_parts(parts)
            .ok_or_else(|| err(StatusCode::UNAUTHORIZED, "missing API key"))?;
        let (key, user) = state
            .db
            .authenticate_key(&key)
            .await
            .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "auth error"))?
            .ok_or_else(|| err(StatusCode::UNAUTHORIZED, "invalid or revoked API key"))?;

        if rate_limiter(state, &key).check().is_err() {
            return Err(err(StatusCode::TOO_MANY_REQUESTS, "rate limit exceeded"));
        }
        Ok(ApiKeyUser { user, key })
    }
}

/// A request to a public data endpoint. The API key is **optional**:
/// - No key → anonymous public access. This is what the official web app uses; end users
///   never supply a key. Guarded by a single shared limiter (`state.public_limiter`) so
///   anonymous traffic can't hammer the server.
/// - Valid key → treated as an API consumer: authenticated and rate-limited per key
///   (higher, attributable limits). Available for third-party programmatic use.
/// - Present but invalid/revoked key → rejected with 401, so a misconfigured consumer
///   gets a clear error instead of silently falling back to the public tier.
pub struct OptionalApiKeyUser(#[allow(dead_code)] pub Option<ApiKeyUser>);

#[axum::async_trait]
impl FromRequestParts<AppState> for OptionalApiKeyUser {
    type Rejection = Response;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, Response> {
        match api_key_from_parts(parts) {
            Some(raw) => {
                let (key, user) = state
                    .db
                    .authenticate_key(&raw)
                    .await
                    .map_err(|_| err(StatusCode::INTERNAL_SERVER_ERROR, "auth error"))?
                    .ok_or_else(|| err(StatusCode::UNAUTHORIZED, "invalid or revoked API key"))?;
                if rate_limiter(state, &key).check().is_err() {
                    return Err(err(StatusCode::TOO_MANY_REQUESTS, "rate limit exceeded"));
                }
                Ok(OptionalApiKeyUser(Some(ApiKeyUser { user, key })))
            }
            None => {
                if state.public_limiter.check().is_err() {
                    return Err(err(StatusCode::TOO_MANY_REQUESTS, "rate limit exceeded"));
                }
                Ok(OptionalApiKeyUser(None))
            }
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

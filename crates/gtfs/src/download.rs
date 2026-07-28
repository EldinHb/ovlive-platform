//! Conditional GTFS download. Honours the OVapi policy: identifying User-Agent,
//! `If-None-Match`/`If-Modified-Since`, and treating `304` as "nothing to do".
//!
//! The body is streamed to a temp file and atomically renamed into place, so we keep a
//! reusable `gtfs-nl.zip` on disk (re-parse locally, never re-download to get unblocked)
//! and never hold the ~200 MB archive in memory.

use std::path::Path;

use anyhow::{Context, Result};
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use tokio::io::AsyncWriteExt;

/// Cache validators persisted between runs so we never re-download unchanged data.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct FeedMeta {
    pub etag: Option<String>,
    pub last_modified: Option<String>,
}

pub enum DownloadOutcome {
    /// Server returned 304 — the cached zip on disk is still current.
    NotModified,
    /// A fresh archive was written to the destination path.
    Fetched { meta: FeedMeta },
}

/// Conditionally download to `dest` (streamed via a temp file). Returns [`DownloadOutcome`].
pub async fn conditional_download_to(
    url: &str,
    user_agent: &str,
    prev: &FeedMeta,
    dest: &Path,
) -> Result<DownloadOutcome> {
    let client = reqwest::Client::builder()
        .user_agent(user_agent)
        .build()
        .context("build http client")?;

    let mut req = client.get(url);
    if let Some(etag) = &prev.etag {
        req = req.header(reqwest::header::IF_NONE_MATCH, etag);
    }
    if let Some(lm) = &prev.last_modified {
        req = req.header(reqwest::header::IF_MODIFIED_SINCE, lm);
    }

    let resp = req.send().await.context("send gtfs request")?;
    if resp.status() == reqwest::StatusCode::NOT_MODIFIED {
        return Ok(DownloadOutcome::NotModified);
    }
    let resp = resp.error_for_status().context("gtfs http status")?;

    let meta = FeedMeta {
        etag: header_string(&resp, reqwest::header::ETAG),
        last_modified: header_string(&resp, reqwest::header::LAST_MODIFIED),
    };

    if let Some(parent) = dest.parent() {
        tokio::fs::create_dir_all(parent).await.ok();
    }
    let tmp = dest.with_extension("part");
    let mut file = tokio::fs::File::create(&tmp).await.context("create temp zip")?;
    let mut stream = resp.bytes_stream();
    while let Some(chunk) = stream.next().await {
        let chunk = chunk.context("stream gtfs body")?;
        file.write_all(&chunk).await.context("write gtfs chunk")?;
    }
    file.flush().await.context("flush gtfs zip")?;
    drop(file);
    tokio::fs::rename(&tmp, dest).await.context("rename gtfs zip")?;

    Ok(DownloadOutcome::Fetched { meta })
}

fn header_string(resp: &reqwest::Response, name: reqwest::header::HeaderName) -> Option<String> {
    resp.headers()
        .get(name)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string())
}

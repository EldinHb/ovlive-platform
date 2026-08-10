//! Throwaway diagnostic: sample the NS InfoPlus train-positions feed
//! (`/RIG/NStreinpositiesInterface5` on port 7664) and dump the raw wire format, so a
//! human can see exactly which fields NS publishes before anything parses them.
//!
//! Writes a Markdown report with (1) the topic envelopes seen, (2) one full raw message,
//! and (3) per-message record counts / field census.
//!
//! Run: `cargo run --example nslisten -p ovlive-realtime`
//! Env: SAMPLE_SECS (default 30), OUT (default data/ns-treinposities.md).
//!
//! NB fair-use: only ONE connection per datastream. Port 7664 is separate from KV6,
//! so this is safe to run alongside the server *unless* the server's NS stream is enabled.

use std::collections::BTreeMap;
use std::fmt::Write as _;
use std::io::Read;
use std::time::{Duration, Instant};

use flate2::read::GzDecoder;
use zeromq::{Socket, SocketRecv, SubSocket};

/// The feed may or may not gzip; fall back to treating the payload as plain UTF-8.
fn text_of(payload: &[u8]) -> Option<String> {
    let mut d = GzDecoder::new(payload);
    let mut s = String::new();
    if d.read_to_string(&mut s).is_ok() && !s.is_empty() {
        return Some(s);
    }
    String::from_utf8(payload.to_vec()).ok()
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let endpoint = std::env::var("ZMQ_NS_ENDPOINT")
        .unwrap_or_else(|_| "tcp://pubsub.besteffort.ndovloket.nl:7664".into());
    let topic = std::env::var("ZMQ_NS_TOPICS")
        .unwrap_or_else(|_| "/RIG/NStreinpositiesInterface5".into());
    let secs: u64 = std::env::var("SAMPLE_SECS").ok().and_then(|v| v.parse().ok()).unwrap_or(30);
    let out = std::env::var("OUT").unwrap_or_else(|_| "data/ns-treinposities.md".into());

    let mut socket = SubSocket::new();
    socket.connect(&endpoint).await?;
    for t in topic.split(',').map(str::trim).filter(|s| !s.is_empty()) {
        socket.subscribe(t).await?;
    }
    println!("subscribed to {topic} on {endpoint}; sampling {secs}s");

    let deadline = Instant::now() + Duration::from_secs(secs);
    let mut envelopes: BTreeMap<String, u64> = BTreeMap::new();
    let mut first_raw: Option<(String, String)> = None;
    let mut tags: BTreeMap<String, u64> = BTreeMap::new();
    let mut msgs = 0u64;
    let mut sizes: Vec<usize> = Vec::new();

    while Instant::now() < deadline {
        let left = deadline.saturating_duration_since(Instant::now());
        let Ok(Ok(msg)) = tokio::time::timeout(left, socket.recv()).await else { break };
        let frames = msg.into_vec();
        let env = String::from_utf8_lossy(&frames[0]).to_string();
        *envelopes.entry(env.clone()).or_default() += 1;
        if frames.len() < 2 {
            continue;
        }
        let payload: Vec<u8> = frames[1..].iter().flat_map(|b| b.iter().copied()).collect();
        let Some(text) = text_of(&payload) else {
            println!("undecodable payload ({} bytes)", payload.len());
            continue;
        };
        msgs += 1;
        sizes.push(text.len());
        // Crude element census: every `<Tag` occurrence, namespace prefix stripped.
        for cap in text.split('<').skip(1) {
            let tag: String = cap
                .chars()
                .take_while(|c| c.is_alphanumeric() || *c == ':' || *c == '_' || *c == '-')
                .collect();
            if tag.is_empty() {
                continue;
            }
            let local = tag.rsplit(':').next().unwrap_or(&tag).to_string();
            *tags.entry(local).or_default() += 1;
        }
        if first_raw.is_none() {
            first_raw = Some((env, text));
        }
    }

    let mut md = String::new();
    writeln!(md, "# NS InfoPlus treinposities sample\n")?;
    writeln!(md, "- endpoint: `{endpoint}`")?;
    writeln!(md, "- topics: `{topic}`")?;
    writeln!(md, "- sampled: {secs}s, {msgs} decodable messages\n")?;
    writeln!(md, "## Envelopes\n")?;
    writeln!(md, "| envelope | frames |\n|---|---|")?;
    for (e, n) in &envelopes {
        writeln!(md, "| `{e}` | {n} |")?;
    }
    if !sizes.is_empty() {
        let total: usize = sizes.iter().sum();
        writeln!(
            md,
            "\npayload chars: min {} / avg {} / max {}\n",
            sizes.iter().min().unwrap(),
            total / sizes.len(),
            sizes.iter().max().unwrap()
        )?;
    }
    writeln!(md, "## Element census\n")?;
    writeln!(md, "| element | count |\n|---|---|")?;
    for (t, n) in &tags {
        writeln!(md, "| `{t}` | {n} |")?;
    }
    if let Some((env, text)) = &first_raw {
        writeln!(md, "\n## First raw message (`{env}`)\n")?;
        writeln!(md, "```xml\n{}\n```", text)?;
    }

    std::fs::write(&out, md)?;
    println!("wrote {out} ({msgs} messages, {} envelopes)", envelopes.len());
    Ok(())
}

//! Binary snapshots to the `/data` volume so in-memory state survives restarts.
//!
//! We use gzip-compressed bincode. Generic over any `Serialize`/`DeserializeOwned`
//! type so it serves both the parsed GTFS store and the live-trip set without coupling
//! this crate to their definitions.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use flate2::{read::GzDecoder, write::GzEncoder, Compression};
use serde::{de::DeserializeOwned, Serialize};

/// Resolve a snapshot path under the data directory.
pub fn path_in(data_dir: &str, file: &str) -> PathBuf {
    Path::new(data_dir).join(file)
}

/// Atomically write `value` to `path` (temp file + rename).
pub fn save<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    let bytes = bincode::serialize(value).context("bincode serialize")?;
    let tmp = path.with_extension("tmp");
    {
        let f = std::fs::File::create(&tmp).context("create snapshot tmp")?;
        let mut enc = GzEncoder::new(f, Compression::fast());
        enc.write_all(&bytes).context("write snapshot")?;
        enc.finish().context("finish gzip")?;
    }
    std::fs::rename(&tmp, path).context("rename snapshot")?;
    Ok(())
}

/// Load a snapshot if present. Returns `Ok(None)` when the file does not exist.
pub fn load<T: DeserializeOwned>(path: &Path) -> Result<Option<T>> {
    if !path.exists() {
        return Ok(None);
    }
    let f = std::fs::File::open(path).context("open snapshot")?;
    let mut dec = GzDecoder::new(f);
    let mut bytes = Vec::new();
    dec.read_to_end(&mut bytes).context("read snapshot")?;
    let value = bincode::deserialize(&bytes).context("bincode deserialize")?;
    Ok(Some(value))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip() {
        let dir = std::env::temp_dir().join(format!("ovlive-snap-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p = dir.join("v.bin.gz");
        let data = vec![("RET".to_string(), 1u32), ("HTM".to_string(), 2)];
        save(&p, &data).unwrap();
        let back: Option<Vec<(String, u32)>> = load(&p).unwrap();
        assert_eq!(back.unwrap(), data);
        let missing: Option<Vec<(String, u32)>> = load(&dir.join("nope.gz")).unwrap();
        assert!(missing.is_none());
    }
}

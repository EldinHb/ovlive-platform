//! Server-side filtering shared by the WS viewport engine and REST snapshot queries.

use crate::model::{LiveTrip, VehicleType};

/// Geographic bounding box (WGS84 degrees).
#[derive(Debug, Clone, Copy)]
pub struct BBox {
    pub min_lat: f64,
    pub min_lon: f64,
    pub max_lat: f64,
    pub max_lon: f64,
}

impl BBox {
    pub fn contains(&self, lat: f64, lon: f64) -> bool {
        lat >= self.min_lat && lat <= self.max_lat && lon >= self.min_lon && lon <= self.max_lon
    }
}

/// Attribute filters. Empty vectors / empty search = match everything.
#[derive(Debug, Clone, Default)]
pub struct Filters {
    pub vehicle_types: Vec<VehicleType>,
    pub dataowners: Vec<String>,
    pub search: String,
}

impl Filters {
    pub fn matches(&self, t: &LiveTrip) -> bool {
        if !self.vehicle_types.is_empty() && !self.vehicle_types.contains(&t.vehicle_type) {
            return false;
        }
        if !self.dataowners.is_empty()
            && !self
                .dataowners
                .iter()
                .any(|d| d.eq_ignore_ascii_case(&t.key.dataowner))
        {
            return false;
        }
        if !self.search.is_empty() {
            let q = self.search.to_ascii_lowercase();
            let hay = [
                Some(t.key.vehicle_number.as_str()),
                t.line_public_number.as_deref(),
                t.line_planning_number.as_deref(),
                t.block_code.as_deref(),
                t.journey_number.as_deref(),
            ];
            if !hay
                .into_iter()
                .flatten()
                .any(|s| s.to_ascii_lowercase().contains(&q))
            {
                return false;
            }
        }
        true
    }
}

//! Domain model: vehicle types, normalized realtime events, and live-trip state.

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
pub enum VehicleType {
    #[default]
    Unknown,
    Bus,
    Tram,
    Metro,
    Train,
    Ferry,
}

impl VehicleType {
    /// Map a GTFS `route_type` to our simplified enum.
    /// (GTFS extended route types collapse to these basics.)
    pub fn from_gtfs_route_type(rt: i32) -> Self {
        match rt {
            0 | 900..=906 => VehicleType::Tram,
            1 | 400..=404 => VehicleType::Metro,
            2 | 100..=117 => VehicleType::Train,
            3 | 700..=716 => VehicleType::Bus,
            4 | 1000..=1099 => VehicleType::Ferry,
            _ => VehicleType::Unknown,
        }
    }
}

/// The kind of KV6 position message. Drives the trip lifecycle.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum MessageKind {
    Init,
    Arrival,
    OnStop,
    Departure,
    OnRoute,
    Delay,
    Offroute,
    End,
}

/// Identifies a physical vehicle within an operator.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct VehicleKey {
    pub dataowner: String,
    pub vehicle_number: String,
}

impl VehicleKey {
    pub fn id(&self) -> String {
        format!("{}:{}", self.dataowner, self.vehicle_number)
    }
}

/// A normalized realtime position event produced by `ovlive-realtime` and applied to
/// [`crate::state::LiveState`]. Decoupled from the XML wire format on purpose.
///
/// The two feeds fill this differently, which is why several fields are optional:
/// BISON KV6 gives Rijksdriehoek metres and punctuality but no course; NS InfoPlus
/// treinposities gives WGS84 degrees and a GPS course but no punctuality at all.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PosEvent {
    pub key: VehicleKey,
    pub kind: MessageKind,
    pub line_planning_number: Option<String>,
    pub journey_number: Option<String>,
    pub operating_day: Option<String>,
    pub block_code: Option<String>,
    /// Rijksdriehoek coordinates (metres); converted to lat/lon on apply. KV6 only.
    pub rd_x: Option<f64>,
    pub rd_y: Option<f64>,
    /// WGS84 degrees, when the feed already reports them (NS InfoPlus). Takes precedence
    /// over `rd_x`/`rd_y` on apply — no reason to round-trip through a projection.
    pub lat: Option<f64>,
    pub lon: Option<f64>,
    /// Course over ground in degrees (0 = north), when the feed supplies one. KV6 doesn't,
    /// so that path keeps deriving bearing from consecutive fixes.
    pub bearing: Option<f32>,
    /// Mode, when the feed itself identifies it (the NS feed is trains by definition).
    /// Lets a vehicle render correctly even when GTFS enrichment finds no matching trip.
    pub vehicle_type: Option<VehicleType>,
    /// Punctuality in seconds (+ late, - early).
    pub punctuality: Option<i32>,
    pub user_stop_code: Option<String>,
    pub timestamp: DateTime<Utc>,
}

/// A currently-active trip/vehicle held in memory.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LiveTrip {
    pub id: String,
    pub key: VehicleKey,
    pub vehicle_type: VehicleType,
    pub operator_name: Option<String>,
    /// GTFS `agency_id` of the matched route (not the name). The pre-Rust API exposed this as
    /// `agency`, so the compatibility endpoints need it alongside `operator_name`.
    pub agency_id: Option<String>,
    pub line_planning_number: Option<String>,
    pub line_public_number: Option<String>,
    pub journey_number: Option<String>,
    pub operating_day: Option<String>,
    pub block_code: Option<String>,
    pub destination: Option<String>,
    pub matched_trip_id: Option<String>,
    /// GTFS route_color / route_text_color for the matched line (6-hex, no '#'), if any.
    pub line_color: Option<String>,
    pub line_text_color: Option<String>,

    pub lat: f64,
    pub lon: f64,
    pub bearing: f32,
    pub delay_seconds: i32,
    /// Whether `delay_seconds` is a measurement or just its zero default.
    ///
    /// Needed because "unknown" and "on time" are both 0 on the wire, and conflating them
    /// makes the UI assert punctuality it can't know. The NS position feed carries no
    /// punctuality at all (it comes from RitInfo, separately and not for every train), and KV6
    /// omits it on some message kinds too.
    pub delay_known: bool,
    pub at_stop: bool,
    pub current_stop_id: Option<String>,

    /// Kind of the most recent KV6 message. `at_stop` only captures the arrival/departure
    /// half of this; the full kind is what the legacy status endpoints report.
    pub last_kind: Option<MessageKind>,
    /// Whether this trip began with an `INIT` message rather than being inferred from a
    /// mid-journey update (the feed drops messages). Reported as `hasInit`.
    pub has_init: bool,

    pub last_update: DateTime<Utc>,
    #[serde(skip)]
    pub prev_lat: f64,
    #[serde(skip)]
    pub prev_lon: f64,
}

impl LiveTrip {
    pub fn new(key: VehicleKey, ts: DateTime<Utc>) -> Self {
        let id = key.id();
        Self {
            id,
            key,
            vehicle_type: VehicleType::Unknown,
            operator_name: None,
            agency_id: None,
            line_planning_number: None,
            line_public_number: None,
            journey_number: None,
            operating_day: None,
            block_code: None,
            destination: None,
            matched_trip_id: None,
            line_color: None,
            line_text_color: None,
            lat: f64::NAN,
            lon: f64::NAN,
            bearing: f32::NAN,
            delay_seconds: 0,
            delay_known: false,
            at_stop: false,
            current_stop_id: None,
            last_kind: None,
            has_init: false,
            last_update: ts,
            prev_lat: f64::NAN,
            prev_lon: f64::NAN,
        }
    }

    pub fn has_position(&self) -> bool {
        self.lat.is_finite() && self.lon.is_finite()
    }

    /// The OVapi `realtime_trip_id` this trip joins on:
    /// `"<dataowner>:<line_planning_number>:<journey_number>"`. `None` until KV6 has told
    /// us both the line and the journey. This is the id the pre-Rust API exposed publicly,
    /// so the legacy endpoints accept and echo it.
    pub fn realtime_trip_id(&self) -> Option<String> {
        Some(format!(
            "{}:{}:{}",
            self.key.dataowner,
            self.line_planning_number.as_deref()?,
            self.journey_number.as_deref()?
        ))
    }
}

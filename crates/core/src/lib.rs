//! OVLive core domain: RD→WGS84 conversion, the live-trip model, lifecycle rules,
//! filtering, and the per-tick spatial index. Deliberately free of I/O, XML, protobuf,
//! and database concerns so it can be unit-tested in isolation and reused everywhere.

pub mod blocks;
pub mod filter;
pub mod model;
pub mod rd;
pub mod state;

pub use blocks::{BlockSnapshot, BlockStore, JourneyUpdate, NextTrip};
pub use filter::{BBox, Filters};
pub use model::{LiveTrip, MessageKind, PosEvent, VehicleKey, VehicleType};
pub use state::{Enricher, LiveState, NoEnricher, VehicleIndex};

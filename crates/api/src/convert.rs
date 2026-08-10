//! Conversions between the core domain and the protobuf wire types.

use ovlive_core::{BBox, Filters, LiveTrip, VehicleType as CoreType};
use ovlive_proto::v1 as pb;

pub fn core_type_to_pb(t: CoreType) -> i32 {
    let v = match t {
        CoreType::Bus => pb::VehicleType::Bus,
        CoreType::Tram => pb::VehicleType::Tram,
        CoreType::Metro => pb::VehicleType::Metro,
        CoreType::Train => pb::VehicleType::Train,
        CoreType::Ferry => pb::VehicleType::Ferry,
        CoreType::Unknown => pb::VehicleType::Unspecified,
    };
    v as i32
}

pub fn pb_type_to_core(v: i32) -> Option<CoreType> {
    match pb::VehicleType::try_from(v).ok()? {
        pb::VehicleType::Bus => Some(CoreType::Bus),
        pb::VehicleType::Tram => Some(CoreType::Tram),
        pb::VehicleType::Metro => Some(CoreType::Metro),
        pb::VehicleType::Train => Some(CoreType::Train),
        pb::VehicleType::Ferry => Some(CoreType::Ferry),
        pb::VehicleType::Unspecified => None,
    }
}

pub fn to_state(t: &LiveTrip) -> pb::VehicleState {
    pb::VehicleState {
        id: t.id.clone(),
        dataowner: t.key.dataowner.clone(),
        vehicle_number: t.key.vehicle_number.clone(),
        line_public_number: t.line_public_number.clone().unwrap_or_default(),
        vehicle_type: core_type_to_pb(t.vehicle_type),
        operator_name: t.operator_name.clone().unwrap_or_default(),
        lat: t.lat,
        lon: t.lon,
        bearing: t.bearing,
        delay_seconds: t.delay_seconds,
        delay_known: t.delay_known,
        destination: t.destination.clone().unwrap_or_default(),
        block_code: t.block_code.clone().unwrap_or_default(),
        journey_number: t.journey_number.clone().unwrap_or_default(),
        at_stop: t.at_stop,
        current_stop_id: t.current_stop_id.clone().unwrap_or_default(),
        line_color: t.line_color.clone().unwrap_or_default(),
        line_text_color: t.line_text_color.clone().unwrap_or_default(),
    }
}

pub fn to_move(t: &LiveTrip) -> pb::VehicleMove {
    pb::VehicleMove {
        id: t.id.clone(),
        lat: t.lat,
        lon: t.lon,
        bearing: t.bearing,
        delay_seconds: t.delay_seconds,
        delay_known: t.delay_known,
        at_stop: t.at_stop,
        current_stop_id: t.current_stop_id.clone().unwrap_or_default(),
    }
}

pub fn pb_viewport_to_bbox(v: &pb::Viewport) -> BBox {
    BBox {
        min_lat: v.min_lat,
        min_lon: v.min_lon,
        max_lat: v.max_lat,
        max_lon: v.max_lon,
    }
}

pub fn pb_filters_to_core(f: &pb::Filters) -> Filters {
    Filters {
        vehicle_types: f.vehicle_types.iter().filter_map(|&v| pb_type_to_core(v)).collect(),
        dataowners: f.dataowners.clone(),
        search: f.search.clone(),
    }
}

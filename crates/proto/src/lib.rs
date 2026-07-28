//! Generated protobuf types for the OVLive WebSocket contract.
//!
//! The `.proto` lives in `packages/proto/ovlive.proto` and is compiled at build time
//! (see `build.rs`) using a vendored `protoc`.

pub mod v1 {
    include!(concat!(env!("OUT_DIR"), "/ovlive.v1.rs"));
}

pub use v1::*;

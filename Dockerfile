# --- Build stage ---
FROM rust:1-slim-bookworm AS builder
WORKDIR /app

# Cache dependencies: copy manifests first.
COPY Cargo.toml Cargo.lock rust-toolchain.toml ./
COPY crates/proto/Cargo.toml crates/proto/
COPY crates/core/Cargo.toml crates/core/
COPY crates/gtfs/Cargo.toml crates/gtfs/
COPY crates/realtime/Cargo.toml crates/realtime/
COPY crates/persist/Cargo.toml crates/persist/
COPY crates/api/Cargo.toml crates/api/
COPY crates/server/Cargo.toml crates/server/

# Only what the Rust build actually reads — not `COPY . .`. packages/proto is the WS wire
# contract (crates/proto/build.rs compiles it); pulling in apps/ would make every frontend
# edit invalidate this layer and re-run a full release build in CI.
COPY crates crates
COPY packages/proto packages/proto
COPY migrations migrations

# protoc is provided by protoc-bin-vendored; libzmq not needed (pure-Rust zeromq).
RUN cargo build --release -p ovlive-server

# --- Runtime stage (distroless: tiny, no shell) ---
FROM gcr.io/distroless/cc-debian12 AS runtime
WORKDIR /app
COPY --from=builder /app/target/release/ovlive-server /usr/local/bin/ovlive-server
COPY --from=builder /app/migrations /app/migrations
ENV DATA_DIR=/data BIND_ADDR=0.0.0.0:8080
VOLUME ["/data"]
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/ovlive-server"]

# OVLive task runner. Install `just`: https://github.com/casey/just

set dotenv-load := true

default:
    @just --list

# --- Rust backend ---
build:
    cargo build --workspace

release:
    cargo build --workspace --release

test:
    cargo test --workspace

check:
    cargo check --workspace
    cargo clippy --workspace --all-targets -- -D warnings

fmt:
    cargo fmt --all

run:
    cargo run -p ovlive-server

# --- Database ---
migrate:
    sqlx migrate run

# --- Docker ---
up:
    docker compose up --build

down:
    docker compose down

# --- Protobuf → TS (clients) ---
proto-ts:
    pnpm --filter @ovlive/api-types run generate

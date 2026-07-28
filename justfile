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

# --- Docker (development) ---
up:
    docker compose up --build

down:
    docker compose down

# --- Docker (production: pulls published images, builds nothing) ---
# Secrets come from the host environment — see .env.prod.example and docs/DEPLOY.md.
prod-pull:
    docker compose -f docker-compose.prod.yml pull

prod-up:
    docker compose -f docker-compose.prod.yml up -d

prod-down:
    docker compose -f docker-compose.prod.yml down

prod-logs:
    docker compose -f docker-compose.prod.yml logs -f

# Render the prod compose file with the current environment — catches a missing secret
# before anything starts.
prod-config:
    docker compose -f docker-compose.prod.yml config

# Build the images the way CI does, locally.
docker-build:
    docker build -f Dockerfile -t ovlive-platform-api:local .
    docker build -f Dockerfile.web -t ovlive-platform-web:local .

# --- Protobuf → TS (clients) ---
proto-ts:
    pnpm --filter @ovlive/api-types run generate

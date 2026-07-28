-- OVLive schema: public accounts + revocable API keys.

CREATE TABLE IF NOT EXISTS users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email         TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    is_admin      BOOLEAN NOT NULL DEFAULT FALSE,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_keys (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    prefix       TEXT NOT NULL,              -- first chars, shown in UIs
    key_hash     TEXT NOT NULL UNIQUE,       -- sha256 of the full key
    rate_per_min INTEGER NOT NULL DEFAULT 120,
    revoked      BOOLEAN NOT NULL DEFAULT FALSE,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_used_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);

-- Phase 4 (nice-to-have) — reserved, not yet written to:
-- last 50 trips per vehicle (public line, destination, per-stop arrival, skipped flag).
CREATE TABLE IF NOT EXISTS trip_history (
    id            BIGSERIAL PRIMARY KEY,
    vehicle_id    TEXT NOT NULL,             -- "<dataowner>:<vehicle_number>"
    line_public   TEXT,
    destination   TEXT,
    started_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    stops         JSONB NOT NULL DEFAULT '[]'::jsonb  -- [{stop_id, name, arrived_at, skipped}]
);
CREATE INDEX IF NOT EXISTS idx_trip_history_vehicle ON trip_history(vehicle_id, started_at DESC);

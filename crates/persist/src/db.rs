//! Postgres-backed accounts and revocable API keys.
//!
//! Uses runtime `sqlx` queries (not the compile-time macros) so the workspace builds
//! without a live database. Passwords are Argon2; API keys are stored as SHA-256 hashes
//! and only shown in full once at creation.

use anyhow::{anyhow, Context, Result};
use argon2::password_hash::{rand_core::OsRng, PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use chrono::{DateTime, Utc};
use rand::RngCore;
use serde::Serialize;
use sha2::{Digest, Sha256};
use sqlx::postgres::PgPoolOptions;
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct User {
    pub id: Uuid,
    pub email: String,
    #[serde(skip)]
    pub password_hash: String,
    pub is_admin: bool,
    pub is_active: bool,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct ApiKey {
    pub id: Uuid,
    pub user_id: Uuid,
    pub name: String,
    pub prefix: String,
    #[serde(skip)]
    pub key_hash: String,
    pub rate_per_min: i32,
    pub revoked: bool,
    pub created_at: DateTime<Utc>,
    pub last_used_at: Option<DateTime<Utc>>,
}

#[derive(Clone)]
pub struct Db {
    pool: PgPool,
}

fn hash_password(password: &str) -> Result<String> {
    let salt = SaltString::generate(&mut OsRng);
    Ok(Argon2::default()
        .hash_password(password.as_bytes(), &salt)
        .map_err(|e| anyhow!("hash password: {e}"))?
        .to_string())
}

fn verify_password(password: &str, hash: &str) -> bool {
    match PasswordHash::new(hash) {
        Ok(parsed) => Argon2::default()
            .verify_password(password.as_bytes(), &parsed)
            .is_ok(),
        Err(_) => false,
    }
}

fn sha256_hex(s: &str) -> String {
    let mut h = Sha256::new();
    h.update(s.as_bytes());
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

/// Generate a fresh API key. Returns `(full_plaintext, prefix, sha256_hash)`.
fn generate_key() -> (String, String, String) {
    let mut raw = [0u8; 24];
    OsRng.fill_bytes(&mut raw);
    let hex: String = raw.iter().map(|b| format!("{b:02x}")).collect();
    let full = format!("ovl_{hex}");
    let prefix = full.chars().take(12).collect();
    let hash = sha256_hex(&full);
    (full, prefix, hash)
}

impl Db {
    pub async fn connect(url: &str) -> Result<Self> {
        let pool = PgPoolOptions::new()
            .max_connections(10)
            .connect(url)
            .await
            .context("connect postgres")?;
        Ok(Self { pool })
    }

    pub async fn migrate(&self) -> Result<()> {
        sqlx::migrate!("../../migrations")
            .run(&self.pool)
            .await
            .context("run migrations")?;
        Ok(())
    }

    /// Create the admin account if the users table is empty.
    pub async fn seed_admin(&self, email: &str, password: &str) -> Result<()> {
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM users")
            .fetch_one(&self.pool)
            .await?;
        if count > 0 {
            return Ok(());
        }
        let hash = hash_password(password)?;
        sqlx::query(
            "INSERT INTO users (email, password_hash, is_admin) VALUES ($1, $2, TRUE)",
        )
        .bind(email)
        .bind(hash)
        .execute(&self.pool)
        .await?;
        tracing::info!(target: "ovlive::db", "seeded admin account {email}");
        Ok(())
    }

    pub async fn register(&self, email: &str, password: &str) -> Result<User> {
        let hash = hash_password(password)?;
        let user = sqlx::query_as::<_, User>(
            "INSERT INTO users (email, password_hash) VALUES ($1, $2) RETURNING *",
        )
        .bind(email)
        .bind(hash)
        .fetch_one(&self.pool)
        .await
        .context("insert user (email may already exist)")?;
        Ok(user)
    }

    pub async fn authenticate(&self, email: &str, password: &str) -> Result<Option<User>> {
        let user = sqlx::query_as::<_, User>("SELECT * FROM users WHERE email = $1")
            .bind(email)
            .fetch_optional(&self.pool)
            .await?;
        Ok(user.filter(|u| u.is_active && verify_password(password, &u.password_hash)))
    }

    pub async fn create_api_key(
        &self,
        user_id: Uuid,
        name: &str,
        rate_per_min: i32,
    ) -> Result<(ApiKey, String)> {
        let (full, prefix, hash) = generate_key();
        let key = sqlx::query_as::<_, ApiKey>(
            "INSERT INTO api_keys (user_id, name, prefix, key_hash, rate_per_min)
             VALUES ($1, $2, $3, $4, $5) RETURNING *",
        )
        .bind(user_id)
        .bind(name)
        .bind(prefix)
        .bind(hash)
        .bind(rate_per_min)
        .fetch_one(&self.pool)
        .await?;
        Ok((key, full))
    }

    pub async fn list_keys(&self, user_id: Uuid) -> Result<Vec<ApiKey>> {
        Ok(sqlx::query_as::<_, ApiKey>(
            "SELECT * FROM api_keys WHERE user_id = $1 ORDER BY created_at DESC",
        )
        .bind(user_id)
        .fetch_all(&self.pool)
        .await?)
    }

    /// Delete a key the user owns. Returns true if a row was removed.
    pub async fn delete_own_key(&self, user_id: Uuid, key_id: Uuid) -> Result<bool> {
        let res = sqlx::query("DELETE FROM api_keys WHERE id = $1 AND user_id = $2")
            .bind(key_id)
            .bind(user_id)
            .execute(&self.pool)
            .await?;
        Ok(res.rows_affected() > 0)
    }

    /// Resolve a plaintext API key to its owner, if valid and not revoked.
    /// Also stamps `last_used_at`.
    pub async fn authenticate_key(&self, plaintext: &str) -> Result<Option<(ApiKey, User)>> {
        let hash = sha256_hex(plaintext);
        let key = sqlx::query_as::<_, ApiKey>(
            "SELECT * FROM api_keys WHERE key_hash = $1 AND revoked = FALSE",
        )
        .bind(&hash)
        .fetch_optional(&self.pool)
        .await?;
        let Some(key) = key else { return Ok(None) };
        let user = sqlx::query_as::<_, User>("SELECT * FROM users WHERE id = $1 AND is_active = TRUE")
            .bind(key.user_id)
            .fetch_optional(&self.pool)
            .await?;
        let Some(user) = user else { return Ok(None) };
        let _ = sqlx::query("UPDATE api_keys SET last_used_at = now() WHERE id = $1")
            .bind(key.id)
            .execute(&self.pool)
            .await;
        Ok(Some((key, user)))
    }

    // --- admin ---

    pub async fn admin_list_users(&self) -> Result<Vec<User>> {
        Ok(sqlx::query_as::<_, User>("SELECT * FROM users ORDER BY created_at DESC")
            .fetch_all(&self.pool)
            .await?)
    }

    pub async fn admin_list_keys(&self) -> Result<Vec<ApiKey>> {
        Ok(sqlx::query_as::<_, ApiKey>("SELECT * FROM api_keys ORDER BY created_at DESC")
            .fetch_all(&self.pool)
            .await?)
    }

    /// Revoke any key by id (admin). Returns true if a row changed.
    pub async fn admin_set_key_revoked(&self, key_id: Uuid, revoked: bool) -> Result<bool> {
        let res = sqlx::query("UPDATE api_keys SET revoked = $2 WHERE id = $1")
            .bind(key_id)
            .bind(revoked)
            .execute(&self.pool)
            .await?;
        Ok(res.rows_affected() > 0)
    }

    pub async fn admin_set_user_active(&self, user_id: Uuid, active: bool) -> Result<bool> {
        let res = sqlx::query("UPDATE users SET is_active = $2 WHERE id = $1")
            .bind(user_id)
            .bind(active)
            .execute(&self.pool)
            .await?;
        Ok(res.rows_affected() > 0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn key_generation_is_prefixed_and_hashed() {
        let (full, prefix, hash) = generate_key();
        assert!(full.starts_with("ovl_"));
        assert!(full.starts_with(&prefix));
        assert_eq!(hash, sha256_hex(&full));
        assert_eq!(hash.len(), 64);
    }

    #[test]
    fn password_round_trip() {
        let h = hash_password("s3cret").unwrap();
        assert!(verify_password("s3cret", &h));
        assert!(!verify_password("wrong", &h));
    }
}

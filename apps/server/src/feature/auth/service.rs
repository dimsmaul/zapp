use std::num::NonZeroU32;
use axum::http::StatusCode;
use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use mongodb::{Database, bson::{DateTime, doc, oid::ObjectId}};
use rand::{TryRngCore, rngs::OsRng};
use ring::pbkdf2;
use serde_json::{Value, json};
use tokio::sync::Semaphore;

use super::{model::{Credentials, normalize_email}, repository};
use crate::{adapter::http::ApiError, feature::capture::new_secret};

pub(super) const TOO_MANY_ATTEMPTS: ApiError = ApiError(
    StatusCode::TOO_MANY_REQUESTS, "TOO_MANY_ATTEMPTS", "Try again later.",
);
const INVALID_CREDENTIALS: ApiError = ApiError(
    StatusCode::UNAUTHORIZED, "INVALID_CREDENTIALS", "Email or password is incorrect.",
);
const ITERATIONS: NonZeroU32 = NonZeroU32::new(600_000).unwrap();
static HASH_CAPACITY: Semaphore = Semaphore::const_new(4);

pub(super) async fn identify(db: &Database, input: Credentials, register: bool) -> Result<Value, ApiError> {
    let email = normalize_email(&input.email).ok_or(ApiError::invalid("Enter a valid email address."))?;
    if input.password.len() > 1024 || (register && input.password.chars().count() < 12) {
        return Err(ApiError::invalid("Use a password with at least 12 characters and at most 1024 bytes."));
    }
    repository::limit_attempt(db, &email).await?;
    let permit = HASH_CAPACITY.try_acquire().map_err(|_| TOO_MANY_ATTEMPTS)?;
    let password = input.password;
    let user_id = if register {
        let hash = tokio::task::spawn_blocking(move || {
            let _permit = permit;
            hash_password(&password)
        })
            .await.map_err(|_| ApiError::INTERNAL)??;
        let user_id = ObjectId::new().to_hex();
        repository::insert_user(db, doc! {
            "_id": &user_id, "email": &email, "passwordHash": hash, "createdAt": DateTime::now()
        }).await?;
        user_id
    } else {
        let user = repository::user_by_email(db, &email).await?;
        let hash = user.as_ref().and_then(|user| user.get_str("passwordHash").ok()).map(str::to_owned);
        let verified = tokio::task::spawn_blocking(move || {
            let _permit = permit;
            verify_password(&password, hash.as_deref())
        })
            .await.map_err(|_| ApiError::INTERNAL)?;
        if !verified {
            return Err(INVALID_CREDENTIALS);
        }
        user.and_then(|user| user.get_str("_id").ok().map(str::to_owned)).ok_or(INVALID_CREDENTIALS)?
    };
    let token = new_secret("zs_").map_err(|_| ApiError::INTERNAL)?;
    let expires_at = DateTime::from_millis(DateTime::now().timestamp_millis() + 86_400_000);
    repository::begin_session(db, &user_id, &token, expires_at).await?;
    Ok(json!({ "token": token, "expiresAt": expires_at.try_to_rfc3339_string().map_err(|_| ApiError::INTERNAL)?,
        "user": { "id": user_id, "email": email }, "workspaceId": null }))
}

fn hash_password(password: &str) -> Result<String, ApiError> {
    let mut salt = [0; 16];
    OsRng.try_fill_bytes(&mut salt).map_err(|_| ApiError::INTERNAL)?;
    let mut hash = [0; 32];
    pbkdf2::derive(pbkdf2::PBKDF2_HMAC_SHA256, ITERATIONS, &salt, password.as_bytes(), &mut hash);
    Ok(format!("pbkdf2-sha256$600000${}${}", URL_SAFE_NO_PAD.encode(salt), URL_SAFE_NO_PAD.encode(hash)))
}

fn verify_password(password: &str, stored: Option<&str>) -> bool {
    let parsed = stored.and_then(|stored| {
        let values = stored.strip_prefix("pbkdf2-sha256$600000$")?;
        let (salt, hash) = values.split_once('$')?;
        let salt: [u8; 16] = URL_SAFE_NO_PAD.decode(salt).ok()?.try_into().ok()?;
        let hash: [u8; 32] = URL_SAFE_NO_PAD.decode(hash).ok()?.try_into().ok()?;
        Some((salt, hash))
    });
    let (salt, hash) = parsed.unwrap_or_default();
    let verified = pbkdf2::verify(pbkdf2::PBKDF2_HMAC_SHA256, ITERATIONS, &salt, password.as_bytes(), &hash);
    parsed.is_some() && verified.is_ok()
}

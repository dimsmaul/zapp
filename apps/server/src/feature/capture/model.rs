use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use rand::{TryRngCore, rngs::OsRng};
use sha2::{Digest, Sha256};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use url::Url;

pub(super) const TOKEN_LIFETIME_MS: i64 = 15 * 60 * 1000;

pub(super) struct CaptureKey {
    pub id: String,
    pub workspace_id: String,
    pub allowed_origins: Vec<String>,
}

pub(super) struct CaptureToken {
    pub draft_id: String,
    pub expires_at_ms: i64,
}

pub(super) struct DraftOwner<'a> {
    pub workspace_id: &'a str,
    pub key_id: Option<&'a str>,
    pub reporter_id: Option<&'a str>,
}

impl<'a> DraftOwner<'a> {
    pub fn embed(key: &'a CaptureKey) -> Self {
        Self { workspace_id: &key.workspace_id, key_id: Some(&key.id), reporter_id: None }
    }

    pub fn member(workspace_id: &'a str, user_id: &'a str) -> Self {
        Self { workspace_id, key_id: None, reporter_id: Some(user_id) }
    }
}

pub(super) struct DraftArtifacts {
    pub media: String,
    pub debugger: Option<String>,
    pub content_type: String,
}

pub(super) struct DraftDetails {
    pub attachment_type: String,
    pub visibility: String,
    pub title: Option<String>,
    pub description: Option<String>,
    pub folder_id: Option<String>,
    pub environment: Option<mongodb::bson::Document>,
}

pub(super) struct Draft {
    pub artifacts: DraftArtifacts,
    pub details: DraftDetails,
}

pub(super) struct PublishedMedia<'a> {
    pub key: &'a str,
    pub size: u64,
}

pub(super) enum Publication {
    MissingDraft,
    Published { media_key: Option<String> },
}

pub(super) enum CaptureError {
    InvalidKey,
    ForbiddenOrigin,
    TokenGeneration,
    TokenExpirationEncoding,
    InvalidToken,
    InvalidUpload,
    DraftConflict,
    DraftNotFound,
    MediaNotUploaded,
    InvalidMedia(MediaValidation),
    StorageUnavailable,
    DatabaseUnavailable,
}

#[derive(Debug, PartialEq, Eq)]
pub(super) enum MediaValidation {
    Size,
    ContentType,
}

pub(super) fn select_media_type<'a>(
    attachment_type: &str,
    provided: Option<&'a str>,
) -> Option<&'a str> {
    let (fallback, allowed): (&str, &[&str]) = match attachment_type {
        "screenshot" => ("image/png", &["image/png", "image/jpeg", "image/webp"]),
        "video" => ("video/webm", &["video/webm", "video/mp4"]),
        _ => return None,
    };
    let media_type = content_type(provided.unwrap_or(fallback))?;
    allowed.contains(&media_type).then_some(media_type)
}

pub(super) fn validate_media(
    size: u64,
    actual: Option<&str>,
    expected: &str,
) -> Result<(), MediaValidation> {
    if size == 0 || size > 100 * 1024 * 1024 {
        return Err(MediaValidation::Size);
    }
    if actual.and_then(content_type) != Some(expected) {
        return Err(MediaValidation::ContentType);
    }
    Ok(())
}

fn content_type(value: &str) -> Option<&str> {
    value.split(';').next().map(str::trim)
}

pub(super) fn upload_url_lifetime(now_ms: i64, expires_at_ms: i64) -> Duration {
    Duration::from_secs((expires_at_ms.saturating_sub(now_ms) / 1000).clamp(0, 600) as u64)
}

pub(super) fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}

pub fn credential_hash(secret: &str) -> String {
    format!("{:x}", Sha256::digest(secret.as_bytes()))
}

pub fn new_secret(prefix: &str) -> Result<String, Box<dyn std::error::Error + Send + Sync>> {
    let mut bytes = [0u8; 32];
    OsRng.try_fill_bytes(&mut bytes)?;
    Ok(format!("{prefix}{}", URL_SAFE_NO_PAD.encode(bytes)))
}

pub fn normalize_origin(value: &str) -> Option<String> {
    let url = Url::parse(value).ok()?;
    if !matches!(url.scheme(), "http" | "https")
        || !url.username().is_empty()
        || url.password().is_some()
        || url.path() != "/"
        || url.query().is_some()
        || url.fragment().is_some()
    {
        return None;
    }
    Some(url.origin().ascii_serialization())
}

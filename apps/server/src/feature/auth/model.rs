use axum::{extract::FromRequestParts, http::{HeaderMap, header, request::Parts}};
use serde::Deserialize;
use crate::adapter::http::{ApiError, AppState};

use super::repository;

#[derive(Deserialize)]
pub(super) struct Credentials {
    pub email: String,
    pub password: String,
}

pub(crate) struct Session {
    pub id: String,
    pub user_id: String,
    pub workspace_id: Option<String>,
}

impl FromRequestParts<AppState> for Session {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &AppState) -> Result<Self, ApiError> {
        let token = bearer_token(&parts.headers).ok_or(ApiError::UNAUTHORIZED)?;
        repository::find_session(&state.db, token).await?.ok_or(ApiError::UNAUTHORIZED)
    }
}

pub(crate) fn bearer_token(headers: &HeaderMap) -> Option<&str> {
    let value = headers.get(header::AUTHORIZATION)?.to_str().ok()?;
    let (scheme, token) = value.split_once(' ')?;
    (scheme.eq_ignore_ascii_case("bearer")
        && !token.is_empty() && token.len() <= 256
        && !token.bytes().any(|byte| byte.is_ascii_whitespace()))
        .then_some(token)
}

pub(crate) fn normalize_email(email: &str) -> Option<String> {
    let email = email.trim();
    let (local, domain) = email.split_once('@')?;
    if email.len() > 254 || !email.is_ascii() || local.is_empty() || local.len() > 64
        || !domain.contains('.') || domain.starts_with('.') || domain.ends_with('.')
        || domain.contains('@')
        || email.bytes().any(|byte| byte.is_ascii_whitespace() || byte.is_ascii_control()) {
        return None;
    }
    Some(email.to_ascii_lowercase())
}

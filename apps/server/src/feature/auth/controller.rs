use axum::{Json, extract::State, http::{StatusCode, header}, response::IntoResponse};
use serde_json::json;

use super::{model::{Credentials, Session}, repository, service};
use crate::adapter::http::{ApiError, AppState};

pub(super) async fn register(State(state): State<AppState>, Json(input): Json<Credentials>) -> Result<impl IntoResponse, ApiError> {
    Ok((StatusCode::CREATED, [(header::CACHE_CONTROL, "no-store")], Json(service::identify(&state.db, input, true).await?)))
}

pub(super) async fn login(State(state): State<AppState>, Json(input): Json<Credentials>) -> Result<impl IntoResponse, ApiError> {
    Ok(([(header::CACHE_CONTROL, "no-store")], Json(service::identify(&state.db, input, false).await?)))
}

pub(super) async fn extension_session(State(state): State<AppState>, session: Session) -> Result<impl IntoResponse, ApiError> {
    Ok((StatusCode::CREATED, [(header::CACHE_CONTROL, "no-store")], Json(service::derive_session(&state.db, &session).await?)))
}

/// Public. Lets the extension find the website that serves the sign-in page for this server.
pub(super) async fn config(State(state): State<AppState>) -> impl IntoResponse {
    ([(header::CACHE_CONTROL, "no-store")], Json(json!({ "webOrigin": state.web_origin })))
}

pub(super) async fn logout(State(state): State<AppState>, session: Session) -> Result<StatusCode, ApiError> {
    repository::end_session(&state.db, &session).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub(super) async fn current(State(state): State<AppState>, session: Session) -> Result<impl IntoResponse, ApiError> {
    let email = repository::user_email(&state.db, &session.user_id).await?;
    Ok(([(header::CACHE_CONTROL, "no-store")], Json(json!({
        "user": { "id": session.user_id, "email": email }, "workspaceId": session.workspace_id,
    }))))
}

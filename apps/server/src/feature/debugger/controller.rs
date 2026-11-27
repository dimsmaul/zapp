use axum::{Json, extract::{Path, Query, State}, http::{HeaderMap, header}, response::IntoResponse};
use super::repository::{self, Page};
use crate::{adapter::http::{ApiError, AppState}, reports::visible_report};

pub(super) async fn events(State(state): State<AppState>, Path(id): Path<String>, headers: HeaderMap, Query(page): Query<Page>) -> Result<impl IntoResponse, ApiError> {
    list(state, id, headers, page, None).await
}

pub(super) async fn network(State(state): State<AppState>, Path(id): Path<String>, headers: HeaderMap, Query(page): Query<Page>) -> Result<impl IntoResponse, ApiError> {
    list(state, id, headers, page, Some("network")).await
}

async fn list(state: AppState, id: String, headers: HeaderMap, page: Page, category: Option<&str>) -> Result<([(header::HeaderName, &'static str); 1], Json<serde_json::Value>), ApiError> {
    let report = visible_report(&state.db, &headers, &id).await?;
    let payload = repository::page(&state.db, &report, category, page).await?;
    Ok(([(header::CACHE_CONTROL, "private, no-store")], Json(payload)))
}

pub(super) async fn detail(State(state): State<AppState>, Path((id, request_id)): Path<(String, String)>, headers: HeaderMap) -> Result<impl IntoResponse, ApiError> {
    visible_report(&state.db, &headers, &id).await?;
    let detail = repository::detail(&state.db, &id, &request_id).await?;
    Ok(([(header::CACHE_CONTROL, "private, no-store")], Json(detail)))
}

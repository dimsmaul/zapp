//! Personal access tokens: long-lived credentials for agents that connect to the MCP endpoint.
//! They authenticate `/mcp` only. Every other route still needs a signed-in session.

use axum::{
    Json, Router,
    extract::{Path, State},
    http::{HeaderMap, StatusCode, header},
    response::IntoResponse,
    routing::{delete, get},
};
use futures_util::TryStreamExt;
use mongodb::{Database, bson::{DateTime, Document, doc, oid::ObjectId}};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::{
    adapter::http::{ApiError, AppState},
    feature::{auth::{Session, bearer_token}, capture::{credential_hash, new_secret}},
};

const MAX_TOKENS: u64 = 20;
const DAY_MS: i64 = 86_400_000;

pub(crate) fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/tokens", get(list).post(create))
        .route("/api/v1/tokens/{id}", delete(revoke))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateInput { name: String, expires_in_days: Option<u32> }

fn view(token: &Document) -> Value {
    let date = |key: &str| token.get_datetime(key).ok().and_then(|value| value.try_to_rfc3339_string().ok());
    json!({
        "id": token.get_str("publicId").ok(), "name": token.get_str("name").ok(),
        "createdAt": date("createdAt"), "lastUsedAt": date("lastUsedAt"), "expiresAt": date("expiresAt"),
    })
}

async fn list(State(state): State<AppState>, session: Session) -> Result<Json<Value>, ApiError> {
    let tokens: Vec<Document> = state.db.collection::<Document>("api_tokens")
        .find(doc! { "userId": &session.user_id }).sort(doc! { "createdAt": -1 }).await?.try_collect().await?;
    Ok(Json(json!({ "items": tokens.iter().map(view).collect::<Vec<_>>() })))
}

async fn create(State(state): State<AppState>, session: Session, Json(input): Json<CreateInput>) -> Result<impl IntoResponse, ApiError> {
    let name = input.name.trim();
    if name.is_empty() || name.len() > 80 {
        return Err(ApiError::invalid("Token name must be between 1 and 80 bytes."));
    }
    if input.expires_in_days.is_some_and(|days| !(1..=365).contains(&days)) {
        return Err(ApiError::invalid("Expiry must be between 1 and 365 days."));
    }
    let tokens = state.db.collection::<Document>("api_tokens");
    if tokens.count_documents(doc! { "userId": &session.user_id }).await? >= MAX_TOKENS {
        return Err(ApiError::conflict("You have reached the limit of 20 tokens. Revoke one first."));
    }
    let secret = new_secret("zk_").map_err(|_| ApiError::INTERNAL)?;
    let now = DateTime::now();
    let mut record = doc! {
        "_id": credential_hash(&secret), "publicId": ObjectId::new().to_hex(),
        "userId": &session.user_id, "name": name, "createdAt": now,
    };
    if let Some(days) = input.expires_in_days {
        record.insert("expiresAt", DateTime::from_millis(now.timestamp_millis() + i64::from(days) * DAY_MS));
    }
    tokens.insert_one(&record).await?;
    // The secret is returned once and only its hash is stored.
    let mut body = view(&record);
    body["token"] = json!(secret);
    Ok((StatusCode::CREATED, [(header::CACHE_CONTROL, "no-store")], Json(body)))
}

async fn revoke(State(state): State<AppState>, session: Session, Path(id): Path<String>) -> Result<StatusCode, ApiError> {
    let result = state.db.collection::<Document>("api_tokens")
        .delete_one(doc! { "publicId": id, "userId": &session.user_id }).await?;
    if result.deleted_count == 0 { Err(ApiError::NOT_FOUND) } else { Ok(StatusCode::NO_CONTENT) }
}

/// The user behind a valid, unexpired personal access token in the request, if any. Records the use.
pub(crate) async fn user_for_token(db: &Database, headers: &HeaderMap) -> Result<Option<String>, ApiError> {
    let Some(secret) = bearer_token(headers).filter(|token| token.starts_with("zk_")) else { return Ok(None) };
    let now = DateTime::now();
    let token = db.collection::<Document>("api_tokens").find_one_and_update(
        doc! { "_id": credential_hash(secret), "$or": [{ "expiresAt": { "$exists": false } }, { "expiresAt": { "$gt": now } }] },
        doc! { "$set": { "lastUsedAt": now } },
    ).await?;
    Ok(token.and_then(|token| token.get_str("userId").ok().map(str::to_owned)))
}

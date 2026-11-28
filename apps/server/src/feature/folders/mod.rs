//! Folders group a workspace's reports. A report is in at most one folder (`folderId`).

use axum::{Json, Router, extract::{Path, State}, http::StatusCode, routing::{get, patch}};
use futures_util::TryStreamExt;
use mongodb::{Database, bson::{DateTime, Document, doc, oid::ObjectId}, options::ReturnDocument};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::{
    adapter::http::{ApiError, AppState},
    feature::{auth::Session, workspaces::{active_workspace, membership}},
};

pub(crate) fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/folders", get(list).post(create))
        .route("/api/v1/folders/{id}", patch(rename).delete(remove))
}

#[derive(Deserialize)]
struct NameInput { name: String }

/// True when `folder` exists in `workspace`. Reports and recording links may only point at such folders.
pub(crate) async fn exists(db: &Database, workspace: &str, folder: &str) -> Result<bool, ApiError> {
    Ok(db.collection::<Document>("folders").find_one(doc! { "_id": folder, "workspaceId": workspace }).await?.is_some())
}

fn clean_name(name: &str) -> Result<String, ApiError> {
    let name = name.trim();
    if name.is_empty() || name.chars().count() > 80 {
        return Err(ApiError::invalid("Use a folder name of 1 to 80 characters."));
    }
    Ok(name.to_owned())
}

fn view(folder: &Document, count: i64) -> Value {
    json!({
        "id": folder.get_str("_id").ok(), "name": folder.get_str("name").ok(), "reportCount": count,
        "createdAt": folder.get_datetime("createdAt").ok().and_then(|date| date.try_to_rfc3339_string().ok()),
    })
}

async fn list(State(state): State<AppState>, session: Session) -> Result<Json<Value>, ApiError> {
    let workspace = active_workspace(&state.db, &session).await?;
    let folders: Vec<Document> = state.db.collection::<Document>("folders").find(doc! { "workspaceId": workspace })
        .sort(doc! { "name": 1, "_id": 1 }).await?.try_collect().await?;
    let counts: Vec<Document> = state.db.collection::<Document>("reports").aggregate(vec![
        doc! { "$match": { "workspaceId": workspace, "deletedAt": null, "folderId": { "$ne": null } } },
        doc! { "$group": { "_id": "$folderId", "count": { "$sum": 1 } } },
    ]).await?.try_collect().await?;
    let count = |id: &str| counts.iter().find(|entry| entry.get_str("_id") == Ok(id))
        .and_then(|entry| entry.get_i32("count").ok()).map_or(0, i64::from);
    let items: Vec<Value> = folders.iter().map(|folder| view(folder, folder.get_str("_id").map_or(0, count))).collect();
    Ok(Json(json!({ "items": items })))
}

async fn create(State(state): State<AppState>, session: Session, Json(input): Json<NameInput>) -> Result<(StatusCode, Json<Value>), ApiError> {
    let workspace = active_workspace(&state.db, &session).await?;
    let folder = doc! {
        "_id": ObjectId::new().to_hex(), "workspaceId": workspace, "name": clean_name(&input.name)?,
        "createdBy": &session.user_id, "createdAt": DateTime::now(),
    };
    state.db.collection::<Document>("folders").insert_one(&folder).await?;
    Ok((StatusCode::CREATED, Json(view(&folder, 0))))
}

/// The folder's creator, and workspace owners and admins, may rename or delete it.
async fn manageable(db: &Database, session: &Session, id: &str) -> Result<(Document, String), ApiError> {
    let workspace = active_workspace(db, session).await?.to_owned();
    let folder = db.collection::<Document>("folders").find_one(doc! { "_id": id, "workspaceId": &workspace }).await?
        .ok_or(ApiError::NOT_FOUND)?;
    let admin = matches!(membership(db, &session.user_id, &workspace).await?.as_deref(), Some("owner" | "admin"));
    if !admin && folder.get_str("createdBy") != Ok(session.user_id.as_str()) {
        return Err(ApiError::FORBIDDEN);
    }
    Ok((folder, workspace))
}

async fn rename(State(state): State<AppState>, session: Session, Path(id): Path<String>, Json(input): Json<NameInput>) -> Result<Json<Value>, ApiError> {
    manageable(&state.db, &session, &id).await?;
    let folder = state.db.collection::<Document>("folders")
        .find_one_and_update(doc! { "_id": &id }, doc! { "$set": { "name": clean_name(&input.name)? } })
        .return_document(ReturnDocument::After).await?.ok_or(ApiError::NOT_FOUND)?;
    Ok(Json(view(&folder, 0)))
}

/// Deleting a folder keeps its reports. They simply stop being in a folder.
async fn remove(State(state): State<AppState>, session: Session, Path(id): Path<String>) -> Result<StatusCode, ApiError> {
    let (_, workspace) = manageable(&state.db, &session, &id).await?;
    for collection in ["reports", "recording_links"] {
        state.db.collection::<Document>(collection)
            .update_many(doc! { "workspaceId": &workspace, "folderId": &id }, doc! { "$unset": { "folderId": "" } }).await?;
    }
    state.db.collection::<Document>("folders").delete_one(doc! { "_id": &id, "workspaceId": &workspace }).await?;
    Ok(StatusCode::NO_CONTENT)
}

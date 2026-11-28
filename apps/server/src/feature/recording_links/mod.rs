//! Recording links are shareable addresses (`{web}/r/{token}`) that open the Zapp extension on a teammate's
//! machine, pointed at a workspace and optionally a folder. The person opening one must be signed in and
//! a member of the workspace; the link does not give anyone access.

use axum::{Json, Router, extract::{Path, State}, http::StatusCode, routing::{delete, get}};
use futures_util::TryStreamExt;
use mongodb::{Database, bson::{DateTime, Document, doc, oid::ObjectId}};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::{
    adapter::http::{ApiError, AppState},
    feature::{auth::Session, capture::new_secret, folders, workspaces::{active_workspace, membership}},
};

pub(crate) fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/recording-links", get(list).post(create))
        .route("/api/v1/recording-links/{id}", delete(revoke))
        .route("/api/v1/recording-links/by-token/{token}", get(open))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CreateInput { name: Option<String>, folder_id: Option<String> }

async fn folder_name(db: &Database, workspace: &str, folder: Option<&str>) -> Result<Option<String>, ApiError> {
    let Some(folder) = folder else { return Ok(None) };
    Ok(db.collection::<Document>("folders").find_one(doc! { "_id": folder, "workspaceId": workspace }).await?
        .and_then(|folder| folder.get_str("name").ok().map(str::to_owned)))
}

async fn view(state: &AppState, link: &Document) -> Result<Value, ApiError> {
    let workspace = link.get_str("workspaceId").unwrap_or_default();
    let folder = link.get_str("folderId").ok();
    Ok(json!({
        "id": link.get_str("_id").ok(), "name": link.get_str("name").ok(),
        "folderId": folder, "folderName": folder_name(&state.db, workspace, folder).await?,
        "url": format!("{}/r/{}", state.web_origin, link.get_str("token").unwrap_or_default()),
        "createdAt": link.get_datetime("createdAt").ok().and_then(|date| date.try_to_rfc3339_string().ok()),
    }))
}

async fn list(State(state): State<AppState>, session: Session) -> Result<Json<Value>, ApiError> {
    let workspace = active_workspace(&state.db, &session).await?;
    let links: Vec<Document> = state.db.collection::<Document>("recording_links")
        .find(doc! { "workspaceId": workspace, "revokedAt": null }).sort(doc! { "createdAt": -1, "_id": -1 })
        .await?.try_collect().await?;
    let mut items = Vec::with_capacity(links.len());
    for link in &links {
        items.push(view(&state, link).await?);
    }
    Ok(Json(json!({ "items": items })))
}

async fn create(State(state): State<AppState>, session: Session, Json(input): Json<CreateInput>) -> Result<(StatusCode, Json<Value>), ApiError> {
    let workspace = active_workspace(&state.db, &session).await?;
    if let Some(folder) = input.folder_id.as_deref() {
        if !folders::exists(&state.db, workspace, folder).await? {
            return Err(ApiError::invalid("That folder does not exist."));
        }
    }
    let name = input.name.as_deref().map(str::trim).filter(|name| !name.is_empty());
    if name.is_some_and(|name| name.chars().count() > 80) {
        return Err(ApiError::invalid("Use a name of at most 80 characters."));
    }
    let link = doc! {
        "_id": ObjectId::new().to_hex(), "workspaceId": workspace, "token": new_secret("zr_").map_err(|_| ApiError::INTERNAL)?,
        "name": name, "folderId": input.folder_id.as_deref(), "revokedAt": null,
        "createdBy": &session.user_id, "createdAt": DateTime::now(),
    };
    state.db.collection::<Document>("recording_links").insert_one(&link).await?;
    Ok((StatusCode::CREATED, Json(view(&state, &link).await?)))
}

/// The link's creator, and workspace owners and admins, may revoke it.
async fn revoke(State(state): State<AppState>, session: Session, Path(id): Path<String>) -> Result<StatusCode, ApiError> {
    let workspace = active_workspace(&state.db, &session).await?;
    let links = state.db.collection::<Document>("recording_links");
    let filter = doc! { "_id": &id, "workspaceId": workspace, "revokedAt": null };
    let link = links.find_one(filter.clone()).await?.ok_or(ApiError::NOT_FOUND)?;
    let admin = matches!(membership(&state.db, &session.user_id, workspace).await?.as_deref(), Some("owner" | "admin"));
    if !admin && link.get_str("createdBy") != Ok(session.user_id.as_str()) {
        return Err(ApiError::FORBIDDEN);
    }
    links.update_one(filter, doc! { "$set": { "revokedAt": DateTime::now() } }).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// What the `/r/{token}` page needs. Any signed-in user can look a link up, but only members can record into it.
async fn open(State(state): State<AppState>, session: Session, Path(token): Path<String>) -> Result<Json<Value>, ApiError> {
    if token.len() > 128 {
        return Err(ApiError::NOT_FOUND);
    }
    let link = state.db.collection::<Document>("recording_links")
        .find_one(doc! { "token": &token, "revokedAt": null }).await?.ok_or(ApiError::NOT_FOUND)?;
    let workspace = link.get_str("workspaceId").map_err(|_| ApiError::NOT_FOUND)?;
    let name = state.db.collection::<Document>("workspaces").find_one(doc! { "_id": workspace }).await?
        .and_then(|workspace| workspace.get_str("name").ok().map(str::to_owned));
    let folder = link.get_str("folderId").ok();
    Ok(Json(json!({
        "workspaceId": workspace, "workspaceName": name, "folderId": folder,
        "folderName": folder_name(&state.db, workspace, folder).await?,
        "member": membership(&state.db, &session.user_id, workspace).await?.is_some(),
    })))
}

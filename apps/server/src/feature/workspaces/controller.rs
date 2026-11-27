use axum::{Json, extract::{Path, State}, http::{StatusCode, header}, response::IntoResponse};
use futures_util::TryStreamExt;
use mongodb::bson::{DateTime, Document, doc, oid::ObjectId};
use serde::Deserialize;
use serde_json::{Value, json};

use super::repository;
use crate::{
    adapter::http::{ApiError, AppState},
    feature::{auth::{Session, normalize_email}, capture::{credential_hash, new_secret, normalize_origin}},
};

#[derive(Deserialize)]
pub(super) struct WorkspaceInput { name: String }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SelectInput { workspace_id: String }

#[derive(Deserialize)]
pub(super) struct InviteInput { email: String }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct KeyInput { allowed_origins: Vec<String> }

pub(super) async fn list(State(state): State<AppState>, session: Session) -> Result<Json<Value>, ApiError> {
    Ok(Json(json!({ "items": repository::list(&state.db, &session.user_id).await? })))
}

pub(super) async fn create(State(state): State<AppState>, session: Session, Json(input): Json<WorkspaceInput>) -> Result<impl IntoResponse, ApiError> {
    let name = input.name.trim();
    if name.is_empty() || name.len() > 200 {
        return Err(ApiError::invalid("Workspace name must be between 1 and 200 bytes."));
    }
    let id = ObjectId::new().to_hex();
    let now = DateTime::now();
    repository::create(&state.db,
        doc! { "_id": &id, "name": name, "createdAt": now },
        doc! { "_id": ObjectId::new().to_hex(), "workspaceId": &id, "userId": &session.user_id, "role": "owner", "createdAt": now },
    ).await?;
    Ok((StatusCode::CREATED, Json(json!({ "id": id, "name": name, "role": "owner" }))))
}

pub(super) async fn select(State(state): State<AppState>, session: Session, Json(input): Json<SelectInput>) -> Result<Json<Value>, ApiError> {
    repository::select(&state.db, &session, &input.workspace_id).await?;
    Ok(Json(json!({ "workspaceId": input.workspace_id })))
}

pub(super) async fn members(State(state): State<AppState>, session: Session, Path(id): Path<String>) -> Result<Json<Value>, ApiError> {
    repository::membership(&state.db, &session.user_id, &id).await?.ok_or(ApiError::NOT_FOUND)?;
    Ok(Json(json!({ "items": repository::members(&state.db, &id).await? })))
}

/// Owners can remove anyone but an owner. Admins can remove regular members only.
pub(super) async fn remove_member(State(state): State<AppState>, session: Session, Path((id, user)): Path<(String, String)>) -> Result<StatusCode, ApiError> {
    let actor = repository::membership(&state.db, &session.user_id, &id).await?.ok_or(ApiError::NOT_FOUND)?;
    if !matches!(actor.as_str(), "owner" | "admin") {
        return Err(ApiError::FORBIDDEN);
    }
    let target = repository::membership(&state.db, &user, &id).await?.ok_or(ApiError::NOT_FOUND)?;
    if target == "owner" || (target == "admin" && actor != "owner") {
        return Err(ApiError::FORBIDDEN);
    }
    repository::remove_member(&state.db, &id, &user).await?;
    Ok(StatusCode::NO_CONTENT)
}

#[derive(Deserialize)]
pub(super) struct RoleInput { role: String }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct SettingsInput { name: Option<String>, default_visibility: Option<String> }

/// Only owners change roles, and an owner's role cannot be changed.
pub(super) async fn change_role(State(state): State<AppState>, session: Session, Path((id, user)): Path<(String, String)>, Json(input): Json<RoleInput>) -> Result<Json<Value>, ApiError> {
    let actor = repository::membership(&state.db, &session.user_id, &id).await?.ok_or(ApiError::NOT_FOUND)?;
    if actor != "owner" {
        return Err(ApiError::FORBIDDEN);
    }
    if !matches!(input.role.as_str(), "admin" | "member") {
        return Err(ApiError::invalid("Role must be admin or member."));
    }
    let target = repository::membership(&state.db, &user, &id).await?.ok_or(ApiError::NOT_FOUND)?;
    if target == "owner" {
        return Err(ApiError::FORBIDDEN);
    }
    state.db.collection::<Document>("workspace_members")
        .update_one(doc! { "workspaceId": &id, "userId": &user }, doc! { "$set": { "role": &input.role } }).await?;
    Ok(Json(json!({ "userId": user, "role": input.role })))
}

pub(super) async fn update(State(state): State<AppState>, session: Session, Path(id): Path<String>, Json(input): Json<SettingsInput>) -> Result<Json<Value>, ApiError> {
    repository::require_admin(&state.db, &session.user_id, &id).await?;
    let mut fields = Document::new();
    if let Some(name) = input.name.as_deref() {
        let name = name.trim();
        if name.is_empty() || name.len() > 200 {
            return Err(ApiError::invalid("Workspace name must be between 1 and 200 bytes."));
        }
        fields.insert("name", name);
    }
    if let Some(visibility) = input.default_visibility.as_deref() {
        if !matches!(visibility, "public" | "private" | "restricted") {
            return Err(ApiError::invalid("Invalid default visibility."));
        }
        fields.insert("defaultVisibility", visibility);
    }
    if fields.is_empty() {
        return Err(ApiError::invalid("Provide a name or a default visibility."));
    }
    state.db.collection::<Document>("workspaces").update_one(doc! { "_id": &id }, doc! { "$set": &fields }).await?;
    Ok(Json(json!({ "id": id, "name": fields.get_str("name").ok(), "defaultVisibility": fields.get_str("defaultVisibility").ok() })))
}

/// Admins and members can leave. Owners delete the workspace instead, so it is never left without one.
pub(super) async fn leave(State(state): State<AppState>, session: Session, Path(id): Path<String>) -> Result<StatusCode, ApiError> {
    let role = repository::membership(&state.db, &session.user_id, &id).await?.ok_or(ApiError::NOT_FOUND)?;
    if role == "owner" {
        return Err(ApiError::conflict("Owners cannot leave a workspace. Delete it instead."));
    }
    repository::remove_member(&state.db, &id, &session.user_id).await?;
    Ok(StatusCode::NO_CONTENT)
}

/// Owners only, and only once the workspace has no reports left.
pub(super) async fn delete_workspace(State(state): State<AppState>, session: Session, Path(id): Path<String>) -> Result<StatusCode, ApiError> {
    let role = repository::membership(&state.db, &session.user_id, &id).await?.ok_or(ApiError::NOT_FOUND)?;
    if role != "owner" {
        return Err(ApiError::FORBIDDEN);
    }
    let reports = state.db.collection::<Document>("reports")
        .count_documents(doc! { "workspaceId": &id, "deletedAt": null }).await?;
    if reports > 0 {
        return Err(ApiError::conflict("Delete this workspace's reports first."));
    }
    repository::delete_workspace(&state.db, &id).await?;
    Ok(StatusCode::NO_CONTENT)
}

pub(super) async fn invitations(State(state): State<AppState>, session: Session, Path(id): Path<String>) -> Result<Json<Value>, ApiError> {
    repository::require_admin(&state.db, &session.user_id, &id).await?;
    let pending: Vec<Document> = state.db.collection::<Document>("workspace_invitations")
        .find(doc! { "workspaceId": &id, "expiresAt": { "$gt": DateTime::now() } })
        .sort(doc! { "expiresAt": 1 }).await?.try_collect().await?;
    let items: Vec<Value> = pending.iter().map(|invitation| json!({
        "id": invitation.get_str("_id").ok(), "email": invitation.get_str("email").ok(),
        "expiresAt": invitation.get_datetime("expiresAt").ok().and_then(|date| date.try_to_rfc3339_string().ok()),
    })).collect();
    Ok(Json(json!({ "items": items })))
}

pub(super) async fn revoke_invitation(State(state): State<AppState>, session: Session, Path((id, invitation)): Path<(String, String)>) -> Result<StatusCode, ApiError> {
    repository::require_admin(&state.db, &session.user_id, &id).await?;
    let result = state.db.collection::<Document>("workspace_invitations")
        .delete_one(doc! { "_id": invitation, "workspaceId": &id }).await?;
    if result.deleted_count == 0 { Err(ApiError::NOT_FOUND) } else { Ok(StatusCode::NO_CONTENT) }
}

pub(super) async fn invite(State(state): State<AppState>, session: Session, Path(id): Path<String>, Json(input): Json<InviteInput>) -> Result<impl IntoResponse, ApiError> {
    repository::require_admin(&state.db, &session.user_id, &id).await?;
    let email = normalize_email(&input.email).ok_or(ApiError::invalid("Enter a valid email address."))?;
    let token = new_secret("zi_").map_err(|_| ApiError::INTERNAL)?;
    let expires_at = DateTime::from_millis(DateTime::now().timestamp_millis() + 604_800_000);
    state.db.collection::<Document>("workspace_invitations").insert_one(doc! {
        "_id": credential_hash(&token), "workspaceId": &id, "email": &email, "expiresAt": expires_at,
    }).await?;
    Ok((StatusCode::CREATED, [(header::CACHE_CONTROL, "no-store")], Json(json!({
        "token": token, "email": email, "workspaceId": id,
        "expiresAt": expires_at.try_to_rfc3339_string().map_err(|_| ApiError::INTERNAL)?
    }))))
}

pub(super) async fn accept(State(state): State<AppState>, session: Session, Path(token): Path<String>) -> Result<Json<Value>, ApiError> {
    if !token.starts_with("zi_") || token.len() != 46 {
        return Err(ApiError::NOT_FOUND);
    }
    let workspace = repository::accept(&state.db, &session.user_id, credential_hash(&token))
        .await?.ok_or(ApiError::NOT_FOUND)?;
    Ok(Json(json!({ "workspaceId": workspace })))
}

pub(super) async fn list_keys(State(state): State<AppState>, session: Session, Path(id): Path<String>) -> Result<Json<Value>, ApiError> {
    repository::require_admin(&state.db, &session.user_id, &id).await?;
    let keys: Vec<Document> = state.db.collection::<Document>("capture_keys").find(doc! { "workspaceId": &id })
        .projection(doc! { "_id": 1, "allowedOrigins": 1, "revokedAt": 1 })
        .sort(doc! { "_id": -1 }).await?.try_collect().await?;
    let items: Vec<_> = keys.iter().map(key_view).collect();
    Ok(Json(json!({ "items": items })))
}

pub(super) async fn create_key(State(state): State<AppState>, session: Session, Path(id): Path<String>, Json(input): Json<KeyInput>) -> Result<impl IntoResponse, ApiError> {
    repository::require_admin(&state.db, &session.user_id, &id).await?;
    let origins = parse_origins(input.allowed_origins)?;
    let key = new_secret("crk_").map_err(|_| ApiError::INTERNAL)?;
    let key_id = ObjectId::new().to_hex();
    state.db.collection::<Document>("capture_keys").insert_one(doc! {
        "_id": &key_id, "workspaceId": &id, "keyHash": credential_hash(&key),
        "allowedOrigins": &origins, "createdAt": DateTime::now(),
    }).await?;
    Ok((StatusCode::CREATED, [(header::CACHE_CONTROL, "no-store")], Json(json!({
        "id": key_id, "key": key, "allowedOrigins": origins, "status": "active"
    }))))
}

pub(super) async fn update_key(State(state): State<AppState>, session: Session, Path((id, key)): Path<(String, String)>, Json(input): Json<KeyInput>) -> Result<Json<Value>, ApiError> {
    repository::require_admin(&state.db, &session.user_id, &id).await?;
    let origins = parse_origins(input.allowed_origins)?;
    let result = state.db.collection::<Document>("capture_keys").update_one(
        doc! { "_id": &key, "workspaceId": &id, "revokedAt": null },
        doc! { "$set": { "allowedOrigins": &origins } },
    ).await?;
    if result.matched_count == 0 {
        return Err(ApiError::NOT_FOUND);
    }
    Ok(Json(json!({ "id": key, "allowedOrigins": origins, "status": "active" })))
}

pub(super) async fn revoke_key(State(state): State<AppState>, session: Session, Path((id, key)): Path<(String, String)>) -> Result<StatusCode, ApiError> {
    repository::require_admin(&state.db, &session.user_id, &id).await?;
    let collection = state.db.collection::<Document>("capture_keys");
    let filter = doc! { "_id": key, "workspaceId": id };
    let Some(document) = collection.find_one(filter.clone()).await? else { return Err(ApiError::NOT_FOUND) };
    if document.get_datetime("revokedAt").is_err() {
        let mut filter = filter;
        filter.insert("revokedAt", mongodb::bson::Bson::Null);
        collection.update_one(filter, doc! { "$set": { "revokedAt": DateTime::now() } }).await?;
    }
    Ok(StatusCode::NO_CONTENT)
}

fn parse_origins(input: Vec<String>) -> Result<Vec<String>, ApiError> {
    if input.is_empty() || input.len() > 50 {
        return Err(ApiError::invalid("Provide between 1 and 50 allowed origins."));
    }
    let mut values = Vec::with_capacity(input.len());
    for origin in input {
        let origin = normalize_origin(&origin).ok_or(ApiError::invalid("Allowed origins must be HTTP or HTTPS origins."))?;
        if !values.contains(&origin) {
            values.push(origin);
        }
    }
    Ok(values)
}

fn key_view(key: &Document) -> Value {
    let allowed = key.get_array("allowedOrigins").ok().into_iter().flatten()
        .filter_map(|value| value.as_str()).collect::<Vec<_>>();
    json!({
        "id": key.get_str("_id").ok(), "allowedOrigins": allowed,
        "status": if key.get_datetime("revokedAt").is_ok() { "revoked" } else { "active" }
    })
}

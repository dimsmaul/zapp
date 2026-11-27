use axum::{Json, extract::{Path, Query, State}, http::{StatusCode, header}, response::IntoResponse};
use futures_util::{FutureExt, TryStreamExt};
use mongodb::{Database, bson::{DateTime, Document, doc, oid::ObjectId}, options::ReturnDocument};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::{
    adapter::http::{ApiError, AppState},
    feature::{auth::Session, capture::{credential_hash, new_secret}, workspaces::{active_workspace, membership}},
};

#[derive(Deserialize)]
pub(super) struct Page { limit: Option<u32>, cursor: Option<String> }

#[derive(Deserialize)]
pub(super) struct Update { title: Option<String>, description: Option<String>, visibility: Option<String> }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct ShareInput { expires_in_seconds: Option<u32> }

pub(super) async fn list(State(state): State<AppState>, session: Session, Query(page): Query<Page>) -> Result<Json<Value>, ApiError> {
    let workspace = active_workspace(&state.db, &session).await?;
    let user = session.user_id.as_str();
    let admin = matches!(membership(&state.db, user, workspace).await?.as_deref(), Some("owner" | "admin"));
    let limit = i64::from(page.limit.unwrap_or(30).clamp(1, 100));
    let mut filter = doc! { "workspaceId": workspace, "deletedAt": null };
    if let Some(cursor) = page.cursor.as_deref() {
        let (time, id) = cursor.split_once(':').ok_or(ApiError::invalid("Invalid report cursor."))?;
        let time = DateTime::from_millis(time.parse().map_err(|_| ApiError::invalid("Invalid report cursor."))?);
        if id.is_empty() || id.len() > 64 { return Err(ApiError::invalid("Invalid report cursor.")); }
        filter.insert("$or", vec![
            doc! { "createdAt": { "$lt": time } },
            doc! { "createdAt": time, "_id": { "$lt": id } }
        ]);
    }
    if !admin {
        // Restricted reports are listed only for the reporter and the people they were shared with.
        filter = doc! { "$and": [filter, doc! { "$or": [
            { "visibility": { "$ne": "restricted" } }, { "reporterId": user }, { "sharedWith": user },
        ] }] };
    }
    let mut reports: Vec<Document> = state.db.collection::<Document>("reports").find(filter)
        .sort(doc! { "createdAt": -1, "_id": -1 }).limit(limit + 1).await?.try_collect().await?;
    let has_more = reports.len() > limit as usize;
    reports.truncate(limit as usize);
    let next = reports.last().filter(|_| has_more).and_then(|report| {
        Some(format!("{}:{}", report.get_datetime("createdAt").ok()?.timestamp_millis(), report.get_str("_id").ok()?))
    });
    let mut items = Vec::with_capacity(reports.len());
    for report in &reports {
        let mut item = summary(report);
        item["previewUrl"] = json!(preview_url(&state, report).await);
        // Mirrors `manage_filter`: owners, admins, and the reporter may change a report.
        item["canManage"] = json!(admin || report.get_str("reporterId") == Ok(user));
        items.push(item);
    }
    Ok(Json(json!({ "items": items, "nextCursor": next })))
}

/// A short-lived signed URL the report list uses for hover previews. Signing is computed locally,
/// so listing stays cheap. `None` when storage is not configured.
async fn preview_url(state: &AppState, report: &Document) -> Option<String> {
    let key = report.get_document("media").ok()?.get_str("objectKey").ok()?;
    state.storage.as_ref()?.sign_playback(key).await.ok()
}

pub(super) async fn update(State(state): State<AppState>, session: Session, Path(id): Path<String>, Json(input): Json<Update>) -> Result<Json<Value>, ApiError> {
    let filter = manage_filter(&state.db, &session, &id).await?;
    let mut fields = Document::new();
    if let Some(title) = input.title {
        if title.len() > 800 { return Err(ApiError::invalid("Report title is too long.")); }
        fields.insert("title", title);
    }
    if let Some(description) = input.description {
        if description.len() > 12_000 { return Err(ApiError::invalid("Report description is too long.")); }
        fields.insert("description", description);
    }
    if let Some(visibility) = input.visibility {
        if !matches!(visibility.as_str(), "public" | "private" | "restricted") { return Err(ApiError::invalid("Invalid report visibility.")); }
        fields.insert("visibility", visibility);
    }
    if fields.is_empty() { return Err(ApiError::invalid("Provide at least one report field.")); }
    fields.insert("updatedAt", DateTime::now());
    let updated = state.db.collection::<Document>("reports").find_one_and_update(filter, doc! { "$set": fields })
        .return_document(ReturnDocument::After).await?.ok_or(ApiError::NOT_FOUND)?;
    Ok(Json(summary(&updated)))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct PersonInput { user_id: String }

/// Who can open a report: its reporter plus the members it was shared with.
async fn access_view(db: &Database, report: &Document) -> Result<Value, ApiError> {
    let reporter = report.get_str("reporterId").ok();
    let shared: Vec<&str> = report.get_array("sharedWith").ok().into_iter().flatten()
        .filter_map(|id| id.as_str()).collect();
    let ids: Vec<&str> = reporter.into_iter().chain(shared.iter().copied()).collect();
    let users: Vec<Document> = db.collection::<Document>("users").find(doc! { "_id": { "$in": &ids } })
        .projection(doc! { "_id": 1, "email": 1 }).await?.try_collect().await?;
    let person = |id: &str, kind: &str| {
        let email = users.iter().find(|user| user.get_str("_id") == Ok(id)).and_then(|user| user.get_str("email").ok());
        json!({ "userId": id, "email": email, "kind": kind })
    };
    let mut people: Vec<Value> = reporter.map(|id| person(id, "owner")).into_iter().collect();
    people.extend(shared.iter().filter(|id| Some(**id) != reporter).map(|id| person(id, "member")));
    Ok(json!({ "visibility": report.get_str("visibility").ok(), "people": people }))
}

pub(super) async fn access(State(state): State<AppState>, session: Session, Path(id): Path<String>) -> Result<Json<Value>, ApiError> {
    let filter = manage_filter(&state.db, &session, &id).await?;
    let report = state.db.collection::<Document>("reports").find_one(filter).await?.ok_or(ApiError::NOT_FOUND)?;
    Ok(Json(access_view(&state.db, &report).await?))
}

pub(super) async fn share_with(State(state): State<AppState>, session: Session, Path(id): Path<String>, Json(input): Json<PersonInput>) -> Result<Json<Value>, ApiError> {
    let filter = manage_filter(&state.db, &session, &id).await?;
    let workspace = filter.get_str("workspaceId").map_err(|_| ApiError::NOT_FOUND)?;
    membership(&state.db, &input.user_id, workspace).await?
        .ok_or(ApiError::invalid("Only members of this workspace can be added."))?;
    let report = state.db.collection::<Document>("reports")
        .find_one_and_update(filter, doc! { "$addToSet": { "sharedWith": &input.user_id }, "$set": { "updatedAt": DateTime::now() } })
        .return_document(ReturnDocument::After).await?.ok_or(ApiError::NOT_FOUND)?;
    Ok(Json(access_view(&state.db, &report).await?))
}

pub(super) async fn unshare(State(state): State<AppState>, session: Session, Path((id, user)): Path<(String, String)>) -> Result<Json<Value>, ApiError> {
    let filter = manage_filter(&state.db, &session, &id).await?;
    let report = state.db.collection::<Document>("reports")
        .find_one_and_update(filter, doc! { "$pull": { "sharedWith": &user }, "$set": { "updatedAt": DateTime::now() } })
        .return_document(ReturnDocument::After).await?.ok_or(ApiError::NOT_FOUND)?;
    Ok(Json(access_view(&state.db, &report).await?))
}

pub(super) async fn remove(State(state): State<AppState>, session: Session, Path(id): Path<String>) -> Result<StatusCode, ApiError> {
    let filter = manage_filter(&state.db, &session, &id).await?;
    let mut tx = state.db.client().start_session().await?;
    let removed = tx.start_transaction().and_run((state.db, id, filter), |tx, (db, id, filter)| async move {
        let reports = db.collection::<Document>("reports");
        let Some(report) = reports.find_one_and_update(filter.clone(), doc! { "$set": { "deletedAt": DateTime::now() } })
            .session(&mut *tx).await? else { return Ok(false) };
        let draft = db.collection::<Document>("capture_drafts")
            .find_one_and_delete(doc! { "_id": id.as_str() }).session(&mut *tx).await?;
        let mut keys = Vec::new();
        for field in ["media", "debugger"] {
            if let Some(key) = report.get_document(field).ok().and_then(|entry| entry.get_str("objectKey").ok()) {
                keys.push(key);
            }
        }
        if let Some(artifacts) = draft.as_ref().and_then(|draft| draft.get_document("artifacts").ok()) {
            for field in ["media", "debugger"] {
                if let Ok(key) = artifacts.get_str(field) { keys.push(key); }
            }
        }
        for key in keys {
            // Keep the cleanup queued until every outstanding draft PUT URL has expired.
            let after = draft.as_ref().and_then(|draft| draft.get_datetime("expiresAt").ok())
                .copied().unwrap_or_else(DateTime::now);
            db.collection::<Document>("artifact_cleanup").update_one(
                doc! { "_id": credential_hash(key) },
                doc! { "$setOnInsert": { "objectKey": key, "attempts": 0, "nextAttemptAt": after } },
            ).upsert(true).session(&mut *tx).await?;
        }
        for name in ["share_links", "report_events", "report_event_details", "ingestion_jobs", "report_comments"] {
            db.collection::<Document>(name).delete_many(doc! { "reportId": id.as_str() }).session(&mut *tx).await?;
        }
        Ok(true)
    }.boxed()).await?;
    if !removed { return Err(ApiError::NOT_FOUND); }
    Ok(StatusCode::NO_CONTENT)
}

pub(super) async fn create_link(State(state): State<AppState>, session: Session, Path(id): Path<String>, Json(input): Json<ShareInput>) -> Result<impl IntoResponse, ApiError> {
    let filter = manage_filter(&state.db, &session, &id).await?;
    let seconds = input.expires_in_seconds.unwrap_or(604_800);
    if !(60..=2_592_000).contains(&seconds) {
        return Err(ApiError::invalid("Share links must expire between one minute and 30 days."));
    }
    let token = new_secret("zl_").map_err(|_| ApiError::INTERNAL)?;
    let link_id = ObjectId::new().to_hex();
    let now = DateTime::now();
    let expires_at = DateTime::from_millis(now.timestamp_millis() + i64::from(seconds) * 1000);
    let link = doc! {
        "_id": &link_id, "reportId": &id, "tokenHash": credential_hash(&token),
        "expiresAt": expires_at, "createdAt": now,
    };
    let mut tx = state.db.client().start_session().await?;
    let created = tx.start_transaction().and_run((state.db, filter, link), |tx, (db, filter, link)| async move {
        let updated = db.collection::<Document>("reports").update_one(filter.clone(),
            doc! { "$set": { "updatedAt": now }, "$inc": { "shareVersion": 1 } }).session(&mut *tx).await?;
        if updated.matched_count == 0 { return Ok(false) }
        db.collection::<Document>("share_links").insert_one(&*link).session(&mut *tx).await?;
        Ok(true)
    }.boxed()).await?;
    if !created { return Err(ApiError::NOT_FOUND); }
    Ok((StatusCode::CREATED, [(header::CACHE_CONTROL, "no-store")], Json(json!({
        "id": link_id, "token": token, "shareUrl": format!("{}/s/{id}#share={token}", state.web_origin),
        "expiresAt": expires_at.try_to_rfc3339_string().map_err(|_| ApiError::INTERNAL)?,
    }))))
}

pub(super) async fn revoke_link(State(state): State<AppState>, session: Session, Path((id, link)): Path<(String, String)>) -> Result<StatusCode, ApiError> {
    manage_filter(&state.db, &session, &id).await?;
    let links = state.db.collection::<Document>("share_links");
    let filter = doc! { "_id": link, "reportId": id };
    let Some(link) = links.find_one(filter.clone()).await? else { return Err(ApiError::NOT_FOUND) };
    if link.get_datetime("revokedAt").is_err() {
        let mut filter = filter;
        filter.insert("revokedAt", mongodb::bson::Bson::Null);
        links.update_one(filter, doc! { "$set": { "revokedAt": DateTime::now() } }).await?;
    }
    Ok(StatusCode::NO_CONTENT)
}

async fn manage_filter(db: &Database, session: &Session, id: &str) -> Result<Document, ApiError> {
    let mut filter = doc! { "_id": id, "deletedAt": null };
    let report = db.collection::<Document>("reports").find_one(filter.clone())
        .projection(doc! { "workspaceId": 1, "reporterId": 1 }).await?.ok_or(ApiError::NOT_FOUND)?;
    let workspace = report.get_str("workspaceId").map_err(|_| ApiError::NOT_FOUND)?;
    let role = membership(db, &session.user_id, workspace).await?.ok_or(ApiError::NOT_FOUND)?;
    if !matches!(role.as_str(), "owner" | "admin") && report.get_str("reporterId") != Ok(session.user_id.as_str()) {
        return Err(ApiError::FORBIDDEN);
    }
    filter.insert("workspaceId", workspace);
    Ok(filter)
}

fn summary(report: &Document) -> Value {
    json!({
        "id": report.get_str("_id").ok(), "title": report.get_str("title").ok(),
        "description": report.get_str("description").ok(), "visibility": report.get_str("visibility").ok(),
        "attachmentType": report.get_str("attachmentType").ok(), "debuggerStatus": report.get_str("debuggerStatus").ok(),
        "createdAt": report.get_datetime("createdAt").ok().and_then(|date| date.try_to_rfc3339_string().ok()),
    })
}

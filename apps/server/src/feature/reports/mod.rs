mod management;

use axum::{
    Json, Router,
    extract::{Path, State},
    http::{HeaderMap, StatusCode, header},
    routing::{get, delete, post},
};
use futures_util::FutureExt;
use mongodb::{
    Database,
    bson::{DateTime, Document, doc},
};
use serde_json::{Value, json};

use crate::{
    adapter::http::{ApiError, AppState},
    capture::credential_hash,
    feature::{auth::bearer_token, workspaces::membership},
};

pub(crate) fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/reports", get(management::list))
        .route("/api/v1/reports/{id}", get(read_report).patch(management::update).delete(management::remove))
        .route("/api/v1/reports/{id}/share-links", post(management::create_link))
        .route("/api/v1/reports/{id}/share-links/{link_id}", delete(management::revoke_link))
}

pub async fn publish(db: &Database, report: Document) -> mongodb::error::Result<Option<Document>> {
    let id = report
        .get_str("_id")
        .map_err(mongodb::error::Error::custom)?
        .to_owned();
    let workspace = report
        .get_str("workspaceId")
        .map_err(mongodb::error::Error::custom)?
        .to_owned();
    let mut session = db.client().start_session().await?;
    session.start_transaction()
        .and_run((db.clone(), report, id, workspace), |session, (db, report, id, workspace)| {
            async move {
                let reports = db.collection::<Document>("reports");
                let filter = doc! { "_id": id.as_str(), "workspaceId": workspace.as_str(), "deletedAt": null };
                if let Some(existing) = reports.find_one(filter.clone()).session(&mut *session).await? {
                    return Ok(Some(existing));
                }
                let updated = db.collection::<Document>("capture_drafts")
                    .update_one(
                        doc! { "_id": id.as_str(), "workspaceId": workspace.as_str(), "status": "uploading" },
                        doc! { "$set": { "status": "published", "publishedAt": DateTime::now() } },
                    )
                    .session(&mut *session).await?;
                if updated.modified_count == 0 {
                    return Ok(None);
                }
                reports.insert_one(&*report).session(&mut *session).await?;
                if report.get_str("debuggerStatus") == Ok("pending") {
                    db.collection::<Document>("ingestion_jobs").insert_one(doc! {
                        "_id": format!("{id}:debugger"), "reportId": id.as_str(),
                        "kind": "debugger", "status": "pending", "attempts": 0,
                        "nextAttemptAt": DateTime::now()
                    }).session(&mut *session).await?;
                }
                Ok(Some(report.clone()))
            }.boxed()
        })
        .await
}

pub(crate) async fn read_report(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Result<([(header::HeaderName, &'static str); 1], Json<Value>), ApiError> {
    let report = visible_report(&state.db, &headers, &id).await?;
    let media = report.get_document("media").map_err(|_| NOT_FOUND)?;
    let key = media.get_str("objectKey").map_err(|_| NOT_FOUND)?;
    let url = state
        .storage
        .as_ref()
        .ok_or(STORAGE_UNAVAILABLE)?
        .sign_playback(key)
        .await
        .map_err(|_| STORAGE_UNAVAILABLE)?;
    let member = member_view(&state.db, &headers, &report).await?;
    Ok((
        [(header::CACHE_CONTROL, "private, no-store")],
        Json(json!({
            "id": id, "title": report.get_str("title").ok(),
            "description": report.get_str("description").ok(),
            "attachmentType": report.get_str("attachmentType").ok(),
            "attachmentUrl": url, "captureContentType": media.get_str("contentType").ok(),
            "debuggerStatus": report.get_str("debuggerStatus").ok(),
            "createdAt": report.get_datetime("createdAt").ok().and_then(|date| date.try_to_rfc3339_string().ok()),
            "reporter": member.reporter, "visibility": report.get_str("visibility").ok(),
            "canManage": member.can_manage,
        })),
    ))
}

/// What a signed-in workspace member may see beyond the public report.
struct MemberView {
    /// The reporter's email. Public and share-link viewers never learn who filed the report.
    reporter: Option<String>,
    /// Owners, admins, and the reporter can change the report's visibility.
    can_manage: bool,
}

async fn member_view(db: &Database, headers: &HeaderMap, report: &Document) -> Result<MemberView, ApiError> {
    let outsider = MemberView { reporter: None, can_manage: false };
    let (Some(raw), Ok(workspace)) = (bearer_token(headers), report.get_str("workspaceId")) else {
        return Ok(outsider);
    };
    let session = db
        .collection::<Document>("user_sessions")
        .find_one(doc! { "_id": credential_hash(raw), "expiresAt": { "$gt": DateTime::now() } })
        .await?;
    let Some(viewer) = session.as_ref().and_then(|session| session.get_str("userId").ok()) else {
        return Ok(outsider);
    };
    let Some(role) = membership(db, viewer, workspace).await? else {
        return Ok(outsider);
    };
    let reporter_id = report.get_str("reporterId").ok();
    let can_manage = matches!(role.as_str(), "owner" | "admin") || reporter_id == Some(viewer);
    let reporter = match reporter_id {
        Some(reporter) => db.collection::<Document>("users").find_one(doc! { "_id": reporter }).await?
            .and_then(|user| user.get_str("email").ok().map(str::to_owned)),
        None => None,
    };
    Ok(MemberView { reporter, can_manage })
}

pub(crate) async fn visible_report(db: &Database, headers: &HeaderMap, id: &str) -> Result<Document, ApiError> {
    let report = find_report(db, id).await?;
    let workspace = report.get_str("workspaceId").map_err(|_| NOT_FOUND)?;
    if report.get_str("visibility") != Ok("public")
        && !can_view_report(db, headers, id, workspace).await? {
        return Err(NOT_FOUND);
    }
    Ok(report)
}

pub(crate) async fn visible_report_for_user(db: &Database, user: &str, id: &str) -> Result<Document, ApiError> {
    let report = find_report(db, id).await?;
    let workspace = report.get_str("workspaceId").map_err(|_| NOT_FOUND)?;
    if report.get_str("visibility") != Ok("public")
        && !has_membership(db, workspace, user).await? {
        return Err(NOT_FOUND);
    }
    Ok(report)
}

async fn find_report(db: &Database, id: &str) -> Result<Document, ApiError> {
    db.collection::<Document>("reports")
        .find_one(doc! { "_id": id, "deletedAt": null })
        .await?
        .ok_or(NOT_FOUND)
}

async fn can_view_report(
    db: &Database,
    headers: &HeaderMap,
    id: &str,
    workspace: &str,
) -> Result<bool, ApiError> {
    let now = DateTime::now();
    if let Some(raw) = headers
        .get("x-zapp-share-token")
        .and_then(|value| value.to_str().ok())
        .filter(|value| !value.is_empty() && value.len() <= 256)
    {
        let link = db
            .collection::<Document>("share_links")
            .find_one(doc! {
                "tokenHash": credential_hash(raw), "reportId": id, "revokedAt": null,
                "$or": [{"expiresAt": null}, {"expiresAt": { "$gt": now }}]
            })
            .await?;
        if link.is_some() {
            return Ok(true);
        }
    }
    let Some(raw) = bearer_token(headers) else {
        return Ok(false);
    };
    let session = db
        .collection::<Document>("user_sessions")
        .find_one(doc! {
            "_id": credential_hash(raw), "expiresAt": { "$gt": now }
        })
        .await?;
    let Some(user) = session
        .as_ref()
        .and_then(|session| session.get_str("userId").ok())
    else {
        return Ok(false);
    };
    has_membership(db, workspace, user).await
}

async fn has_membership(db: &Database, workspace: &str, user: &str) -> Result<bool, ApiError> {
    Ok(db
        .collection::<Document>("workspace_members")
        .find_one(doc! {
            "workspaceId": workspace, "userId": user,
        })
        .await?
        .is_some())
}

const NOT_FOUND: ApiError = ApiError(StatusCode::NOT_FOUND, "NOT_FOUND", "Report not found.");
const STORAGE_UNAVAILABLE: ApiError = ApiError(
    StatusCode::SERVICE_UNAVAILABLE,
    "STORAGE_UNAVAILABLE",
    "Capture storage is unavailable.",
);

//! Comments on a report. They are an internal conversation, so only signed-in members of the
//! report's workspace who can open the report may read or write them. Public and share-link
//! viewers never see them.

use axum::{
    Json, Router,
    extract::{Path, Query, State},
    http::StatusCode,
    routing::{delete, get},
};
use futures_util::TryStreamExt;
use mongodb::{Database, bson::{DateTime, Document, doc, oid::ObjectId}};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::{
    adapter::http::{ApiError, AppState},
    feature::{auth::Session, reports::visible_report_for_user, workspaces::membership},
};

const MAX_BODY_CHARS: usize = 4000;
const MAX_MENTIONS: usize = 20;
const MAX_OFFSET_MS: i64 = 86_400_000;

pub(crate) fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/reports/{id}/comments", get(list).post(create))
        .route("/api/v1/reports/{id}/comments/{comment_id}", delete(remove))
}

#[derive(Deserialize)]
struct Page { limit: Option<u32>, cursor: Option<String> }

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct CommentInput {
    body: String,
    /// Position in the recording the comment refers to.
    offset_ms: Option<i64>,
    #[serde(default)]
    mentions: Vec<String>,
}

/// The report and the caller's role, after checking the caller is a member who may open it.
async fn member_access(state: &AppState, session: &Session, id: &str) -> Result<(Document, bool), ApiError> {
    let report = visible_report_for_user(&state.db, &session.user_id, id).await?;
    let workspace = report.get_str("workspaceId").map_err(|_| ApiError::NOT_FOUND)?;
    let role = membership(&state.db, &session.user_id, workspace).await?.ok_or(ApiError::NOT_FOUND)?;
    Ok((report, matches!(role.as_str(), "owner" | "admin")))
}

async fn views(db: &Database, comments: &[Document], viewer: &str, admin: bool) -> Result<Vec<Value>, ApiError> {
    let mut ids: Vec<&str> = Vec::new();
    for comment in comments {
        ids.extend(comment.get_str("authorId").ok());
        ids.extend(comment.get_array("mentions").ok().into_iter().flatten().filter_map(|id| id.as_str()));
    }
    let users: Vec<Document> = db.collection::<Document>("users").find(doc! { "_id": { "$in": &ids } })
        .projection(doc! { "_id": 1, "email": 1 }).await?.try_collect().await?;
    let email = |id: &str| users.iter().find(|user| user.get_str("_id") == Ok(id)).and_then(|user| user.get_str("email").ok());
    Ok(comments.iter().map(|comment| {
        let author = comment.get_str("authorId").ok();
        let mentions: Vec<Value> = comment.get_array("mentions").ok().into_iter().flatten()
            .filter_map(|id| id.as_str())
            .map(|id| json!({ "userId": id, "email": email(id) }))
            .collect();
        json!({
            "id": comment.get_str("_id").ok(),
            "authorId": author, "authorEmail": author.and_then(email),
            "body": comment.get_str("body").ok(),
            "offsetMs": comment.get_i32("offsetMs").ok(),
            "mentions": mentions,
            "createdAt": comment.get_datetime("createdAt").ok().and_then(|date| date.try_to_rfc3339_string().ok()),
            "canDelete": admin || author == Some(viewer),
        })
    }).collect())
}

async fn list(State(state): State<AppState>, session: Session, Path(id): Path<String>, Query(page): Query<Page>) -> Result<Json<Value>, ApiError> {
    let (_, admin) = member_access(&state, &session, &id).await?;
    let limit = i64::from(page.limit.unwrap_or(50).clamp(1, 100));
    let mut filter = doc! { "reportId": &id };
    if let Some(cursor) = page.cursor.as_deref() {
        let (time, last) = cursor.split_once(':').ok_or(ApiError::invalid("Invalid comment cursor."))?;
        let time = DateTime::from_millis(time.parse().map_err(|_| ApiError::invalid("Invalid comment cursor."))?);
        if last.is_empty() || last.len() > 64 { return Err(ApiError::invalid("Invalid comment cursor.")); }
        filter.insert("$or", vec![
            doc! { "createdAt": { "$gt": time } },
            doc! { "createdAt": time, "_id": { "$gt": last } },
        ]);
    }
    let mut comments: Vec<Document> = state.db.collection::<Document>("report_comments").find(filter)
        .sort(doc! { "createdAt": 1, "_id": 1 }).limit(limit + 1).await?.try_collect().await?;
    let more = comments.len() > limit as usize;
    comments.truncate(limit as usize);
    let next = comments.last().filter(|_| more).and_then(|comment| {
        Some(format!("{}:{}", comment.get_datetime("createdAt").ok()?.timestamp_millis(), comment.get_str("_id").ok()?))
    });
    let items = views(&state.db, &comments, &session.user_id, admin).await?;
    Ok(Json(json!({ "items": items, "nextCursor": next })))
}

async fn create(State(state): State<AppState>, session: Session, Path(id): Path<String>, Json(input): Json<CommentInput>) -> Result<(StatusCode, Json<Value>), ApiError> {
    let (report, admin) = member_access(&state, &session, &id).await?;
    let body = input.body.trim();
    if body.is_empty() || body.chars().count() > MAX_BODY_CHARS {
        return Err(ApiError::invalid("A comment must be between 1 and 4000 characters."));
    }
    let offset = match input.offset_ms {
        Some(ms) if (0..=MAX_OFFSET_MS).contains(&ms) => Some(ms as i32),
        Some(_) => return Err(ApiError::invalid("Invalid comment timestamp.")),
        None => None,
    };
    if input.mentions.len() > MAX_MENTIONS {
        return Err(ApiError::invalid("A comment can mention up to 20 people."));
    }
    // Keep only people who really belong to this workspace.
    let mut mentions: Vec<String> = Vec::new();
    if !input.mentions.is_empty() {
        let workspace = report.get_str("workspaceId").map_err(|_| ApiError::NOT_FOUND)?;
        let members: Vec<Document> = state.db.collection::<Document>("workspace_members")
            .find(doc! { "workspaceId": workspace, "userId": { "$in": &input.mentions } })
            .projection(doc! { "userId": 1 }).await?.try_collect().await?;
        mentions = members.iter().filter_map(|member| member.get_str("userId").ok().map(str::to_owned)).collect();
    }
    let mut comment = doc! {
        "_id": ObjectId::new().to_hex(), "reportId": &id, "authorId": &session.user_id,
        "body": body, "mentions": &mentions, "createdAt": DateTime::now(),
    };
    if let Some(offset) = offset { comment.insert("offsetMs", offset); }
    state.db.collection::<Document>("report_comments").insert_one(&comment).await?;
    let view = views(&state.db, &[comment], &session.user_id, admin).await?.remove(0);
    Ok((StatusCode::CREATED, Json(view)))
}

async fn remove(State(state): State<AppState>, session: Session, Path((id, comment)): Path<(String, String)>) -> Result<StatusCode, ApiError> {
    let (_, admin) = member_access(&state, &session, &id).await?;
    let mut filter = doc! { "_id": comment, "reportId": &id };
    // Authors delete their own comments. Workspace owners and admins can delete any.
    if !admin { filter.insert("authorId", &session.user_id); }
    let result = state.db.collection::<Document>("report_comments").delete_one(filter).await?;
    if result.deleted_count == 0 { Err(ApiError::NOT_FOUND) } else { Ok(StatusCode::NO_CONTENT) }
}

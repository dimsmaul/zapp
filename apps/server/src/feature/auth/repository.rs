use mongodb::{Database, bson::{DateTime, Document, doc}};

use super::model::Session;
use crate::{adapter::{http::ApiError, mongo::duplicate_key}, feature::capture::credential_hash};

pub(super) async fn insert_user(db: &Database, user: Document) -> Result<(), ApiError> {
    match db.collection::<Document>("users").insert_one(user).await {
        Ok(_) => Ok(()),
        Err(error) if duplicate_key(&error) => Err(ApiError::conflict("An account already exists for this email.")),
        Err(error) => Err(error.into()),
    }
}

pub(super) async fn user_by_email(db: &Database, email: &str) -> Result<Option<Document>, ApiError> {
    Ok(db.collection::<Document>("users").find_one(doc! { "email": email }).await?)
}

pub(super) async fn begin_session(db: &Database, user_id: &str, token: &str, expires_at: DateTime, workspace: Option<&str>) -> Result<(), ApiError> {
    let mut session = doc! { "_id": credential_hash(token), "userId": user_id, "expiresAt": expires_at };
    if let Some(workspace) = workspace {
        session.insert("activeWorkspaceId", workspace);
    }
    db.collection::<Document>("user_sessions").insert_one(session).await?;
    Ok(())
}

pub(super) async fn find_session(db: &Database, token: &str) -> Result<Option<Session>, ApiError> {
    let id = credential_hash(token);
    let doc = db.collection::<Document>("user_sessions").find_one(doc! {
        "_id": &id, "expiresAt": { "$gt": DateTime::now() }
    }).await?;
    Ok(doc.and_then(|doc| Some(Session {
        id, user_id: doc.get_str("userId").ok()?.to_owned(),
        workspace_id: doc.get_str("activeWorkspaceId").ok().map(str::to_owned),
    })))
}

pub(super) async fn user_email(db: &Database, user_id: &str) -> Result<String, ApiError> {
    db.collection::<Document>("users").find_one(doc! { "_id": user_id })
        .projection(doc! { "email": 1 }).await?
        .and_then(|user| user.get_str("email").ok().map(str::to_owned))
        .ok_or(ApiError::UNAUTHORIZED)
}

pub(super) async fn end_session(db: &Database, session: &Session) -> Result<(), ApiError> {
    db.collection::<Document>("user_sessions")
        .delete_one(doc! { "_id": &session.id, "userId": &session.user_id }).await?;
    Ok(())
}

pub(super) async fn limit_attempt(db: &Database, email: &str) -> Result<(), ApiError> {
    let timestamp = DateTime::now().timestamp_millis();
    let window = timestamp.div_euclid(300_000);
    let id = format!("{}:{window}", credential_hash(email));
    let attempts = db.collection::<Document>("auth_attempts");
    let result = attempts.update_one(
        doc! { "_id": id, "count": { "$lt": 12 } },
        doc! { "$inc": { "count": 1 }, "$setOnInsert": {
            "expiresAt": DateTime::from_millis((window + 1) * 300_000)
        }},
    ).upsert(true).await;
    match result {
        Ok(_) => Ok(()),
        Err(error) if duplicate_key(&error) => Err(super::service::TOO_MANY_ATTEMPTS),
        Err(error) => Err(error.into()),
    }
}

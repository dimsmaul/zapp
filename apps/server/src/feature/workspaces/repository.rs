use futures_util::{FutureExt, TryStreamExt};
use mongodb::{Database, bson::{DateTime, Document, doc}};

use crate::adapter::http::ApiError;
use crate::feature::auth::Session;

pub(crate) async fn membership(db: &Database, user_id: &str, workspace: &str) -> Result<Option<String>, ApiError> {
    let member = db.collection::<Document>("workspace_members")
        .find_one(doc! { "userId": user_id, "workspaceId": workspace }).await?;
    Ok(member.and_then(|member| member.get_str("role").ok().map(str::to_owned)))
}

pub(crate) async fn require_admin(db: &Database, user_id: &str, workspace: &str) -> Result<(), ApiError> {
    match membership(db, user_id, workspace).await?.as_deref() {
        Some("owner" | "admin") => Ok(()),
        Some(_) => Err(ApiError::FORBIDDEN),
        None => Err(ApiError::NOT_FOUND),
    }
}

pub(crate) async fn active_workspace<'a>(db: &Database, session: &'a Session) -> Result<&'a str, ApiError> {
    let workspace = session.workspace_id.as_deref().ok_or(ApiError::invalid("Select a workspace first."))?;
    membership(db, &session.user_id, workspace).await?.ok_or(ApiError::NOT_FOUND)?;
    Ok(workspace)
}

pub(super) async fn create(db: &Database, workspace: Document, member: Document) -> Result<(), ApiError> {
    let mut tx = db.client().start_session().await?;
    tx.start_transaction().and_run((db.clone(), workspace, member), |tx, (db, workspace, member)| {
        async move {
            db.collection::<Document>("workspaces").insert_one(&*workspace).session(&mut *tx).await?;
            db.collection::<Document>("workspace_members").insert_one(&*member).session(&mut *tx).await?;
            Ok(())
        }.boxed()
    }).await?;
    Ok(())
}

pub(super) async fn select(db: &Database, session: &Session, workspace: &str) -> Result<(), ApiError> {
    membership(db, &session.user_id, workspace).await?.ok_or(ApiError::NOT_FOUND)?;
    let selected = db.collection::<Document>("user_sessions").update_one(
        doc! { "_id": &session.id, "userId": &session.user_id, "expiresAt": { "$gt": DateTime::now() } },
        doc! { "$set": { "activeWorkspaceId": workspace } },
    ).await?;
    if selected.matched_count == 0 {
        return Err(ApiError::UNAUTHORIZED);
    }
    Ok(())
}

/// The workspace a new session starts in: the first one in the user's list, so nobody has to pick one
/// after signing in. None when the user has no workspace yet.
pub(crate) async fn default_workspace(db: &Database, user: &str) -> Result<Option<String>, ApiError> {
    Ok(list(db, user).await?.first().and_then(|workspace| workspace.get_str("id").ok().map(str::to_owned)))
}

pub(super) async fn list(db: &Database, user: &str) -> Result<Vec<Document>, ApiError> {
    let workspaces = db.collection::<Document>("workspace_members").aggregate(vec![
        doc! { "$match": { "userId": user } },
        doc! { "$lookup": { "from": "workspaces", "localField": "workspaceId", "foreignField": "_id", "as": "workspace" } },
        doc! { "$unwind": "$workspace" },
        doc! { "$sort": { "workspace.name": 1, "workspaceId": 1 } },
        doc! { "$project": { "_id": 0, "id": "$workspaceId", "name": "$workspace.name", "role": 1, "defaultVisibility": "$workspace.defaultVisibility" } },
    ]).await?.try_collect().await?;
    Ok(workspaces)
}

pub(super) async fn members(db: &Database, workspace: &str) -> Result<Vec<Document>, ApiError> {
    let members = db.collection::<Document>("workspace_members").aggregate(vec![
        doc! { "$match": { "workspaceId": workspace } },
        doc! { "$lookup": { "from": "users", "localField": "userId", "foreignField": "_id", "as": "user" } },
        doc! { "$unwind": "$user" },
        doc! { "$sort": { "user.email": 1, "userId": 1 } },
        doc! { "$project": { "_id": 0, "userId": 1, "email": "$user.email", "role": 1 } },
    ]).await?.try_collect().await?;
    Ok(members)
}

pub(super) async fn remove_member(db: &Database, workspace: &str, user: &str) -> Result<(), ApiError> {
    db.collection::<Document>("workspace_members")
        .delete_one(doc! { "workspaceId": workspace, "userId": user }).await?;
    // Sessions that had this workspace selected must pick another one.
    db.collection::<Document>("user_sessions").update_many(
        doc! { "userId": user, "activeWorkspaceId": workspace },
        doc! { "$unset": { "activeWorkspaceId": "" } },
    ).await?;
    Ok(())
}

/// Removes the workspace with its members, invitations, and capture keys. Callers make sure it
/// has no reports first, because deleting a report also queues cleanup of its stored files.
pub(super) async fn delete_workspace(db: &Database, workspace: &str) -> Result<(), ApiError> {
    let mut tx = db.client().start_session().await?;
    tx.start_transaction().and_run((db.clone(), workspace.to_owned()), |tx, (db, workspace)| {
        async move {
            for collection in ["workspace_members", "workspace_invitations", "capture_keys", "capture_tokens"] {
                db.collection::<Document>(collection)
                    .delete_many(doc! { "workspaceId": workspace.as_str() }).session(&mut *tx).await?;
            }
            db.collection::<Document>("workspaces")
                .delete_one(doc! { "_id": workspace.as_str() }).session(&mut *tx).await?;
            Ok(())
        }.boxed()
    }).await?;
    db.collection::<Document>("user_sessions").update_many(
        doc! { "activeWorkspaceId": workspace },
        doc! { "$unset": { "activeWorkspaceId": "" } },
    ).await?;
    Ok(())
}

pub(super) async fn accept(db: &Database, user: &str, token_hash: String) -> Result<Option<String>, ApiError> {
    let mut tx = db.client().start_session().await?;
    let result = tx.start_transaction().and_run(
        (db.clone(), user.to_owned(), token_hash),
        |tx, (db, user, hash)| async move {
            let Some(account) = db.collection::<Document>("users")
                .find_one(doc! { "_id": user.as_str() }).session(&mut *tx).await? else { return Ok(None) };
            let email = account.get_str("email").map_err(mongodb::error::Error::custom)?;
            let invitations = db.collection::<Document>("workspace_invitations");
            let invitation = invitations.find_one_and_delete(doc! {
                "_id": hash.as_str(), "email": email, "expiresAt": { "$gt": DateTime::now() }
            }).session(&mut *tx).await?;
            let Some(invitation) = invitation else { return Ok(None) };
            let workspace = invitation.get_str("workspaceId").map_err(mongodb::error::Error::custom)?;
            if db.collection::<Document>("workspaces").find_one(doc! { "_id": workspace })
                .session(&mut *tx).await?.is_none() {
                return Ok(None);
            }
            db.collection::<Document>("workspace_members").update_one(
                doc! { "workspaceId": workspace, "userId": user.as_str() },
                doc! { "$setOnInsert": {
                    "_id": mongodb::bson::oid::ObjectId::new().to_hex(), "role": "member", "createdAt": DateTime::now()
                }},
            ).upsert(true).session(&mut *tx).await?;
            Ok(Some(workspace.to_owned()))
        }.boxed(),
    ).await?;
    Ok(result)
}

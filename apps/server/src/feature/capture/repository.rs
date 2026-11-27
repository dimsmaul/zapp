use mongodb::{
    Database,
    bson::{Bson, DateTime, Document, doc, oid::ObjectId},
    options::ReturnDocument,
};

use super::model::{
    CaptureError, CaptureKey, CaptureToken, Draft, DraftArtifacts, DraftDetails, DraftOwner, Publication,
    PublishedMedia, credential_hash,
};
use crate::reports;

pub(super) struct CaptureRepository<'a>(pub &'a Database);

impl CaptureRepository<'_> {
    pub fn new_id() -> String {
        ObjectId::new().to_hex()
    }

    /// New captures use the workspace's default visibility unless the caller asks for another.
    pub async fn default_visibility(&self, workspace: &str) -> Result<Option<String>, CaptureError> {
        let found = self.0.collection::<Document>("workspaces").find_one(doc! { "_id": workspace })
            .projection(doc! { "defaultVisibility": 1 }).await?;
        Ok(found.and_then(|found| found.get_str("defaultVisibility").ok().map(str::to_owned)))
    }

    pub async fn active_key(&self, raw_key: &str) -> Result<CaptureKey, CaptureError> {
        let key = self
            .0
            .collection::<Document>("capture_keys")
            .find_one(doc! { "keyHash": credential_hash(raw_key), "revokedAt": null })
            .await?
            .ok_or(CaptureError::InvalidKey)?;
        let allowed_origins = key
            .get_array("allowedOrigins")
            .ok()
            .into_iter()
            .flatten()
            .filter_map(Bson::as_str)
            .map(str::to_owned)
            .collect();
        Ok(CaptureKey {
            id: key
                .get_str("_id")
                .map_err(|_| CaptureError::InvalidKey)?
                .to_owned(),
            workspace_id: key
                .get_str("workspaceId")
                .map_err(|_| CaptureError::InvalidKey)?
                .to_owned(),
            allowed_origins,
        })
    }

    pub async fn insert_token(
        &self,
        raw_token: &str,
        key: &CaptureKey,
        origin: &str,
        expires_at_ms: i64,
    ) -> Result<String, CaptureError> {
        let expires_at = DateTime::from_millis(expires_at_ms);
        let expires_at_text = expires_at
            .try_to_rfc3339_string()
            .map_err(|_| CaptureError::TokenExpirationEncoding)?;
        self.0.collection::<Document>("capture_tokens").insert_one(doc! {
            "_id": credential_hash(raw_token), "workspaceId": &key.workspace_id, "keyId": &key.id,
            "origin": origin, "expiresAt": expires_at, "draftId": Self::new_id()
        }).await?;
        Ok(expires_at_text)
    }

    pub async fn token(
        &self,
        raw_token: &str,
        key: &CaptureKey,
        origin: &str,
        now_ms: i64,
        draft_id: Option<&str>,
    ) -> Result<CaptureToken, CaptureError> {
        let mut filter = doc! {
            "_id": credential_hash(raw_token), "keyId": &key.id, "workspaceId": &key.workspace_id,
            "origin": origin, "expiresAt": { "$gt": DateTime::from_millis(now_ms) }
        };
        if let Some(id) = draft_id {
            filter.insert("draftId", id);
        }
        let token = self
            .0
            .collection::<Document>("capture_tokens")
            .find_one(filter)
            .await?
            .ok_or(CaptureError::InvalidToken)?;
        Ok(CaptureToken {
            draft_id: token
                .get_str("draftId")
                .map_err(|_| CaptureError::InvalidToken)?
                .to_owned(),
            expires_at_ms: token
                .get_datetime("expiresAt")
                .map_err(|_| CaptureError::InvalidToken)?
                .timestamp_millis(),
        })
    }

    pub async fn save_draft(
        &self,
        owner: &DraftOwner<'_>,
        token: &CaptureToken,
        draft: &Draft,
        now_ms: i64,
    ) -> Result<i64, CaptureError> {
        let artifacts = doc! {
            "media": &draft.artifacts.media, "debugger": draft.artifacts.debugger.as_deref(),
            "contentType": &draft.artifacts.content_type
        };
        let details = doc! {
            "attachmentType": &draft.details.attachment_type, "visibility": &draft.details.visibility,
            "title": draft.details.title.as_deref(), "description": draft.details.description.as_deref()
        };
        let stored = self
            .0
            .collection::<Document>("capture_drafts")
            .find_one_and_update(
                doc! { "_id": &token.draft_id },
                doc! { "$setOnInsert": {
                    "workspaceId": owner.workspace_id, "keyId": owner.key_id,
                    "reporterId": owner.reporter_id, "status": "uploading",
                    "artifacts": &artifacts, "details": &details,
                    "expiresAt": DateTime::from_millis(token.expires_at_ms),
                    "createdAt": DateTime::from_millis(now_ms)
                }},
            )
            .upsert(true)
            .return_document(ReturnDocument::After)
            .await?
            .ok_or(CaptureError::InvalidUpload)?;

        if stored.get_str("workspaceId") != Ok(owner.workspace_id)
            || stored.get_str("keyId").ok() != owner.key_id
            || stored.get_str("reporterId").ok() != owner.reporter_id
            || stored.get("artifacts") != Some(&Bson::Document(artifacts))
            || stored.get("details") != Some(&Bson::Document(details))
            || stored.get_str("status") != Ok("uploading")
        {
            return Err(CaptureError::DraftConflict);
        }
        Ok(stored.get_datetime("expiresAt").map_err(|_| CaptureError::InvalidUpload)?.timestamp_millis())
    }

    pub async fn report_exists(&self, owner: &DraftOwner<'_>, id: &str) -> Result<bool, CaptureError> {
        let mut filter = doc! { "_id": id, "workspaceId": owner.workspace_id, "deletedAt": null };
        if let Some(reporter) = owner.reporter_id {
            filter.insert("reporterId", reporter);
        }
        Ok(self
            .0
            .collection::<Document>("reports")
            .find_one(filter)
            .await?
            .is_some())
    }

    pub async fn draft(&self, owner: &DraftOwner<'_>, id: &str, now_ms: i64) -> Result<Draft, CaptureError> {
        let draft = self
            .0
            .collection::<Document>("capture_drafts")
            .find_one(doc! {
                "_id": id, "workspaceId": owner.workspace_id, "keyId": owner.key_id,
                "reporterId": owner.reporter_id, "status": "uploading",
                "expiresAt": { "$gt": DateTime::from_millis(now_ms) },
            })
            .await?
            .ok_or(CaptureError::DraftNotFound)?;
        let missing = |_| CaptureError::DraftNotFound;
        let artifacts = draft.get_document("artifacts").map_err(missing)?;
        let details = draft.get_document("details").map_err(missing)?;
        Ok(Draft {
            artifacts: DraftArtifacts {
                media: artifacts.get_str("media").map_err(missing)?.to_owned(),
                debugger: artifacts.get_str("debugger").ok().map(str::to_owned),
                content_type: artifacts
                    .get_str("contentType")
                    .map_err(missing)?
                    .to_owned(),
            },
            details: DraftDetails {
                attachment_type: details
                    .get_str("attachmentType")
                    .map_err(missing)?
                    .to_owned(),
                visibility: details
                    .get_str("visibility")
                    .unwrap_or("private")
                    .to_owned(),
                title: details.get_str("title").ok().map(str::to_owned),
                description: details.get_str("description").ok().map(str::to_owned),
            },
        })
    }

    pub async fn publish(
        &self,
        owner: &DraftOwner<'_>,
        id: &str,
        draft: &Draft,
        media: PublishedMedia<'_>,
        debugger_encoding: &str,
        now_ms: i64,
    ) -> Result<Publication, CaptureError> {
        let debugger = draft.artifacts.debugger.as_ref().map(|key| {
            doc! { "objectKey": key, "contentEncoding": debugger_encoding }
        });
        let report = doc! {
            "_id": id, "draftId": id, "workspaceId": owner.workspace_id, "reporterId": owner.reporter_id,
            "createdAt": DateTime::from_millis(now_ms),
            "visibility": &draft.details.visibility, "attachmentType": &draft.details.attachment_type,
            "title": draft.details.title.as_deref(), "description": draft.details.description.as_deref(),
            "media": { "objectKey": media.key, "contentType": &draft.artifacts.content_type, "sizeBytes": media.size as i64 },
            "debuggerStatus": if debugger.is_some() { "pending" } else { "not_uploaded" },
            "debugger": debugger,
        };
        let published = reports::publish(self.0, report).await?;
        Ok(match published {
            None => Publication::MissingDraft,
            Some(report) => Publication::Published {
                media_key: report
                    .get_document("media")
                    .ok()
                    .and_then(|media| media.get_str("objectKey").ok())
                    .map(str::to_owned),
            },
        })
    }
}

impl From<mongodb::error::Error> for CaptureError {
    fn from(error: mongodb::error::Error) -> Self {
        eprintln!("MongoDB operation failed: {error}");
        Self::DatabaseUnavailable
    }
}

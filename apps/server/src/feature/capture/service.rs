use super::{
    dto::{FinalizeInput, TokenResponse, UploadInput, UploadResponse},
    model::{
        CaptureError, CaptureKey, CaptureToken, Draft, DraftArtifacts, DraftDetails, DraftOwner, Publication, PublishedMedia,
        TOKEN_LIFETIME_MS, new_secret, normalize_origin, now_ms, select_media_type,
        upload_url_lifetime, validate_media,
    },
    repository::CaptureRepository,
};
use crate::adapter::s3::Storage;

pub(super) struct CaptureCredentials<'a> {
    pub public_key: Option<&'a str>,
    pub origin: Option<&'a str>,
    pub token: Option<&'a str>,
}

pub(super) struct CaptureService<'a> {
    pub repository: CaptureRepository<'a>,
    pub storage: Option<&'a Storage>,
}

impl CaptureService<'_> {
    pub async fn issue_token(
        &self,
        credentials: CaptureCredentials<'_>,
    ) -> Result<TokenResponse, CaptureError> {
        let (key, origin) = self.authorize_key(&credentials).await?;
        let token = new_secret("zt_").map_err(|_| CaptureError::TokenGeneration)?;
        let expires_at = self
            .repository
            .insert_token(&token, &key, &origin, now_ms() + TOKEN_LIFETIME_MS)
            .await?;
        Ok(TokenResponse { token, expires_at })
    }

    pub async fn create_upload_session(
        &self,
        credentials: CaptureCredentials<'_>,
        input: UploadInput,
    ) -> Result<UploadResponse, CaptureError> {
        let (key, origin) = self.authorize_key(&credentials).await?;
        let raw_token = capture_token(credentials.token)?;
        let now = now_ms();
        let token = self
            .repository
            .token(raw_token, &key, &origin, now, None)
            .await?;
        self.create_draft(DraftOwner::embed(&key), token, input, Some(raw_token.to_owned()), now).await
    }

    pub async fn create_member_draft(
        &self, workspace: &str, user_id: &str, request_id: Option<&str>, input: UploadInput,
    ) -> Result<UploadResponse, CaptureError> {
        let now = now_ms();
        let draft_id = request_id.map(|id| super::model::credential_hash(&format!("{workspace}:{user_id}:{id}")))
            .unwrap_or_else(CaptureRepository::new_id);
        let token = CaptureToken { draft_id, expires_at_ms: now + TOKEN_LIFETIME_MS };
        self.create_draft(DraftOwner::member(workspace, user_id), token, input, None, now).await
    }

    async fn create_draft(
        &self, owner: DraftOwner<'_>, token: CaptureToken, input: UploadInput,
        finalize_token: Option<String>, now: i64,
    ) -> Result<UploadResponse, CaptureError> {
        let storage = self.storage.ok_or(CaptureError::StorageUnavailable)?;
        let content_type = select_media_type(
            &input.attachment_type,
            input.capture_content_type.as_deref(),
        )
        .ok_or(CaptureError::InvalidUpload)?
        .to_owned();
        let visibility = match input.visibility {
            Some(visibility) => visibility,
            None => self.repository.default_visibility(owner.workspace_id).await?
                .unwrap_or_else(|| "private".to_owned()),
        };
        if !matches!(visibility.as_str(), "public" | "private" | "restricted")
            || input
                .title
                .as_deref()
                .is_some_and(|value| value.len() > 800)
            || input
                .description
                .as_deref()
                .is_some_and(|value| value.len() > 12000)
        {
            return Err(CaptureError::InvalidUpload);
        }

        let draft = Draft {
            artifacts: DraftArtifacts {
                media: format!("drafts/{}/capture", token.draft_id),
                debugger: input
                    .has_debugger_payload
                    .then(|| format!("drafts/{}/debugger", token.draft_id)),
                content_type,
            },
            details: DraftDetails {
                attachment_type: input.attachment_type,
                visibility,
                title: input.title,
                description: input.description,
                folder_id: input.folder_id,
            },
        };
        if let Some(folder) = draft.details.folder_id.as_deref() {
            if !crate::feature::folders::exists(self.repository.0, owner.workspace_id, folder).await.map_err(|_| CaptureError::DatabaseUnavailable)? {
                return Err(CaptureError::InvalidUpload);
            }
        }
        let expires_at = self.repository.save_draft(&owner, &token, &draft, now).await?;
        let duration = upload_url_lifetime(now_ms(), expires_at);
        if duration.is_zero() {
            return Err(CaptureError::InvalidToken);
        }

        let capture_upload = storage
            .sign_upload(
                &draft.artifacts.media,
                &draft.artifacts.content_type,
                duration,
            )
            .await
            .map_err(|_| CaptureError::StorageUnavailable)?;
        let debugger_upload = match &draft.artifacts.debugger {
            Some(key) => Some(
                storage
                    .sign_upload(key, "application/json", duration)
                    .await
                    .map_err(|_| CaptureError::StorageUnavailable)?,
            ),
            None => None,
        };
        Ok(UploadResponse {
            bug_report_id: token.draft_id,
            capture_upload,
            debugger_upload,
            finalize_token,
        })
    }

    pub async fn finalize(
        &self,
        credentials: CaptureCredentials<'_>,
        input: &FinalizeInput,
    ) -> Result<(), CaptureError> {
        let (key, origin) = self.authorize_key(&credentials).await?;
        let raw_token = capture_token(credentials.token)?;
        let now = now_ms();
        self.repository
            .token(raw_token, &key, &origin, now, Some(&input.id))
            .await?;
        self.finalize_draft(DraftOwner::embed(&key), input, now).await
    }

    /// Receives the capture (or debugger payload) through the server instead of a presigned storage URL,
    /// so clients only ever talk to the Zapp server they are configured with.
    pub async fn upload_member_artifact<E>(
        &self, workspace: &str, user_id: &str, id: &str, debugger: bool,
        body: impl futures_util::Stream<Item = Result<axum::body::Bytes, E>> + Unpin,
    ) -> Result<(), CaptureError>
    where
        E: std::error::Error + Send + Sync + 'static,
    {
        let storage = self.storage.ok_or(CaptureError::StorageUnavailable)?;
        let draft = self.repository.draft(&DraftOwner::member(workspace, user_id), id, now_ms()).await?;
        let (key, content_type, max) = if debugger {
            let key = draft.artifacts.debugger.ok_or(CaptureError::InvalidUpload)?;
            (key, "application/json".to_owned(), 10 * 1024 * 1024)
        } else {
            (draft.artifacts.media, draft.artifacts.content_type, 100 * 1024 * 1024)
        };
        match storage.put_stream(&key, &content_type, body, max).await {
            Ok(true) => Ok(()),
            Ok(false) => Err(CaptureError::InvalidMedia(super::model::MediaValidation::Size)),
            Err(_) => Err(CaptureError::StorageUnavailable),
        }
    }

    pub async fn finalize_member_draft(&self, workspace: &str, user: &str, input: &FinalizeInput) -> Result<(), CaptureError> {
        self.finalize_draft(DraftOwner::member(workspace, user), input, now_ms()).await
    }

    async fn finalize_draft(&self, owner: DraftOwner<'_>, input: &FinalizeInput, now: i64) -> Result<(), CaptureError> {
        if self.repository.report_exists(&owner, &input.id).await? {
            return Ok(());
        }
        let draft = match self.repository.draft(&owner, &input.id, now).await {
            Ok(draft) => draft,
            Err(CaptureError::DraftNotFound) => {
                if self.repository.report_exists(&owner, &input.id).await? {
                    return Ok(());
                }
                return Err(CaptureError::DraftNotFound);
            }
            Err(error) => return Err(error),
        };
        let encoding = input
            .debugger_content_encoding
            .as_deref()
            .unwrap_or("identity");
        if !matches!(encoding, "gzip" | "identity") {
            return Err(CaptureError::InvalidUpload);
        }
        let storage = self.storage.ok_or(CaptureError::StorageUnavailable)?;
        let (size, media_type) = storage
            .metadata(&draft.artifacts.media)
            .await
            .map_err(map_media_error)?;
        validate_media(size, media_type.as_deref(), &draft.artifacts.content_type)
            .map_err(CaptureError::InvalidMedia)?;

        // Only the draft key accepts browser PUTs. Serve the report from a server-owned copy.
        let published_key = format!("reports/{}/{}", input.id, CaptureRepository::new_id());
        storage
            .copy_media(&draft.artifacts.media, &published_key)
            .await
            .map_err(map_media_error)?;
        let (size, media_type) = storage
            .metadata(&published_key)
            .await
            .map_err(map_media_error)?;
        if let Err(error) =
            validate_media(size, media_type.as_deref(), &draft.artifacts.content_type)
        {
            let _ = storage.delete_media(&published_key).await;
            return Err(CaptureError::InvalidMedia(error));
        }

        let media = PublishedMedia {
            key: &published_key,
            size,
        };
        match self
            .repository
            .publish(&owner, &input.id, &draft, media, encoding, now)
            .await?
        {
            Publication::Published { media_key } => {
                if media_key.as_deref() != Some(published_key.as_str()) {
                    let _ = storage.delete_media(&published_key).await;
                }
                Ok(())
            }
            Publication::MissingDraft => {
                let _ = storage.delete_media(&published_key).await;
                Err(CaptureError::DraftNotFound)
            }
        }
    }

    async fn authorize_key(
        &self,
        credentials: &CaptureCredentials<'_>,
    ) -> Result<(CaptureKey, String), CaptureError> {
        let raw_key = credentials
            .public_key
            .filter(|value| !value.is_empty() && value.len() <= 256)
            .ok_or(CaptureError::InvalidKey)?;
        let origin = credentials
            .origin
            .and_then(normalize_origin)
            .ok_or(CaptureError::ForbiddenOrigin)?;
        let key = self.repository.active_key(raw_key).await?;
        if !key.allowed_origins.contains(&origin) {
            return Err(CaptureError::ForbiddenOrigin);
        }
        Ok((key, origin))
    }
}

fn capture_token(raw_token: Option<&str>) -> Result<&str, CaptureError> {
    raw_token
        .filter(|value| value.len() <= 256)
        .ok_or(CaptureError::InvalidToken)
}

fn map_media_error(error: object_store::Error) -> CaptureError {
    if matches!(error, object_store::Error::NotFound { .. }) {
        CaptureError::MediaNotUploaded
    } else {
        CaptureError::StorageUnavailable
    }
}

use axum::{
    Json,
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
};

use super::{
    dto::{FinalizeInput, FinalizeOptions, FinalizeResponse, TokenResponse, UploadInput, UploadResponse},
    model::{CaptureError, MediaValidation},
    repository::CaptureRepository,
    service::{CaptureCredentials, CaptureService},
};
use crate::adapter::http::{ApiError, AppState};
use crate::feature::{auth::Session, workspaces::active_workspace};

pub(super) async fn issue_token(
    State(state): State<AppState>,
    headers: HeaderMap,
) -> Result<Json<TokenResponse>, ApiError> {
    Ok(Json(
        service(&state)
            .issue_token(credentials(&headers, None))
            .await?,
    ))
}

pub(super) async fn create_upload_session(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<UploadInput>,
) -> Result<Json<UploadResponse>, ApiError> {
    let credentials = credentials(&headers, Some("x-crikket-capture-token"));
    Ok(Json(
        service(&state)
            .create_upload_session(credentials, input)
            .await?,
    ))
}

pub(super) async fn finalize(
    State(state): State<AppState>,
    headers: HeaderMap,
    Json(input): Json<FinalizeInput>,
) -> Result<Json<FinalizeResponse>, ApiError> {
    let credentials = credentials(&headers, Some("x-crikket-capture-finalize-token"));
    service(&state).finalize(credentials, &input).await?;
    Ok(Json(finalized(&state, input.id)))
}

pub(super) async fn member_upload_session(
    State(state): State<AppState>, session: Session, headers: HeaderMap, Json(input): Json<UploadInput>,
) -> Result<Json<UploadResponse>, ApiError> {
    let workspace = active_workspace(&state.db, &session).await?;
    let request_id = headers.get("idempotency-key").map(|value| value.to_str().ok()
        .filter(|value| !value.is_empty() && value.len() <= 128)
        .ok_or(ApiError::invalid("Invalid Idempotency-Key."))).transpose()?;
    Ok(Json(service(&state).create_member_draft(workspace, &session.user_id, request_id, input).await?))
}

pub(super) async fn member_finalize(
    State(state): State<AppState>, session: Session, Path(id): Path<String>, options: Option<Json<FinalizeOptions>>,
) -> Result<Json<FinalizeResponse>, ApiError> {
    let workspace = active_workspace(&state.db, &session).await?;
    let input = FinalizeInput { id, debugger_content_encoding: options.and_then(|Json(body)| body.debugger_content_encoding) };
    service(&state).finalize_member_draft(workspace, &session.user_id, &input).await?;
    Ok(Json(finalized(&state, input.id)))
}

fn finalized(state: &AppState, id: String) -> FinalizeResponse {
    FinalizeResponse {
        share_url: format!("{}/s/{}", state.web_origin, id),
        report_id: id.clone(),
        id,
        warnings: Vec::new(),
    }
}

fn service(state: &AppState) -> CaptureService<'_> {
    CaptureService {
        repository: CaptureRepository(&state.db),
        storage: state.storage.as_ref(),
    }
}

fn credentials<'a>(headers: &'a HeaderMap, token_header: Option<&str>) -> CaptureCredentials<'a> {
    let value = |key| headers.get(key).and_then(|value| value.to_str().ok());
    CaptureCredentials {
        public_key: value("x-crikket-public-key"),
        origin: value("origin"),
        token: token_header.and_then(value),
    }
}

impl From<CaptureError> for ApiError {
    fn from(error: CaptureError) -> Self {
        use CaptureError::*;
        match error {
            InvalidKey => Self(
                StatusCode::UNAUTHORIZED,
                "UNAUTHORIZED",
                "An active capture key is required.",
            ),
            ForbiddenOrigin => Self(
                StatusCode::FORBIDDEN,
                "FORBIDDEN",
                "This origin is not allowed to capture.",
            ),
            TokenGeneration => Self(
                StatusCode::INTERNAL_SERVER_ERROR,
                "TOKEN_ERROR",
                "Could not generate a capture token.",
            ),
            TokenExpirationEncoding => Self(
                StatusCode::INTERNAL_SERVER_ERROR,
                "TOKEN_ERROR",
                "Could not encode token expiration.",
            ),
            InvalidUpload => Self(
                StatusCode::BAD_REQUEST,
                "INVALID_UPLOAD",
                "Invalid capture type or report metadata.",
            ),
            InvalidToken => Self(
                StatusCode::UNAUTHORIZED,
                "UNAUTHORIZED",
                "A valid capture token is required.",
            ),
            DraftConflict => Self(
                StatusCode::CONFLICT,
                "DRAFT_CONFLICT",
                "This token is already bound to a different or published draft.",
            ),
            DraftNotFound => Self(
                StatusCode::NOT_FOUND,
                "NOT_FOUND",
                "Capture draft not found.",
            ),
            MediaNotUploaded => Self(
                StatusCode::CONFLICT,
                "MEDIA_NOT_UPLOADED",
                "Upload the capture before finalizing.",
            ),
            InvalidMedia(MediaValidation::Size) => Self(
                StatusCode::UNPROCESSABLE_ENTITY,
                "INVALID_MEDIA_SIZE",
                "Capture must be between 1 byte and 100 MiB.",
            ),
            InvalidMedia(MediaValidation::ContentType) => Self(
                StatusCode::UNPROCESSABLE_ENTITY,
                "INVALID_MEDIA_TYPE",
                "The uploaded media type differs from the draft.",
            ),
            StorageUnavailable => Self(
                StatusCode::SERVICE_UNAVAILABLE,
                "STORAGE_UNAVAILABLE",
                "Capture storage is unavailable.",
            ),
            DatabaseUnavailable => Self(
                StatusCode::SERVICE_UNAVAILABLE,
                "DATABASE_UNAVAILABLE",
                "Database operation failed.",
            ),
        }
    }
}

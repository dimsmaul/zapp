use serde::{Deserialize, Serialize};

use crate::adapter::s3::UploadTarget;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct UploadInput {
    pub attachment_type: String,
    pub capture_content_type: Option<String>,
    #[serde(default)]
    pub has_debugger_payload: bool,
    pub title: Option<String>,
    pub description: Option<String>,
    pub visibility: Option<String>,
    pub folder_id: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct FinalizeInput {
    pub id: String,
    pub debugger_content_encoding: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct FinalizeOptions {
    pub debugger_content_encoding: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct TokenResponse {
    pub token: String,
    pub expires_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct UploadResponse {
    pub bug_report_id: String,
    pub capture_upload: UploadTarget,
    pub debugger_upload: Option<UploadTarget>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub finalize_token: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct FinalizeResponse {
    pub id: String,
    pub report_id: String,
    pub warnings: Vec<String>,
    pub share_url: String,
}

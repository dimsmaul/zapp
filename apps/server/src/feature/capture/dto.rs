use serde::{Deserialize, Serialize};

use crate::adapter::s3::UploadTarget;

/// Where and on what a capture was recorded. Every field is optional text the report page shows on its Info tab.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Environment {
    pub url: Option<String>,
    pub title: Option<String>,
    pub os: Option<String>,
    pub os_version: Option<String>,
    pub architecture: Option<String>,
    pub browser: Option<String>,
    pub browser_version: Option<String>,
    pub window_width: Option<u32>,
    pub window_height: Option<u32>,
    pub timezone: Option<String>,
    pub language: Option<String>,
}

impl Environment {
    /// The stored form. Rejects over-long values so a client cannot fill the report with junk.
    pub fn to_document(&self) -> Option<mongodb::bson::Document> {
        let mut document = mongodb::bson::Document::new();
        let texts = [
            ("url", &self.url, 2048), ("title", &self.title, 300), ("os", &self.os, 80), ("osVersion", &self.os_version, 80),
            ("architecture", &self.architecture, 40), ("browser", &self.browser, 80), ("browserVersion", &self.browser_version, 80),
            ("timezone", &self.timezone, 80), ("language", &self.language, 40),
        ];
        for (key, value, max) in texts {
            let Some(value) = value else { continue };
            if value.chars().count() > max {
                return None;
            }
            document.insert(key, value.as_str());
        }
        for (key, value) in [("windowWidth", self.window_width), ("windowHeight", self.window_height)] {
            if let Some(value) = value {
                if value > 100_000 {
                    return None;
                }
                document.insert(key, i64::from(value));
            }
        }
        Some(document)
    }
}

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
    pub environment: Option<Environment>,
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

use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde_json::json;

#[derive(Clone, Copy, Debug)]
pub(crate) struct ApiError(pub StatusCode, pub &'static str, pub &'static str);

impl ApiError {
    pub(crate) const UNAUTHORIZED: Self = Self(StatusCode::UNAUTHORIZED, "UNAUTHORIZED", "Sign-in is required.");
    pub(crate) const FORBIDDEN: Self = Self(StatusCode::FORBIDDEN, "FORBIDDEN", "You do not have access.");
    pub(crate) const INTERNAL: Self = Self(StatusCode::INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", "The operation could not be completed.");
    pub(crate) const NOT_FOUND: Self = Self(StatusCode::NOT_FOUND, "NOT_FOUND", "Resource not found.");

    pub(crate) fn invalid(message: &'static str) -> Self {
        Self(StatusCode::BAD_REQUEST, "BAD_REQUEST", message)
    }

    pub(crate) fn conflict(message: &'static str) -> Self {
        Self(StatusCode::CONFLICT, "CONFLICT", message)
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let Self(status, code, message) = self;
        (status, Json(json!({ "code": code, "message": message }))).into_response()
    }
}

impl From<mongodb::error::Error> for ApiError {
    fn from(error: mongodb::error::Error) -> Self {
        eprintln!("MongoDB operation failed: {error}");
        Self(
            StatusCode::SERVICE_UNAVAILABLE,
            "DATABASE_UNAVAILABLE",
            "Database operation failed.",
        )
    }
}

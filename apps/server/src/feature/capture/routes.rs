use axum::{
    Router,
    extract::DefaultBodyLimit,
    http::{Method, header},
    routing::{post, put},
};
use tower_http::cors::{AllowOrigin, CorsLayer};

use super::controller;
use crate::adapter::http::AppState;

pub(crate) fn member_router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/captures/upload-sessions", post(controller::member_upload_session))
        // The handler enforces its own size limits while streaming, so axum's 2 MiB default is lifted here.
        .route(
            "/api/v1/captures/{id}/upload/{kind}",
            put(controller::member_upload).layer(DefaultBodyLimit::disable()),
        )
        .route("/api/v1/captures/{id}/finalize", post(controller::member_finalize))
}

pub(crate) fn router() -> Router<AppState> {
    Router::new()
        .route("/api/embed/capture-token", post(controller::issue_token))
        .route(
            "/api/embed/bug-report-upload-session",
            post(controller::create_upload_session),
        )
        .route("/api/embed/bug-report-finalize", post(controller::finalize))
        .layer(
            CorsLayer::new()
                .allow_origin(AllowOrigin::mirror_request())
                .allow_methods([Method::POST])
                .allow_headers([
                    header::CONTENT_TYPE,
                    header::HeaderName::from_static("x-crikket-public-key"),
                    header::HeaderName::from_static("x-crikket-capture-token"),
                    header::HeaderName::from_static("x-crikket-capture-finalize-token"),
                ]),
        )
}

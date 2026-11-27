mod controller;
mod tools;

use axum::{Router, extract::DefaultBodyLimit, routing::post};

use crate::adapter::http::AppState;

pub(crate) fn router() -> Router<AppState> {
    Router::new()
        .route("/mcp", post(controller::handle).get(controller::no_stream).delete(controller::no_stream))
        .layer(DefaultBodyLimit::max(32 * 1024))
}

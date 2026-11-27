mod controller;
mod model;
mod repository;
mod service;

use axum::{Router, routing::{get, post}};
use crate::adapter::http::AppState;

pub(crate) use model::{Session, bearer_token, normalize_email};

pub(crate) fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/auth/register", post(controller::register))
        .route("/api/v1/auth/login", post(controller::login))
        .route("/api/v1/auth/extension-session", post(controller::extension_session))
        .route("/api/v1/config", get(controller::config))
        .route("/api/v1/auth/logout", post(controller::logout))
        .route("/api/v1/session", get(controller::current))
}

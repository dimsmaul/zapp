mod controller;
mod normalize;
mod repository;
mod worker;

use axum::{Router, routing::get};
use crate::adapter::http::AppState;

pub use worker::run;
pub(crate) use repository::{Page, detail as read_network_detail, page as read_page};

pub(crate) fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/reports/{id}/events", get(controller::events))
        .route("/api/v1/reports/{id}/network", get(controller::network))
        .route("/api/v1/reports/{id}/network/{request_id}", get(controller::detail))
}

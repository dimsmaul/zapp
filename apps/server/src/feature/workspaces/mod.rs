mod controller;
mod repository;

use axum::{Router, routing::{delete, get, patch, post, put}};
use crate::adapter::http::AppState;

pub(crate) use repository::{active_workspace, membership};

pub(crate) fn router() -> Router<AppState> {
    Router::new()
        .route("/api/v1/workspaces", get(controller::list).post(controller::create))
        .route("/api/v1/workspaces/{id}", patch(controller::update).delete(controller::delete_workspace))
        .route("/api/v1/workspaces/{id}/leave", post(controller::leave))
        .route("/api/v1/session/workspace", put(controller::select))
        .route("/api/v1/workspaces/{id}/members", get(controller::members))
        .route("/api/v1/workspaces/{id}/members/{user_id}", patch(controller::change_role).delete(controller::remove_member))
        .route("/api/v1/workspaces/{id}/invitations", get(controller::invitations).post(controller::invite))
        .route("/api/v1/workspaces/{id}/invitations/{invitation_id}", delete(controller::revoke_invitation))
        .route("/api/v1/invitations/{token}/accept", post(controller::accept))
        .route("/api/v1/workspaces/{id}/capture-keys", get(controller::list_keys).post(controller::create_key))
        .route("/api/v1/workspaces/{id}/capture-keys/{key_id}", patch(controller::update_key).delete(controller::revoke_key))
}

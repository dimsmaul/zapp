mod error;

use axum::{
    Router,
    extract::State,
    http::{Method, StatusCode, header},
    routing::get,
};
use mongodb::Database;
use std::{io, net::SocketAddr};
use tokio::net::TcpListener;
use tower_http::cors::{AllowOrigin, CorsLayer};

pub(crate) use error::ApiError;

use crate::{
    adapter::{mongo, s3::Storage},
    feature::{auth, capture, debugger, mcp, reports, workspaces},
};

#[derive(Clone)]
pub(crate) struct AppState {
    pub db: Database,
    pub storage: Option<Storage>,
    pub web_origin: String,
}

pub fn router(db: Database) -> Router {
    router_with_storage(db, None)
}

pub async fn serve(addr: SocketAddr, db: Database, storage: Option<Storage>) -> io::Result<()> {
    let listener = TcpListener::bind(addr).await?;
    println!(
        "Zapp backend listening on http://{}",
        listener.local_addr()?
    );
    axum::serve(listener, router_with_storage(db, storage)).await
}

pub fn router_with_storage(db: Database, storage: Option<Storage>) -> Router {
    Router::new()
        .route("/healthz", get(|| async { "OK" }))
        .route("/readyz", get(ready))
        .merge(capture::router())
        .merge(mcp::router())
        .merge(
            auth::router()
                .merge(workspaces::router())
                .merge(capture::member_router())
                .merge(reports::router())
                .merge(debugger::router())
                .layer(
                    CorsLayer::new()
                        .allow_origin(AllowOrigin::mirror_request())
                        .allow_methods([Method::GET, Method::POST, Method::PUT, Method::PATCH, Method::DELETE])
                        .allow_headers([
                            header::AUTHORIZATION,
                            header::CONTENT_TYPE,
                            header::HeaderName::from_static("x-zapp-share-token"),
                            header::HeaderName::from_static("idempotency-key"),
                        ]),
                ),
        )
        .with_state(AppState {
            db,
            storage,
            web_origin: std::env::var("ZAPP_WEB_ORIGIN")
                .unwrap_or_else(|_| "http://localhost:5173".to_owned())
                .trim_end_matches('/')
                .to_owned(),
        })
}

async fn ready(State(state): State<AppState>) -> StatusCode {
    match mongo::is_ready(&state.db).await {
        Ok(true) => StatusCode::OK,
        _ => StatusCode::SERVICE_UNAVAILABLE,
    }
}

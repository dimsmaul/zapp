use axum::{
    Json,
    extract::{State, rejection::JsonRejection},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
};
use serde_json::{Value, json};

use super::tools;
use crate::{adapter::http::{ApiError, AppState}, feature::{auth::Session, tokens}};

const VERSION: &str = "2025-11-25";

pub(super) async fn handle(
    State(state): State<AppState>,
    headers: HeaderMap,
    session: Result<Session, ApiError>,
    body: Result<Json<Value>, JsonRejection>,
) -> Response {
    let response = match authorize(&state, &headers, session).await {
        Ok(user) => dispatch(&state, &user, body).await,
        Err(response) => response,
    };
    no_store(response)
}

pub(super) async fn no_stream(
    State(state): State<AppState>,
    headers: HeaderMap,
    session: Result<Session, ApiError>,
) -> Response {
    no_store(match authorize(&state, &headers, session).await {
        Ok(_) => (StatusCode::METHOD_NOT_ALLOWED, [(header::ALLOW, "POST")]).into_response(),
        Err(response) => response,
    })
}

/// Returns the user making the request: either a signed-in session or an agent's personal access token.
async fn authorize(state: &AppState, headers: &HeaderMap, session: Result<Session, ApiError>) -> Result<String, Response> {
    for origin in headers.get_all(header::ORIGIN) {
        if origin.to_str().ok() != Some(state.web_origin.as_str()) {
            return Err(StatusCode::FORBIDDEN.into_response());
        }
    }
    let unauthorized = || (
        StatusCode::UNAUTHORIZED,
        [(header::WWW_AUTHENTICATE, "Bearer realm=\"zapp-mcp\"")],
    ).into_response();
    let user = match session {
        Ok(session) => session.user_id,
        Err(error) if error.0 == StatusCode::UNAUTHORIZED => {
            match tokens::user_for_token(&state.db, headers).await {
                Ok(Some(user)) => user,
                Ok(None) => return Err(unauthorized()),
                Err(error) => return Err(error.into_response()),
            }
        }
        Err(error) => return Err(error.into_response()),
    };
    if let Some(version) = headers.get("mcp-protocol-version") {
        if version.to_str().ok() != Some(VERSION) {
            return Err(rpc_error(StatusCode::BAD_REQUEST, &Value::Null, -32600, "Unsupported MCP protocol version."));
        }
    }
    Ok(user)
}

async fn dispatch(
    state: &AppState,
    user: &str,
    body: Result<Json<Value>, JsonRejection>,
) -> Response {
    let Json(request) = match body {
        Ok(body) => body,
        Err(JsonRejection::JsonSyntaxError(_)) => {
            return rpc_error(StatusCode::BAD_REQUEST, &Value::Null, -32700, "Invalid JSON.");
        }
        Err(error) => return error.into_response(),
    };
    let id = request.get("id");
    let Some(method) = request.get("method").and_then(Value::as_str).filter(|_| {
        request.get("jsonrpc").and_then(Value::as_str) == Some("2.0")
            && id.is_none_or(|value| value.is_string() || value.is_i64() || value.is_u64())
    }) else {
        return rpc_error(StatusCode::BAD_REQUEST, &Value::Null, -32600, "Invalid JSON-RPC request.");
    };
    let Some(id) = id else {
        return StatusCode::ACCEPTED.into_response();
    };
    let params = request.get("params");
    let result = match method {
        "initialize" => {
            if params.and_then(|params| params.get("protocolVersion")).and_then(Value::as_str).is_none() {
                return rpc_error(StatusCode::OK, id, -32602, "Missing MCP protocol version.");
            }
            json!({
                "protocolVersion": VERSION,
                "capabilities": { "tools": {} },
                "serverInfo": { "name": "zapp", "version": env!("CARGO_PKG_VERSION") },
            })
        }
        "ping" => json!({}),
        "tools/list" => json!({ "tools": tools::list() }),
        "tools/call" => {
            let Some(call) = params.and_then(tools::Call::parse) else {
                return rpc_error(StatusCode::OK, id, -32602, "Unknown tool or invalid arguments.");
            };
            match call.run(&state.db, user).await {
                Ok(data) => json!({
                    "content": [{ "type": "text", "text": data.to_string() }],
                    "structuredContent": data,
                    "isError": false,
                }),
                Err(error) => json!({
                    "content": [{ "type": "text", "text": error.2 }],
                    "isError": true,
                }),
            }
        }
        _ => return rpc_error(StatusCode::OK, id, -32601, "Method not found."),
    };
    Json(json!({ "jsonrpc": "2.0", "id": id, "result": result })).into_response()
}

fn rpc_error(status: StatusCode, id: &Value, code: i32, message: &str) -> Response {
    (status, Json(json!({
        "jsonrpc": "2.0", "id": id, "error": { "code": code, "message": message }
    }))).into_response()
}

fn no_store(mut response: Response) -> Response {
    response.headers_mut().insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

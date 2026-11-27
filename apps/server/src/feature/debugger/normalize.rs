use std::io::Read;

use flate2::read::MultiGzDecoder;
use mongodb::bson::{self, Document, doc};
use serde_json::{Map, Value, json};
use url::Url;

pub(super) const MAX_WIRE_BYTES: usize = 10 * 1024 * 1024;
const MAX_DECODED_BYTES: usize = 16 * 1024 * 1024;
const MAX_EVENTS: usize = 10_000;
const MAX_DETAIL_BYTES: usize = 128 * 1024;
const MAX_BATCH_BYTES: usize = 24 * 1024 * 1024;

const SUMMARY_FIELDS: &[&str] = &[
    "method", "url", "status", "statusCode", "duration", "durationMs", "resourceType",
    "transport", "applicationProtocol", "operationName", "operationType", "connectionId",
    "streamId", "direction", "opcode", "size", "eventName", "messageId", "topic", "qos",
    "level", "message", "targetLabel", "selector", "type", "failed",
];

pub(super) struct Batch {
    pub events: Vec<Document>,
    pub details: Vec<Document>,
}

pub(super) fn decode(report: &str, encoding: &str, bytes: Vec<u8>) -> Option<Batch> {
    let decoded = match encoding {
        "gzip" => {
            let mut decoded = Vec::new();
            MultiGzDecoder::new(bytes.as_slice()).take((MAX_DECODED_BYTES + 1) as u64)
                .read_to_end(&mut decoded).ok()?;
            if decoded.len() > MAX_DECODED_BYTES { return None; }
            decoded
        }
        "" | "identity" => bytes,
        _ => return None,
    };
    let payload: Value = serde_json::from_slice(&decoded).ok()?;
    let payload = payload.as_object()?;
    let mut batch = Batch { events: Vec::new(), details: Vec::new() };
    let mut remaining = MAX_BATCH_BYTES;
    if let Some(events) = payload.get("events") {
        for event in events.as_array()? {
            push_event(&mut batch, &mut remaining, report, event.as_object()?, None)?;
        }
    } else {
        let mut recognized = false;
        for (key, category) in [("actions", "action"), ("logs", "console"), ("networkRequests", "network")] {
            if let Some(events) = payload.get(key) {
                recognized = true;
                for event in events.as_array()? {
                    push_event(&mut batch, &mut remaining, report, event.as_object()?, Some(category))?;
                }
            }
        }
        if !recognized { return None; }
    }
    Some(batch)
}

fn push_event(
    batch: &mut Batch,
    remaining: &mut usize,
    report: &str,
    event: &Map<String, Value>,
    legacy_category: Option<&str>,
) -> Option<()> {
    if batch.events.len() >= MAX_EVENTS { return None; }
    let category = legacy_category.or_else(|| event.get("category").and_then(Value::as_str))?;
    if !matches!(category, "action" | "console" | "network") { return None; }
    let default_kind = match category {
        "action" => "action.observation",
        "console" => "console.log",
        "network" if legacy_category.is_some() => "http.request",
        _ => "network.observation",
    };
    let kind = event.get("kind").and_then(Value::as_str)
        .filter(|kind| kind.len() <= 64 && kind.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'-')
        }) && !kind.is_empty()).unwrap_or(default_kind);
    let offset = event.get("offsetMs").or_else(|| event.get("offset")).and_then(Value::as_f64)
        .unwrap_or_default().clamp(0.0, f64::from(i32::MAX)).round() as i32;
    let version = event.get("schemaVersion").and_then(Value::as_i64)
        .and_then(|value| i32::try_from(value).ok()).filter(|value| *value > 0).unwrap_or(1);
    let data = event.get("data").and_then(Value::as_object).unwrap_or(event);
    let mut summary: Map<_, _> = SUMMARY_FIELDS.iter().filter_map(|key| {
        let value = data.get(*key)?;
        if value.is_array() || value.is_object() { return None; }
        Some(((*key).to_owned(), scrub(value, key, 0)))
    }).collect();
    if legacy_category == Some("action") {
        if let Some(target) = event.get("target").filter(|value| value.is_string()) {
            summary.insert("targetLabel".to_owned(), scrub(target, "targetLabel", 0));
        }
    }
    let summary = bson::to_document(&summary).ok()?;
    let id = format!("{report}:{:08}", batch.events.len());
    batch.events.push(doc! {
        "_id": &id, "reportId": report, "category": category, "kind": kind,
        "offsetMs": offset, "schemaVersion": version, "data": summary,
    });
    if category == "network" {
        let mut details = if legacy_category.is_some() { legacy_detail(event) } else {
            event.get("details").filter(|value| value.is_object()).cloned().unwrap_or_else(|| json!({}))
        };
        if let Some(request) = details.get_mut("request").and_then(Value::as_object_mut) {
            add_url_fields(request);
        }
        let detail = scrub(&details, "", 0);
        let size = serde_json::to_vec(&detail).ok()?.len();
        let detail = if size <= MAX_DETAIL_BYTES && size <= *remaining {
            *remaining -= size;
            bson::to_document(&detail).ok()?
        } else {
            doc! { "state": "omitted", "reason": "size_limit" }
        };
        batch.details.push(doc! { "_id": id, "reportId": report, "detail": detail });
    }
    Some(())
}

fn legacy_detail(event: &Map<String, Value>) -> Value {
    json!({
        "request": {
            "method": event.get("method"),
            "url": event.get("url"),
            "headers": event.get("requestHeaders"),
            "body": legacy_body(event.get("requestBody")),
        },
        "response": {
            "status": event.get("status"),
            "headers": event.get("responseHeaders"),
            "body": legacy_body(event.get("responseBody")),
        },
        "timing": { "durationMs": event.get("duration") },
    })
}

fn add_url_fields(request: &mut Map<String, Value>) {
    let Some(url) = request.get("url").and_then(Value::as_str).and_then(safe_url) else {
        return;
    };
    request.entry("path").or_insert_with(|| json!(url.path()));
    request.entry("query").or_insert_with(|| {
        let query: Vec<_> = url.query_pairs()
            .map(|(name, value)| json!({ "name": name, "value": value })).collect();
        json!(query)
    });
}

fn legacy_body(body: Option<&Value>) -> Value {
    match body.filter(|value| !value.is_null()) {
        Some(Value::String(text)) => match serde_json::from_str::<Value>(text) {
            Ok(value @ (Value::Object(_) | Value::Array(_))) => json!({ "state": "captured", "value": value }),
            _ => json!({ "state": "omitted", "reason": "opaque_legacy_payload" }),
        },
        Some(value) => json!({ "state": "captured", "value": value }),
        None => json!({ "state": "unavailable" }),
    }
}

fn scrub(value: &Value, key: &str, depth: usize) -> Value {
    if sensitive(key) { return json!("[REDACTED]"); }
    if depth == 16 { return json!("[OMITTED]"); }
    match value {
        Value::Object(fields) => {
            let redact_pair = fields.get("name").or_else(|| fields.get("key"))
                .and_then(Value::as_str).is_some_and(sensitive);
            Value::Object(fields.iter().map(|(key, value)| {
                let value = if redact_pair && key == "value" {
                    json!("[REDACTED]")
                } else {
                    scrub(value, key, depth + 1)
                };
                (key.clone(), value)
            }).collect())
        }
        Value::Array(items) => {
            if items.len() == 2 && items[0].as_str().is_some_and(sensitive) {
                return json!([items[0], "[REDACTED]"]);
            }
            Value::Array(items.iter().map(|item| scrub(item, key, depth + 1)).collect())
        }
        Value::String(text) if key.eq_ignore_ascii_case("url") || key.eq_ignore_ascii_case("location") => {
            safe_url(text).map(|url| Value::String(url.into())).unwrap_or(Value::Null)
        }
        Value::String(_) if key.eq_ignore_ascii_case("body") => scrub(&legacy_body(Some(value)), "", depth + 1),
        Value::String(text) => Value::String(text.chars().take(4096).collect()),
        _ => value.clone(),
    }
}

fn safe_url(input: &str) -> Option<Url> {
    if input.len() > 8192 { return None; }
    let mut url = Url::parse(input).ok()?;
    if !matches!(url.scheme(), "http" | "https" | "ws" | "wss") { return None; }
    url.set_username("").ok()?;
    url.set_password(None).ok()?;
    url.set_fragment(None);
    if url.query().is_some() {
        let query: Vec<_> = url.query_pairs().map(|(key, value)| {
            let value = if sensitive(&key) { "[REDACTED]".to_owned() } else { value.into_owned() };
            (key.into_owned(), value)
        }).collect();
        url.query_pairs_mut().clear().extend_pairs(query);
    }
    Some(url)
}

fn sensitive(key: &str) -> bool {
    let key = key.to_ascii_lowercase().replace(['-', '_', ' '], "");
    matches!(key.as_str(), "auth" | "credential" | "credentials" | "session" | "sessionid")
        || ["authorization", "cookie", "password", "passwd", "token", "secret", "apikey"]
            .iter().any(|needle| key.contains(*needle))
}

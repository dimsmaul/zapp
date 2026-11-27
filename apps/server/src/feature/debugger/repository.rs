use futures_util::TryStreamExt;
use mongodb::{Database, bson::{Document, doc}};
use serde::Deserialize;
use serde_json::{Value, json};

use crate::adapter::http::ApiError;

#[derive(Deserialize)]
pub(crate) struct Page {
    pub limit: Option<u32>,
    pub cursor: Option<String>,
}

pub(crate) async fn page(
    db: &Database,
    report: &Document,
    category: Option<&str>,
    page: Page,
) -> Result<Value, ApiError> {
    let report_id = report.get_str("_id").map_err(|_| ApiError::NOT_FOUND)?;
    let (items, cursor) = list(db, report_id, category, page).await?;
    Ok(json!({
        "items": items,
        "nextCursor": cursor,
        "debuggerStatus": report.get_str("debuggerStatus").ok(),
    }))
}

async fn list(db: &Database, report_id: &str, category: Option<&str>, page: Page) -> Result<(Vec<Value>, Option<String>), ApiError> {
    let mut filter = doc! { "reportId": report_id };
    if let Some(category) = category {
        filter.insert("category", category);
    }
    if let Some(cursor) = page.cursor.as_deref() {
        let (offset, id) = cursor.split_once(':').ok_or(ApiError::invalid("Invalid event cursor."))?;
        let offset: i32 = offset.parse().map_err(|_| ApiError::invalid("Invalid event cursor."))?;
        if offset < 0 || id.is_empty() || id.len() > 160 {
            return Err(ApiError::invalid("Invalid event cursor."));
        }
        filter.insert("$or", vec![
            doc! { "offsetMs": { "$gt": offset } },
            doc! { "offsetMs": offset, "_id": { "$gt": id } },
        ]);
    }
    let limit = i64::from(page.limit.unwrap_or(50).clamp(1, 100));
    let mut events: Vec<Document> = db.collection::<Document>("report_events").find(filter)
        .projection(doc! { "_id": 1, "offsetMs": 1, "category": 1, "kind": 1, "schemaVersion": 1, "data": 1 })
        .sort(doc! { "offsetMs": 1, "_id": 1 }).limit(limit + 1).await?.try_collect().await?;
    let more = events.len() > limit as usize;
    events.truncate(limit as usize);
    let next = events.last().filter(|_| more).and_then(|event| {
        Some(format!("{}:{}", event.get_i32("offsetMs").ok()?, event.get_str("_id").ok()?))
    });
    Ok((events.iter().map(event_view).collect(), next))
}

pub(crate) async fn detail(db: &Database, report_id: &str, id: &str) -> Result<Value, ApiError> {
    let event = db.collection::<Document>("report_events").find_one(doc! {
        "_id": id, "reportId": report_id, "category": "network",
    }).await?.ok_or(ApiError::NOT_FOUND)?;
    let details = db.collection::<Document>("report_event_details").find_one(doc! {
        "_id": id, "reportId": report_id,
    }).await?;
    Ok(json!({ "event": event_view(&event), "details": details.as_ref().and_then(|doc| doc.get_document("detail").ok()) }))
}

fn event_view(event: &Document) -> Value {
    json!({
        "id": event.get_str("_id").ok(), "offsetMs": event.get_i32("offsetMs").ok(),
        "category": event.get_str("category").ok(), "kind": event.get_str("kind").ok(),
        "schemaVersion": event.get_i32("schemaVersion").ok(), "data": event.get_document("data").ok(),
    })
}

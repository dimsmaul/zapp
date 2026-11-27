use std::time::Duration;

use futures_util::FutureExt;
use mongodb::{
    Database,
    bson::{DateTime, Document, doc, oid::ObjectId},
    error::{Error, Result},
    options::ReturnDocument,
};
use tokio::time::{sleep, timeout};

use super::normalize::{self, Batch, MAX_WIRE_BYTES};
use crate::adapter::s3::Storage;

pub async fn run(db: Database, storage: Storage) -> Result<()> {
    loop {
        let ingested = process_job(&db, &storage).await.unwrap_or_else(|error| {
            eprintln!("Debugger queue operation failed: {error}");
            false
        });
        let cleaned = clean_artifact(&db, &storage).await.unwrap_or_else(|error| {
            eprintln!("Artifact cleanup queue operation failed: {error}");
            false
        });
        if !ingested && !cleaned {
            sleep(Duration::from_secs(1)).await;
        }
    }
}

enum Outcome {
    Ready(Batch),
    Retry,
    Invalid,
    ReportMissing,
}

async fn process_job(db: &Database, storage: &Storage) -> Result<bool> {
    let now = DateTime::now();
    let lease = ObjectId::new().to_hex();
    let jobs = db.collection::<Document>("ingestion_jobs");
    let Some(job) = jobs.find_one_and_update(
        doc! {
            "kind": "debugger",
            "$or": [
                { "status": "pending", "nextAttemptAt": { "$lte": now } },
                { "status": "processing", "leaseUntil": { "$lte": now } },
            ],
        },
        doc! {
            "$set": { "status": "processing", "leaseToken": &lease, "leaseUntil": after(120_000) },
            "$inc": { "attempts": 1 },
        },
    ).sort(doc! { "nextAttemptAt": 1 }).return_document(ReturnDocument::After).await? else {
        return Ok(false);
    };
    let id = job.get_str("_id").map_err(Error::custom)?;
    let report_id = job.get_str("reportId").map_err(Error::custom)?;
    let attempt = job.get_i32("attempts").map_err(Error::custom)?;
    let claim = doc! { "_id": id, "status": "processing", "leaseToken": lease };
    let report_filter = doc! { "_id": report_id, "deletedAt": null };
    let mut processing_filter = report_filter.clone();
    processing_filter.insert("debuggerStatus", doc! { "$in": ["pending", "processing"] });
    let report = db.collection::<Document>("reports").find_one_and_update(
        processing_filter.clone(), doc! { "$set": { "debuggerStatus": "processing" } },
    ).await?;
    let outcome = match report {
        Some(report) if attempt <= 6 => load_events(storage, report_id, &report).await,
        Some(_) => Outcome::Invalid,
        None => Outcome::ReportMissing,
    };
    let (job_status, report_status) = match &outcome {
        Outcome::Ready(_) => ("done", "ready"),
        Outcome::Retry if attempt < 6 => ("pending", "pending"),
        Outcome::Retry | Outcome::Invalid => ("failed", "failed"),
        Outcome::ReportMissing => ("done", "failed"),
    };
    let update = doc! {
        "$set": { "status": job_status, "nextAttemptAt": retry_after(attempt) },
        "$unset": { "leaseUntil": "", "leaseToken": "" },
    };
    let mut tx = db.client().start_session().await?;
    tx.start_transaction().and_run(
        (db.clone(), claim, update, processing_filter, outcome, report_status),
        |tx, (db, claim, update, report, outcome, status)| async move {
            let updated = db.collection::<Document>("ingestion_jobs")
                .update_one(claim.clone(), update.clone()).session(&mut *tx).await?;
            if updated.matched_count == 0 { return Ok(()); }
            let report = db.collection::<Document>("reports")
                .update_one(report.clone(), doc! { "$set": { "debuggerStatus": *status } })
                .session(&mut *tx).await?;
            if report.matched_count == 1 {
                if let Outcome::Ready(batch) = outcome {
                    for (name, docs) in [("report_events", &batch.events), ("report_event_details", &batch.details)] {
                        for chunk in docs.chunks(128) {
                            db.collection::<Document>(name).insert_many(chunk.iter())
                                .session(&mut *tx).await?;
                        }
                    }
                }
            }
            Ok(())
        }.boxed(),
    ).await?;
    Ok(true)
}

async fn load_events(storage: &Storage, report_id: &str, report: &Document) -> Outcome {
    let Ok(debugger) = report.get_document("debugger") else { return Outcome::Invalid };
    let Ok(key) = debugger.get_str("objectKey") else { return Outcome::Invalid };
    let encoding = debugger.get_str("contentEncoding").unwrap_or("").to_owned();
    let bytes = match timeout(Duration::from_secs(45), storage.read_bounded(key, MAX_WIRE_BYTES)).await {
        Ok(Ok(Some(bytes))) => bytes,
        Ok(Ok(None)) => return Outcome::Invalid,
        Ok(Err(_)) | Err(_) => return Outcome::Retry,
    };
    let report_id = report_id.to_owned();
    match tokio::task::spawn_blocking(move || normalize::decode(&report_id, &encoding, bytes)).await {
        Ok(Some(batch)) => Outcome::Ready(batch),
        Ok(None) => Outcome::Invalid,
        Err(_) => Outcome::Retry,
    }
}

async fn clean_artifact(db: &Database, storage: &Storage) -> Result<bool> {
    let cleanup = db.collection::<Document>("artifact_cleanup");
    let Some(job) = cleanup.find_one(doc! { "nextAttemptAt": { "$lte": DateTime::now() } })
        .sort(doc! { "nextAttemptAt": 1 }).await? else {
        return Ok(false);
    };
    let key = job.get_str("objectKey").map_err(Error::custom)?;
    let id = job.get_str("_id").map_err(Error::custom)?;
    let attempts = job.get_i32("attempts").map_err(Error::custom)?;
    let filter = doc! { "_id": id, "attempts": attempts };
    match timeout(Duration::from_secs(20), storage.delete_media(key)).await {
        Ok(Ok(())) | Ok(Err(object_store::Error::NotFound { .. })) => {
            cleanup.delete_one(filter).await?;
        }
        _ => {
            cleanup.update_one(filter, doc! {
                "$inc": { "attempts": 1 }, "$set": { "nextAttemptAt": retry_after(attempts) },
            }).await?;
        }
    }
    Ok(true)
}

fn retry_after(attempt: i32) -> DateTime {
    after(1000 * (1_i64 << attempt.clamp(0, 10)))
}

fn after(millis: i64) -> DateTime {
    DateTime::from_millis(DateTime::now().timestamp_millis() + millis)
}

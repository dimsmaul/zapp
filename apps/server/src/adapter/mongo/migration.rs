use mongodb::{
    Database, IndexModel,
    bson::{DateTime, Document, doc},
    error::{ErrorKind, Result},
    options::IndexOptions,
};
use std::time::Duration;

pub const SCHEMA_VERSION: &str = "004_folders";

pub(crate) async fn is_ready(db: &Database) -> Result<bool> {
    Ok(db
        .collection::<Document>("schema_migrations")
        .find_one(doc! { "_id": SCHEMA_VERSION })
        .await?
        .is_some())
}

pub async fn migrate(db: &Database) -> Result<()> {
    for (name, fields) in [
        ("schema_migrations", &[][..]),
        ("users", &[("email", "string")][..]),
        (
            "user_sessions",
            &[("userId", "string"), ("expiresAt", "date")][..],
        ),
        ("workspaces", &[("name", "string")][..]),
        (
            "workspace_members",
            &[
                ("workspaceId", "string"),
                ("userId", "string"),
                ("role", "string"),
            ][..],
        ),
        (
            "capture_keys",
            &[
                ("workspaceId", "string"),
                ("keyHash", "string"),
                ("allowedOrigins", "array"),
            ][..],
        ),
        (
            "capture_tokens",
            &[
                ("workspaceId", "string"),
                ("keyId", "string"),
                ("origin", "string"),
                ("expiresAt", "date"),
            ][..],
        ),
        (
            "capture_drafts",
            &[
                ("workspaceId", "string"),
                ("status", "string"),
                ("artifacts", "object"),
                ("expiresAt", "date"),
            ][..],
        ),
        (
            "reports",
            &[
                ("workspaceId", "string"),
                ("draftId", "string"),
                ("visibility", "string"),
                ("media", "object"),
                ("debuggerStatus", "string"),
                ("createdAt", "date"),
            ][..],
        ),
        (
            "share_links",
            &[("reportId", "string"), ("tokenHash", "string")][..],
        ),
        (
            "ingestion_jobs",
            &[
                ("reportId", "string"),
                ("kind", "string"),
                ("status", "string"),
                ("attempts", "int"),
                ("nextAttemptAt", "date"),
            ][..],
        ),
        (
            "report_events",
            &[
                ("reportId", "string"),
                ("offsetMs", "int"),
                ("category", "string"),
                ("kind", "string"),
                ("schemaVersion", "int"),
                ("data", "object"),
            ][..],
        ),
    ] {
        create_collection(db, name, fields).await?;
    }

    for (collection, indexes) in [
        (
            "users",
            vec![index("unique_email", doc! {"email": 1}, true)],
        ),
        ("user_sessions", vec![expiration_index()]),
        (
            "workspace_members",
            vec![
                index("unique_member", doc! {"workspaceId": 1, "userId": 1}, true),
                index("user_workspaces", doc! {"userId": 1}, false),
            ],
        ),
        (
            "capture_keys",
            vec![
                index("unique_capture_key", doc! {"keyHash": 1}, true),
                index("workspace_keys", doc! {"workspaceId": 1}, false),
            ],
        ),
        ("capture_tokens", vec![expiration_index()]),
        (
            "capture_drafts",
            vec![index(
                "draft_cleanup",
                doc! {"status": 1, "expiresAt": 1},
                false,
            )],
        ),
        (
            "reports",
            vec![
                index("unique_draft", doc! {"draftId": 1}, true),
                index(
                    "workspace_reports",
                    doc! {"workspaceId": 1, "createdAt": -1, "_id": -1},
                    false,
                ),
            ],
        ),
        (
            "share_links",
            vec![
                index("unique_share_token", doc! {"tokenHash": 1}, true),
                index("report_links", doc! {"reportId": 1}, false),
            ],
        ),
        (
            "ingestion_jobs",
            vec![
                index("unique_report_job", doc! {"reportId": 1, "kind": 1}, true),
                index("due_jobs", doc! {"status": 1, "nextAttemptAt": 1}, false),
                index("expired_leases", doc! {"status": 1, "leaseUntil": 1}, false),
            ],
        ),
        (
            "report_events",
            vec![
                index(
                    "report_timeline",
                    doc! {"reportId": 1, "offsetMs": 1, "_id": 1},
                    false,
                ),
                index(
                    "report_category_timeline",
                    doc! {"reportId": 1, "category": 1, "offsetMs": 1, "_id": 1},
                    false,
                ),
            ],
        ),
    ] {
        db.collection::<Document>(collection)
            .create_indexes(indexes)
            .await?;
    }

    record_migration(db, "001_capture").await?;
    for (name, fields) in [
        ("workspace_invitations", &[("workspaceId", "string"), ("email", "string"), ("expiresAt", "date")][..]),
        ("auth_attempts", &[("count", "int"), ("expiresAt", "date")][..]),
        ("artifact_cleanup", &[("objectKey", "string"), ("attempts", "int"), ("nextAttemptAt", "date")][..]),
        ("report_event_details", &[("reportId", "string"), ("detail", "object")][..]),
    ] {
        create_collection(db, name, fields).await?;
    }
    for name in ["workspace_invitations", "auth_attempts"] {
        db.collection::<Document>(name).create_index(expiration_index()).await?;
    }
    db.collection::<Document>("artifact_cleanup")
        .create_index(index("due_cleanup", doc! { "nextAttemptAt": 1 }, false))
        .await?;
    db.collection::<Document>("report_event_details")
        .create_index(index("event_details_report", doc! { "reportId": 1 }, false))
        .await?;
    record_migration(db, "002_mvp_endpoints").await?;

    create_collection(db, "report_comments", &[
        ("reportId", "string"), ("authorId", "string"), ("body", "string"), ("createdAt", "date"),
    ]).await?;
    db.collection::<Document>("report_comments")
        .create_index(index("report_comments_timeline", doc! { "reportId": 1, "createdAt": 1, "_id": 1 }, false))
        .await?;
    record_migration(db, "003_comments").await?;

    create_collection(db, "folders", &[("workspaceId", "string"), ("name", "string"), ("createdAt", "date")]).await?;
    db.collection::<Document>("folders")
        .create_index(index("folders_by_workspace", doc! { "workspaceId": 1, "name": 1 }, false))
        .await?;
    create_collection(db, "recording_links", &[("workspaceId", "string"), ("token", "string"), ("createdAt", "date")]).await?;
    db.collection::<Document>("recording_links")
        .create_index(index("recording_links_token", doc! { "token": 1 }, true))
        .await?;
    record_migration(db, SCHEMA_VERSION).await
}

async fn record_migration(db: &Database, version: &str) -> Result<()> {
    db.collection::<Document>("schema_migrations")
        .update_one(
            doc! { "_id": version },
            doc! { "$setOnInsert": { "appliedAt": DateTime::now() } },
        )
        .upsert(true)
        .await?;
    Ok(())
}

async fn create_collection(db: &Database, name: &str, fields: &[(&str, &str)]) -> Result<()> {
    let mut required = vec!["_id"];
    let mut properties = doc! { "_id": { "bsonType": "string" } };
    for &(field, field_type) in fields {
        required.push(field);
        properties.insert(field, doc! { "bsonType": field_type });
    }
    if name == "reports" {
        properties.insert("visibility", doc! { "enum": ["private", "public", "restricted"] });
        properties.insert(
            "debuggerStatus",
            doc! { "enum": ["not_uploaded", "pending", "processing", "ready", "failed"] },
        );
    }
    let validator = doc! { "$jsonSchema": {
        "bsonType": "object", "required": required, "properties": properties
    }};
    match db
        .create_collection(name)
        .validator(validator.clone())
        .await
    {
        Ok(()) => Ok(()),
        Err(error) if matches!(error.kind.as_ref(), ErrorKind::Command(e) if e.code == 48) => {
            db.run_command(doc! { "collMod": name, "validator": validator })
                .await?;
            Ok(())
        }
        Err(error) => Err(error),
    }
}

fn index(name: &str, keys: Document, unique: bool) -> IndexModel {
    IndexModel::builder()
        .keys(keys)
        .options(
            IndexOptions::builder()
                .name(name.to_owned())
                .unique(unique)
                .build(),
        )
        .build()
}

fn expiration_index() -> IndexModel {
    IndexModel::builder()
        .keys(doc! { "expiresAt": 1 })
        .options(
            IndexOptions::builder()
                .name("expire_documents".to_owned())
                .expire_after(Duration::ZERO)
                .build(),
        )
        .build()
}

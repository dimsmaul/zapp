use mongodb::{
    Client,
    bson::{DateTime, doc},
};

#[tokio::test]
#[ignore = "requires an isolated MongoDB database in ZAPP_TEST_MONGODB_URI"]
async fn migration_is_repeatable_and_enforces_report_constraints() {
    let client = Client::with_uri_str(std::env::var("ZAPP_TEST_MONGODB_URI").unwrap())
        .await
        .unwrap();
    let db = client.database(&format!(
        "zapp_test_{}",
        mongodb::bson::oid::ObjectId::new()
    ));
    for _ in 0..2 {
        zapp_backend::db::migrate(&db).await.unwrap();
    }
    assert_eq!(db.list_collection_names().await.unwrap().len(), 16);
    let reports = db.collection("reports");
    assert!(reports.insert_one(doc! { "_id": "invalid" }).await.is_err());
    let report = doc! {
        "_id": "report-1", "workspaceId": "workspace-1", "draftId": "draft-1",
        "visibility": "private", "media": {}, "debuggerStatus": "not_uploaded",
        "createdAt": DateTime::now()
    };
    reports.insert_one(report.clone()).await.unwrap();
    let mut duplicate = report;
    duplicate.insert("_id", "report-2");
    assert!(reports.insert_one(duplicate).await.is_err());
    db.drop().await.unwrap();
}

#[tokio::test]
#[ignore = "requires an isolated MongoDB replica set in ZAPP_TEST_MONGODB_URI"]
async fn publishing_same_draft_commit_once_with_one_debugger_job() {
    let client = Client::with_uri_str(std::env::var("ZAPP_TEST_MONGODB_URI").unwrap())
        .await
        .unwrap();
    let db = client.database(&format!(
        "zapp_test_{}",
        mongodb::bson::oid::ObjectId::new()
    ));
    zapp_backend::db::migrate(&db).await.unwrap();
    db.collection("capture_drafts").insert_one(doc! {
        "_id": "draft-1", "workspaceId": "workspace-1", "status": "uploading",
        "artifacts": {}, "expiresAt": DateTime::from_millis(DateTime::now().timestamp_millis() + 60000)
    }).await.unwrap();
    let candidate = doc! {
        "_id": "draft-1", "workspaceId": "workspace-1", "draftId": "draft-1",
        "visibility": "private", "media": { "objectKey": "media-1" },
        "debuggerStatus": "pending", "debugger": { "objectKey": "debugger-1" },
        "createdAt": DateTime::now()
    };
    let first = zapp_backend::reports::publish(&db, candidate.clone())
        .await
        .unwrap()
        .unwrap();
    let mut retry = candidate;
    retry.insert("media", doc! { "objectKey": "media-2" });
    let second = zapp_backend::reports::publish(&db, retry)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(first, second);
    assert_eq!(
        db.collection::<mongodb::bson::Document>("reports")
            .count_documents(doc! {})
            .await
            .unwrap(),
        1
    );
    let job = db
        .collection::<mongodb::bson::Document>("ingestion_jobs")
        .find_one(doc! {})
        .await
        .unwrap()
        .unwrap();
    assert_eq!(job.get_str("reportId").unwrap(), "draft-1");
    assert_eq!(
        db.collection::<mongodb::bson::Document>("ingestion_jobs")
            .count_documents(doc! {})
            .await
            .unwrap(),
        1
    );
    let draft = db
        .collection::<mongodb::bson::Document>("capture_drafts")
        .find_one(doc! { "_id": "draft-1" })
        .await
        .unwrap()
        .unwrap();
    assert_eq!(draft.get_str("status").unwrap(), "published");
    db.drop().await.unwrap();
}

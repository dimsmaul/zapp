use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use mongodb::{
    Client,
    bson::{DateTime, doc},
};
use tower::ServiceExt;
use zapp_backend::{app, db};

#[tokio::test]
#[ignore = "requires an isolated MongoDB database in ZAPP_TEST_MONGODB_URI"]
async fn capture_token_is_origin_bound_and_revocation_is_enforced() {
    let client = Client::with_uri_str(std::env::var("ZAPP_TEST_MONGODB_URI").unwrap())
        .await
        .unwrap();
    let database = client.database(&format!(
        "zapp_test_{}",
        mongodb::bson::oid::ObjectId::new()
    ));
    db::migrate(&database).await.unwrap();
    let keys = database.collection("capture_keys");
    keys.insert_one(doc! {
        "_id": "capture-key-1", "workspaceId": "workspace-1",
        "keyHash": "62af8704764faf8ea82fc61ce9c4c3908b6cb97d463a634e9e587d7c885db0ef",
        "allowedOrigins": ["https://example.test"]
    })
    .await
    .unwrap();
    let router = app::router(database.clone());
    let request = |origin| {
        Request::post("/api/embed/capture-token")
            .header("origin", origin)
            .header("x-crikket-public-key", "test-key")
            .body(Body::empty())
            .unwrap()
    };

    assert_eq!(
        router
            .clone()
            .oneshot(request("https://other.test"))
            .await
            .unwrap()
            .status(),
        StatusCode::FORBIDDEN
    );
    let response = router
        .clone()
        .oneshot(request("https://example.test"))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body: serde_json::Value =
        serde_json::from_slice(&to_bytes(response.into_body(), 4096).await.unwrap()).unwrap();
    let token = body["token"].as_str().unwrap();
    assert!(token.len() >= 32);
    assert!(body["expiresAt"].is_string());

    let stored = database
        .collection::<mongodb::bson::Document>("capture_tokens")
        .find_one(doc! { "keyId": "capture-key-1" })
        .await
        .unwrap()
        .unwrap();
    assert_eq!(stored.get_str("origin").unwrap(), "https://example.test");
    assert_ne!(stored.get_str("_id").unwrap(), token);
    assert!(*stored.get_datetime("expiresAt").unwrap() > DateTime::now());
    keys.update_one(
        doc! {"_id": "capture-key-1"},
        doc! {"$set": {"revokedAt": DateTime::now()}},
    )
    .await
    .unwrap();
    assert_eq!(
        router
            .oneshot(request("https://example.test"))
            .await
            .unwrap()
            .status(),
        StatusCode::UNAUTHORIZED
    );
    database.drop().await.unwrap();
}

#[tokio::test]
#[ignore = "requires an isolated MongoDB database in ZAPP_TEST_MONGODB_URI"]
async fn upload_session_reuses_its_draft_and_signs_both_artifacts() {
    let client = Client::with_uri_str(std::env::var("ZAPP_TEST_MONGODB_URI").unwrap())
        .await
        .unwrap();
    let database = client.database(&format!(
        "zapp_test_{}",
        mongodb::bson::oid::ObjectId::new()
    ));
    db::migrate(&database).await.unwrap();
    database
        .collection("capture_keys")
        .insert_one(doc! {
            "_id": "key-1", "workspaceId": "workspace-1",
            "keyHash": "62af8704764faf8ea82fc61ce9c4c3908b6cb97d463a634e9e587d7c885db0ef",
            "allowedOrigins": ["https://example.test"]
        })
        .await
        .unwrap();
    let store = zapp_backend::storage::Storage::new(
        "test-bucket",
        "auto",
        "test-id",
        "test-secret",
        Some("https://example-account.r2.cloudflarestorage.com"),
    )
    .unwrap();
    let router = app::router_with_storage(database.clone(), Some(store));
    let request = Request::post("/api/embed/capture-token")
        .header("origin", "https://example.test")
        .header("x-crikket-public-key", "test-key")
        .body(Body::empty())
        .unwrap();
    let response = router.clone().oneshot(request).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let token = response_json(response).await["token"]
        .as_str()
        .unwrap()
        .to_owned();
    let create = |origin, body| {
        Request::post("/api/embed/bug-report-upload-session")
            .header("origin", origin)
            .header("x-crikket-public-key", "test-key")
            .header("x-crikket-capture-token", &token)
            .header("content-type", "application/json")
            .body(Body::from(body))
            .unwrap()
    };
    let body = r#"{"attachmentType":"screenshot","hasDebuggerPayload":true}"#;
    assert_eq!(
        router
            .clone()
            .oneshot(create("https://other.test", body))
            .await
            .unwrap()
            .status(),
        StatusCode::FORBIDDEN
    );
    let response = router
        .clone()
        .oneshot(create("https://example.test", body))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let first = response_json(response).await;
    assert_eq!(first["captureUpload"]["method"], "PUT");
    assert_eq!(
        first["captureUpload"]["headers"]["content-type"],
        "image/png"
    );
    for upload in ["captureUpload", "debuggerUpload"] {
        let url = url::Url::parse(first[upload]["url"].as_str().unwrap()).unwrap();
        assert_eq!(
            url.host_str(),
            Some("example-account.r2.cloudflarestorage.com")
        );
        assert_eq!(
            url.path(),
            format!("/test-bucket/{}", first[upload]["key"].as_str().unwrap())
        );
        assert!(url.query_pairs().any(|(name, value)| {
            name == "X-Amz-Credential" && value.ends_with("/auto/s3/aws4_request")
        }));
        assert!(url.query_pairs().any(|(name, _)| name == "X-Amz-Signature"));
    }
    let response = router
        .clone()
        .oneshot(create("https://example.test", body))
        .await
        .unwrap();
    assert_eq!(
        response_json(response).await["bugReportId"],
        first["bugReportId"]
    );
    let response = router
        .oneshot(create(
            "https://example.test",
            r#"{"attachmentType":"video"}"#,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CONFLICT);
    assert_eq!(
        database
            .collection::<mongodb::bson::Document>("capture_drafts")
            .count_documents(doc! {})
            .await
            .unwrap(),
        1
    );
    database.drop().await.unwrap();
}

#[tokio::test]
#[ignore = "requires ZAPP_TEST_MONGODB_URI and a disposable S3Mock bucket at ZAPP_TEST_S3_ENDPOINT"]
async fn finalize_reuses_report_and_protects_published_media() {
    let client = Client::with_uri_str(std::env::var("ZAPP_TEST_MONGODB_URI").unwrap())
        .await
        .unwrap();
    let db = client.database(&format!(
        "zapp_test_{}",
        mongodb::bson::oid::ObjectId::new()
    ));
    db::migrate(&db).await.unwrap();
    db.collection("capture_keys")
        .insert_one(doc! {
            "_id": "key-1", "workspaceId": "workspace-1",
            "keyHash": "62af8704764faf8ea82fc61ce9c4c3908b6cb97d463a634e9e587d7c885db0ef",
            "allowedOrigins": ["https://example.test"]
        })
        .await
        .unwrap();
    let endpoint = std::env::var("ZAPP_TEST_S3_ENDPOINT").unwrap();
    let store = zapp_backend::storage::Storage::new(
        "test-bucket",
        "us-east-1",
        "test-id",
        "test-secret",
        Some(&endpoint),
    )
    .unwrap();
    let router = app::router_with_storage(db.clone(), Some(store));
    let embed = |path| {
        Request::post(path)
            .header("origin", "https://example.test")
            .header("x-crikket-public-key", "test-key")
            .header("content-type", "application/json")
    };
    let response = router
        .clone()
        .oneshot(
            embed("/api/embed/capture-token")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let token_response = response_json(response).await;
    let token = token_response["token"].as_str().unwrap();
    let response = router
        .clone()
        .oneshot(
            embed("/api/embed/bug-report-upload-session")
                .header("x-crikket-capture-token", token)
                .body(Body::from(
                    r#"{"attachmentType":"screenshot","hasDebuggerPayload":true}"#,
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let draft = response_json(response).await;
    let id = draft["bugReportId"].as_str().unwrap();
    let finalize = || {
        embed("/api/embed/bug-report-finalize")
            .header(
                "x-crikket-capture-finalize-token",
                draft["finalizeToken"].as_str().unwrap(),
            )
            .body(Body::from(serde_json::json!({"id": id}).to_string()))
            .unwrap()
    };
    let response = router.clone().oneshot(finalize()).await.unwrap();
    assert_eq!(response.status(), StatusCode::CONFLICT);
    let http = reqwest::Client::new();
    let staging = draft["captureUpload"]["url"].as_str().unwrap();
    http.put(staging)
        .header("content-type", "image/png")
        .body("original")
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();
    let response = router.clone().oneshot(finalize()).await.unwrap();
    let status = response.status();
    let first = response_json(response).await;
    assert_eq!(status, StatusCode::OK, "{first}");
    let response = router.clone().oneshot(finalize()).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response_json(response).await, first);
    http.put(staging)
        .header("content-type", "image/png")
        .body("overwritten")
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap();
    let url = format!("/api/v1/reports/{id}");
    let response = router
        .clone()
        .oneshot(Request::get(&url).body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    db.collection("share_links")
        .insert_one(doc! {
            "_id": "link-1", "reportId": id,
            "tokenHash": zapp_backend::capture::credential_hash("test-share")
        })
        .await
        .unwrap();
    let read = || {
        Request::get(&url)
            .header("x-zapp-share-token", "test-share")
            .body(Body::empty())
            .unwrap()
    };
    let response = router.clone().oneshot(read()).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(response.headers()["cache-control"], "private, no-store");
    let report = response_json(response).await;
    assert_eq!(report["debuggerStatus"], "pending");
    assert!(report["createdAt"].is_string());
    assert!(report["reporter"].is_null(), "share-link viewers must not see the reporter");
    assert_eq!(report["canManage"], false, "share-link viewers cannot change visibility");
    let playback = http
        .get(report["attachmentUrl"].as_str().unwrap())
        .send()
        .await
        .unwrap()
        .error_for_status()
        .unwrap()
        .text()
        .await
        .unwrap();
    assert_eq!(playback, "original");
    db.collection::<mongodb::bson::Document>("share_links")
        .update_one(
            doc! {"_id": "link-1"},
            doc! {"$set": {"revokedAt": DateTime::now()}},
        )
        .await
        .unwrap();
    let response = router.oneshot(read()).await.unwrap();
    assert_eq!(response.status(), StatusCode::NOT_FOUND);
    db.drop().await.unwrap();
}

async fn response_json(response: axum::response::Response) -> serde_json::Value {
    serde_json::from_slice(&to_bytes(response.into_body(), 8192).await.unwrap()).unwrap()
}

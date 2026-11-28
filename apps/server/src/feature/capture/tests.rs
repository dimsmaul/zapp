use super::model::{
    MediaValidation, normalize_origin, select_media_type, upload_url_lifetime, validate_media,
};
use std::time::Duration;

#[test]
fn normalize_origin_keeps_scheme_and_non_default_port() {
    assert_eq!(
        normalize_origin("https://EXAMPLE.test:443"),
        Some("https://example.test".into())
    );
    assert_eq!(
        normalize_origin("http://localhost:5173"),
        Some("http://localhost:5173".into())
    );
}

#[test]
fn normalize_origin_rejects_credentials_paths_and_non_http_schemes() {
    for origin in [
        "null",
        "file:///tmp",
        "https://user:pass@example.test",
        "https://example.test/path",
        "https://example.test/?q=1",
        "https://example.test/#section",
    ] {
        assert_eq!(normalize_origin(origin), None, "{origin}");
    }
}

#[test]
fn select_media_type_applies_defaults_and_checks_attachment_type() {
    assert_eq!(select_media_type("screenshot", None), Some("image/png"));
    assert_eq!(
        select_media_type("video", Some("video/webm;codecs=vp8")),
        Some("video/webm")
    );
    assert_eq!(select_media_type("video", Some("image/png")), None);
    assert_eq!(select_media_type("audio", None), None);
}

#[test]
fn upload_url_lifetime_is_capped_by_time_left_on_token() {
    assert_eq!(upload_url_lifetime(0, 900_000), Duration::from_secs(600));
    assert_eq!(upload_url_lifetime(1_500, 4_000), Duration::from_secs(2));
    assert_eq!(upload_url_lifetime(4_000, 4_000), Duration::ZERO);
    assert_eq!(upload_url_lifetime(5_000, 4_000), Duration::ZERO);
}

#[test]
fn validate_media_checks_size_and_content_type() {
    let limit = 100 * 1024 * 1024;
    assert_eq!(
        validate_media(limit, Some("video/webm;codecs=vp8"), "video/webm"),
        Ok(())
    );
    assert_eq!(
        validate_media(0, Some("video/webm"), "video/webm"),
        Err(MediaValidation::Size)
    );
    assert_eq!(
        validate_media(limit + 1, Some("video/webm"), "video/webm"),
        Err(MediaValidation::Size)
    );
    assert_eq!(
        validate_media(1, Some("image/png"), "video/webm"),
        Err(MediaValidation::ContentType)
    );
    assert_eq!(
        validate_media(1, None, "video/webm"),
        Err(MediaValidation::ContentType)
    );
}

fn environment(json: &str) -> Option<mongodb::bson::Document> {
    serde_json::from_str::<super::dto::Environment>(json).unwrap().to_document()
}

#[test]
fn environment_keeps_the_time_zone_country_and_utc_offset() {
    let stored = environment(r#"{"country":"Indonesia","countryCode":"ID","timezone":"Asia/Jakarta","utcOffsetMinutes":420,"capturedAt":"2026-11-23T04:30:00.000Z"}"#).unwrap();
    assert_eq!(stored.get_str("countryCode"), Ok("ID"));
    assert_eq!(stored.get_i64("utcOffsetMinutes"), Ok(420));
}

#[test]
fn environment_rejects_values_that_cannot_be_real() {
    assert!(environment(r#"{"utcOffsetMinutes":5000}"#).is_none());
    assert!(environment(r#"{"countryCode":"IDN"}"#).is_none());
}

//! S3-compatible storage for capture artifacts and playback.

use axum::http::Method;
use futures_util::TryStreamExt;
use object_store::{
    Attribute, GetOptions, ObjectStore, ObjectStoreExt,
    aws::{AmazonS3, AmazonS3Builder},
    path::Path,
    signer::Signer,
};
use serde::Serialize;
use std::{collections::BTreeMap, time::Duration};

#[derive(Clone)]
pub struct Storage(AmazonS3);

#[derive(Serialize)]
pub(crate) struct UploadTarget {
    key: String,
    method: &'static str,
    url: String,
    headers: BTreeMap<&'static str, String>,
}

impl Storage {
    pub fn new(
        bucket: &str,
        region: &str,
        access_key: &str,
        secret: &str,
        endpoint: Option<&str>,
    ) -> object_store::Result<Self> {
        let mut builder = AmazonS3Builder::new()
            .with_bucket_name(bucket)
            .with_region(region)
            .with_access_key_id(access_key)
            .with_secret_access_key(secret);
        if let Some(endpoint) = endpoint {
            builder = builder.with_endpoint(endpoint).with_allow_http(
                endpoint.starts_with("http://127.0.0.1:")
                    || endpoint.starts_with("http://localhost:"),
            );
        }
        builder.build().map(Self)
    }

    pub fn from_env() -> Result<Option<Self>, Box<dyn std::error::Error + Send + Sync>> {
        let bucket = match std::env::var("ZAPP_STORAGE_BUCKET") {
            Ok(bucket) if !bucket.is_empty() => bucket,
            Ok(_) | Err(std::env::VarError::NotPresent) => return Ok(None),
            Err(error) => return Err(error.into()),
        };
        Ok(Some(Self::new(
            &bucket,
            &std::env::var("ZAPP_STORAGE_REGION").unwrap_or_else(|_| "us-east-1".to_owned()),
            &std::env::var("ZAPP_STORAGE_ACCESS_KEY_ID")?,
            &std::env::var("ZAPP_STORAGE_SECRET_ACCESS_KEY")?,
            std::env::var("ZAPP_STORAGE_ENDPOINT")
                .ok()
                .filter(|value| !value.is_empty())
                .as_deref(),
        )?))
    }

    pub(crate) async fn sign_upload(
        &self,
        key: &str,
        content_type: &str,
        expires_in: Duration,
    ) -> object_store::Result<UploadTarget> {
        let url = self
            .0
            .signed_url(Method::PUT, &Path::from(key), expires_in)
            .await?;
        Ok(UploadTarget {
            key: key.to_owned(),
            method: "PUT",
            url: url.into(),
            headers: BTreeMap::from([("content-type", content_type.to_owned())]),
        })
    }

    /// Streams `body` into storage as a multipart upload so large recordings never sit fully in memory.
    /// Aborts and returns `Ok(false)` when the body exceeds `max` bytes.
    pub(crate) async fn put_stream<E>(
        &self,
        key: &str,
        content_type: &str,
        mut body: impl futures_util::Stream<Item = Result<axum::body::Bytes, E>> + Unpin,
        max: usize,
    ) -> Result<bool, Box<dyn std::error::Error + Send + Sync>>
    where
        E: std::error::Error + Send + Sync + 'static,
    {
        use futures_util::StreamExt;
        let mut attributes = object_store::Attributes::new();
        attributes.insert(Attribute::ContentType, content_type.to_owned().into());
        let upload = self
            .0
            .put_multipart_opts(&Path::from(key), object_store::PutMultipartOptions { attributes, ..Default::default() })
            .await?;
        let mut write = object_store::WriteMultipart::new(upload);
        let mut total = 0usize;
        while let Some(chunk) = body.next().await {
            let chunk = match chunk {
                Ok(chunk) => chunk,
                Err(error) => {
                    let _ = write.abort().await;
                    return Err(error.into());
                }
            };
            total += chunk.len();
            if total > max {
                let _ = write.abort().await;
                return Ok(false);
            }
            write.wait_for_capacity(4).await?;
            write.write(&chunk);
        }
        write.finish().await?;
        Ok(true)
    }

    pub(crate) async fn sign_playback(&self, key: &str) -> object_store::Result<String> {
        self.0
            .signed_url(Method::GET, &Path::from(key), Duration::from_secs(300))
            .await
            .map(Into::into)
    }

    pub(crate) async fn metadata(&self, key: &str) -> object_store::Result<(u64, Option<String>)> {
        let result = self
            .0
            .get_opts(
                &Path::from(key),
                GetOptions {
                    head: true,
                    ..Default::default()
                },
            )
            .await?;
        Ok((
            result.meta.size,
            result
                .attributes
                .get(&Attribute::ContentType)
                .map(|value| value.as_ref().to_owned()),
        ))
    }

    pub(crate) async fn copy_media(&self, from: &str, to: &str) -> object_store::Result<()> {
        self.0.copy(&Path::from(from), &Path::from(to)).await
    }

    pub(crate) async fn delete_media(&self, key: &str) -> object_store::Result<()> {
        self.0.delete(&Path::from(key)).await
    }

    pub(crate) async fn read_bounded(&self, key: &str, max: usize) -> object_store::Result<Option<Vec<u8>>> {
        let result = self.0.get(&Path::from(key)).await?;
        if result.meta.size > max as u64 {
            return Ok(None);
        }
        let mut bytes = Vec::with_capacity(result.meta.size as usize);
        let mut stream = result.into_stream();
        while let Some(chunk) = stream.try_next().await? {
            if chunk.len() > max.saturating_sub(bytes.len()) {
                return Ok(None);
            }
            bytes.extend_from_slice(&chunk);
        }
        Ok(Some(bytes))
    }
}

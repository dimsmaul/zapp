use std::net::SocketAddr;
use zapp_backend::adapter::{http, mongo, s3::Storage};
use zapp_backend::feature::debugger;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let uri = std::env::var("ZAPP_MONGODB_URI")?;
    let database = std::env::var("ZAPP_MONGODB_DATABASE").unwrap_or_else(|_| "zapp".to_owned());
    let database = mongo::connect(&uri, &database).await?;

    match std::env::args().nth(1).as_deref() {
        Some("migrate") => {
            mongo::migrate(&database).await?;
            println!("Applied Zapp schema {}", mongo::SCHEMA_VERSION);
            return Ok(());
        }
        Some("worker") => {
            let storage = Storage::from_env()?.ok_or("Configure object storage before starting the worker")?;
            debugger::run(database, storage).await?;
            return Ok(());
        }
        Some(command) => return Err(format!("Unknown command: {command}").into()),
        None => {}
    }

    let addr: SocketAddr = std::env::var("ZAPP_BIND_ADDR")
        .unwrap_or_else(|_| "127.0.0.1:8080".to_owned())
        .parse()?;
    http::serve(addr, database, Storage::from_env()?).await?;
    Ok(())
}

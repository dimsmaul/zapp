use mongodb::{Client, Database, error::Result, options::ClientOptions};
use std::time::Duration;

pub async fn connect(uri: &str, database: &str) -> Result<Database> {
    let mut options = ClientOptions::parse(uri).await?;
    options.server_selection_timeout = Some(Duration::from_secs(5));
    Ok(Client::with_options(options)?.database(database))
}

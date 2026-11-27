mod connection;
mod migration;

pub use connection::connect;
pub(crate) use migration::is_ready;
pub use migration::{SCHEMA_VERSION, migrate};

pub(crate) fn duplicate_key(error: &mongodb::error::Error) -> bool {
    use mongodb::error::{ErrorKind, WriteFailure};
    match error.kind.as_ref() {
        ErrorKind::Write(WriteFailure::WriteError(error)) => error.code == 11000,
        ErrorKind::Command(error) => error.code == 11000,
        _ => false,
    }
}

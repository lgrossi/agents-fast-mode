mod audio;
mod host;
mod levels;
mod playout;
mod protocol;
mod resample;
mod v3;
mod v3_media;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    host::run().await
}

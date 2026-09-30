use std::env;
use std::path::PathBuf;

use anyhow::{Context, Result};
use xtask::harness::{run, Operation};

fn workspace_root() -> Result<PathBuf> {
    // Cached binaries can come from another checkout; never use their build path for live links.
    let cwd = env::current_dir().context("read working directory")?;
    cwd.ancestors()
        .find(|directory| directory.join("managed.toml").is_file())
        .map(PathBuf::from)
        .context("run xtask from a repository containing managed.toml or one of its subdirectories")
}

fn parse_args() -> Result<(Operation, PathBuf)> {
    let mut args = env::args().skip(1);
    if args.next().as_deref() != Some("harness") {
        anyhow::bail!("usage: cargo xtask harness <setup|check|unlink> [--home <path>]");
    }
    let operation = match args.next().as_deref() {
        Some("setup") => Operation::Setup,
        Some("check") => Operation::Check,
        Some("unlink") => Operation::Unlink,
        _ => anyhow::bail!("usage: cargo xtask harness <setup|check|unlink> [--home <path>]"),
    };
    let mut home = env::var_os("HOME")
        .or_else(|| env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .context("HOME or USERPROFILE is required")?;
    while let Some(argument) = args.next() {
        if argument != "--home" {
            anyhow::bail!("unknown argument: {argument}");
        }
        home = PathBuf::from(args.next().context("--home requires a path")?);
    }
    Ok((operation, home))
}

fn main() -> Result<()> {
    let (operation, home) = parse_args()?;
    run(operation, &workspace_root()?, &home)
}

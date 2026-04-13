use std::env;
use std::fs;
use std::path::PathBuf;

fn main() {
    prepare_sidecar();
    tauri_build::build()
}

fn prepare_sidecar() {
    let target = env::var("TAURI_ENV_TARGET_TRIPLE")
        .or_else(|_| env::var("TARGET"))
        .ok();
    let Some(target) = target else {
        return;
    };

    let root = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap());
    let name = format!("opencode-cli-{target}.exe");
    let from = root.join("sidecars").join(&name);
    let dir = root.join("target").join("sidecars");
    let to = dir.join(&name);

    println!("cargo:rerun-if-changed={}", from.display());

    if to.exists() || !from.exists() {
        return;
    }

    fs::create_dir_all(&dir).unwrap();
    fs::copy(&from, &to).unwrap();
}

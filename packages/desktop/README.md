# KiCode Desktop

Native KiCode Desktop app, built with Tauri v2.

## Prerequisites

Building the desktop app requires additional Tauri dependencies (Rust toolchain, platform-specific libraries). See the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for setup instructions.

## Development

From the repo root:

```bash
bun install
bun run --cwd packages/desktop tauri dev
```

## Build

```bash
bun run --cwd packages/desktop tauri build
```

## Windows Installer

On Windows, you can build a desktop installer with one command:

```bash
bun run --cwd packages/desktop package:win
```

This defaults to an `msi` installer for the current Windows architecture and `dev` channel config.

Useful variants:

```bash
bun run --cwd packages/desktop package:win --channel prod
bun run --cwd packages/desktop package:win --kind nsis
bun run --cwd packages/desktop package:win --arch arm64
```

The script builds the CLI sidecar first, copies it into `src-tauri/sidecars`, then runs `tauri build`.

MSI packaging must run on Windows. Per Tauri's Windows installer docs, MSI builds also require the Windows `VBSCRIPT` optional feature to be enabled if you hit `light.exe` errors.

## Troubleshooting

### Rust compiler not found

If you see errors about Rust not being found, install it via [rustup](https://rustup.rs/):

```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
```

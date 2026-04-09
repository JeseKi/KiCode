# desktop dev

bun run --cwd packages/app dev -- --port 1420
bun run --cwd packages/desktop tauri dev
bun run --cwd packages/opencode --conditions=browser src/index.ts serve --port 4096

# build
bun run package:win:prod
# desktop dev

bun run --cwd packages/app dev -- --port 1420
bun run --cwd packages/desktop tauri dev
bun run --cwd packages/opencode --conditions=browser src/index.ts serve --port 4096

# build
bun run package:win:prod

# web dev
bun run dev serve --port 4097
VITE_OPENCODE_SERVER_PORT=4097 bun run dev:web
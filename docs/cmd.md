# desktop dev

bun run --cwd packages/app dev -- --port 1420
bun run --cwd packages/desktop tauri dev
bun run --cwd packages/opencode --conditions=browser src/index.ts serve --port 4096

# build
bun run package:win:prod

# build windows nsis without bun script runner
cd packages/desktop
node .\node_modules\vite\bin\vite.js build
Copy-Item -LiteralPath ..\opencode\dist\opencode-windows-x64\bin\opencode.exe -Destination .\src-tauri\sidecars\opencode-cli-x86_64-pc-windows-msvc.exe -Force
@'
{"build":{"beforeBuildCommand":""},"bundle":{"targets":["nsis"]}}
'@ | Set-Content -Path tmp-tauri-nsis.json
node .\node_modules\@tauri-apps\cli\tauri.js build --target x86_64-pc-windows-msvc --config .\src-tauri\tauri.prod.conf.json --config .\tmp-tauri-nsis.json --ci --verbose --no-sign
# web dev
bun run dev serve --port 4097
VITE_OPENCODE_SERVER_PORT=4097 bun run dev:web

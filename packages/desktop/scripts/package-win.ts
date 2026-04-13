#!/usr/bin/env bun

import { $ } from "bun"
import path from "node:path"
import { parseArgs } from "node:util"
import { copyBinaryToSidecarFolder, getCurrentSidecar, windowsify } from "./utils"

const root = path.resolve(import.meta.dirname, "..")
process.chdir(root)

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: {
    arch: { type: "string", default: process.arch === "arm64" ? "arm64" : "x64" },
    channel: { type: "string", default: process.env.OPENCODE_CHANNEL ?? "dev" },
    help: { type: "boolean", default: false },
    kind: { type: "string", default: "msi" },
    sign: { type: "boolean", default: false },
  },
})

if (values.help) {
  console.log(
    [
      "Usage: bun ./scripts/package-win.ts [--kind msi|nsis] [--channel dev|beta|prod] [--arch x64|arm64] [--sign]",
      "",
      "Examples:",
      "  bun ./scripts/package-win.ts",
      "  bun ./scripts/package-win.ts --channel prod",
      "  bun ./scripts/package-win.ts --kind nsis",
      "  bun ./scripts/package-win.ts --arch arm64",
    ].join("\n"),
  )
  process.exit(0)
}

if (process.platform !== "win32") {
  throw new Error("Windows installer packaging must run on Windows")
}

const kinds = new Set(["msi", "nsis"])
if (!kinds.has(values.kind)) {
  throw new Error(`Unsupported installer kind '${values.kind}'`)
}

const rust = new Map([
  ["x64", "x86_64-pc-windows-msvc"],
  ["arm64", "aarch64-pc-windows-msvc"],
]).get(values.arch)
if (!rust) {
  throw new Error(`Unsupported arch '${values.arch}'`)
}

const cfg = new Map([
  ["dev", "./src-tauri/tauri.conf.json"],
  ["beta", "./src-tauri/tauri.beta.conf.json"],
  ["prod", "./src-tauri/tauri.prod.conf.json"],
]).get(values.channel)
if (!cfg) {
  throw new Error(`Unsupported channel '${values.channel}'`)
}

const sidecar = getCurrentSidecar(rust)
const args = sidecar.ocBinary.includes("-baseline") ? ["--single", "--baseline"] : ["--single"]
const bin = windowsify(`../opencode/dist/${sidecar.ocBinary}/bin/opencode`)
const ext = values.kind === "msi" ? "msi" : "exe"
const dir = `src-tauri/target/${rust}/release/bundle/${values.kind}`
const merge = JSON.stringify({
  bundle: {
    targets: [values.kind],
  },
})

console.log(`Building sidecar for ${rust}`)
await $`bun run build ${args}`.cwd(path.resolve(root, "../opencode"))

console.log(`Copying sidecar into src-tauri/target/sidecars`)
await copyBinaryToSidecarFolder(bin, rust)

console.log(`Building ${values.kind} installer with ${cfg}`)
await $`bun run tauri build --target ${rust} --config ${cfg} --config ${merge} --ci --verbose ${values.sign ? [] : ["--no-sign"]}`

const files = (await Array.fromAsync(new Bun.Glob(`*.${ext}`).scan({ cwd: dir })))
  .map((file) => path.resolve(root, dir, file))
  .sort()

if (!files.length) {
  throw new Error(`No ${values.kind} installer found in ${dir}`)
}

console.log(["Built Windows installer:", ...files].join("\n"))

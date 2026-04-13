import { randomUUID } from "node:crypto"
import { EventEmitter } from "node:events"
import { existsSync } from "node:fs"
import { mkdtemp, writeFile } from "node:fs/promises"
import { createServer } from "node:net"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import type { Event } from "electron"
import { app, BrowserWindow, dialog, shell } from "electron"

const APP_NAMES: Record<string, string> = {
  dev: "OpenCode Dev",
  beta: "OpenCode Beta",
  prod: "OpenCode",
}
const APP_IDS: Record<string, string> = {
  dev: "ai.opencode.desktop.dev",
  beta: "ai.opencode.desktop.beta",
  prod: "ai.opencode.desktop",
}
app.setName(app.isPackaged ? APP_NAMES[CHANNEL] : "OpenCode Dev")
app.setPath("userData", join(app.getPath("appData"), app.isPackaged ? APP_IDS[CHANNEL] : "ai.opencode.desktop.dev"))

import type { InitStep, ServerReadyData, SqliteMigrationProgress, WslConfig } from "../preload/types"
import { checkAppExists, resolveAppPath, wslPath } from "./apps"
import type { CommandChild } from "./cli"
import { installCli, syncCli } from "./cli"
import { CHANNEL, UPDATER_ENABLED } from "./constants"
import { registerIpcHandlers, sendDeepLinks, sendMenuCommand, sendSqliteMigrationProgress } from "./ipc"
import { initLogging } from "./logging"
import { parseMarkdown } from "./markdown"
import { createMenu } from "./menu"
import { getDefaultServerUrl, getWslConfig, setDefaultServerUrl, setWslConfig, spawnLocalServer } from "./server"
import { createLoadingWindow, createMainWindow, setBackgroundColor, setDockIcon } from "./windows"

const initEmitter = new EventEmitter()
let initStep: InitStep = { phase: "server_waiting" }

let mainWindow: BrowserWindow | null = null
let sidecar: CommandChild | null = null
const loadingComplete = defer<void>()

const pendingDeepLinks: string[] = []
const UPDATE_URL = "https://releases.kispace.cc/api/public/latest"

const serverReady = defer<ServerReadyData>()
const logger = initLogging()

type Release = {
  version: string
  tags: string[]
  download_url: string | null
  release_notes: string | null
  created_at: string
}

let ready: Release | null = null
let file: { version: string; path: string } | null = null

logger.log("app starting", {
  version: app.getVersion(),
  packaged: app.isPackaged,
})

setupApp()

function setupApp() {
  ensureLoopbackNoProxy()
  app.commandLine.appendSwitch("proxy-bypass-list", "<-loopback>")

  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return
  }

  app.on("second-instance", (_event: Event, argv: string[]) => {
    const urls = argv.filter((arg: string) => arg.startsWith("opencode://"))
    if (urls.length) {
      logger.log("deep link received via second-instance", { urls })
      emitDeepLinks(urls)
    }
    focusMainWindow()
  })

  app.on("open-url", (event: Event, url: string) => {
    event.preventDefault()
    logger.log("deep link received via open-url", { url })
    emitDeepLinks([url])
  })

  app.on("before-quit", () => {
    killSidecar()
  })

  app.on("will-quit", () => {
    killSidecar()
  })

  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      killSidecar()
      app.exit(0)
    })
  }

  void app.whenReady().then(async () => {
    // migrate()
    app.setAsDefaultProtocolClient("opencode")
    setDockIcon()
    setupUpdater()
    syncCli()
    await initialize()
  })
}

function emitDeepLinks(urls: string[]) {
  if (urls.length === 0) return
  pendingDeepLinks.push(...urls)
  if (mainWindow) sendDeepLinks(mainWindow, urls)
}

function focusMainWindow() {
  if (!mainWindow) return
  mainWindow.show()
  mainWindow.focus()
}

function setInitStep(step: InitStep) {
  initStep = step
  logger.log("init step", { step })
  initEmitter.emit("step", step)
}

async function initialize() {
  const needsMigration = !sqliteFileExists()
  const sqliteDone = needsMigration ? defer<void>() : undefined
  let overlay: BrowserWindow | null = null

  const port = await getSidecarPort()
  const hostname = "127.0.0.1"
  const url = `http://${hostname}:${port}`
  const password = randomUUID()

  logger.log("spawning sidecar", { url })
  const { child, health, events } = spawnLocalServer(hostname, port, password)
  sidecar = child
  serverReady.resolve({
    url,
    username: "opencode",
    password,
  })

  const loadingTask = (async () => {
    logger.log("sidecar connection started", { url })

    events.on("sqlite", (progress: SqliteMigrationProgress) => {
      setInitStep({ phase: "sqlite_waiting" })
      if (overlay) sendSqliteMigrationProgress(overlay, progress)
      if (mainWindow) sendSqliteMigrationProgress(mainWindow, progress)
      if (progress.type === "Done") sqliteDone?.resolve()
    })

    if (needsMigration) {
      await sqliteDone?.promise
    }

    await Promise.race([
      health.wait,
      delay(30_000).then(() => {
        throw new Error("Sidecar health check timed out")
      }),
    ]).catch((error) => {
      logger.error("sidecar health check failed", error)
    })

    logger.log("loading task finished")
  })()

  const globals = {
    updaterEnabled: UPDATER_ENABLED,
    deepLinks: pendingDeepLinks,
  }

  if (needsMigration) {
    const show = await Promise.race([loadingTask.then(() => false), delay(1_000).then(() => true)])
    if (show) {
      overlay = createLoadingWindow(globals)
      await delay(1_000)
    }
  }

  await loadingTask
  setInitStep({ phase: "done" })

  if (overlay) {
    await loadingComplete.promise
  }

  mainWindow = createMainWindow(globals)
  wireMenu()

  overlay?.close()
}

function wireMenu() {
  if (!mainWindow) return
  createMenu({
    trigger: (id) => mainWindow && sendMenuCommand(mainWindow, id),
    installCli: () => {
      void installCli()
    },
    checkForUpdates: () => {
      void checkForUpdates(true)
    },
    reload: () => mainWindow?.reload(),
    relaunch: () => {
      killSidecar()
      app.relaunch()
      app.exit(0)
    },
  })
}

registerIpcHandlers({
  killSidecar: () => killSidecar(),
  installCli: async () => installCli(),
  awaitInitialization: async (sendStep) => {
    sendStep(initStep)
    const listener = (step: InitStep) => sendStep(step)
    initEmitter.on("step", listener)
    try {
      logger.log("awaiting server ready")
      const res = await serverReady.promise
      logger.log("server ready", { url: res.url })
      return res
    } finally {
      initEmitter.off("step", listener)
    }
  },
  getDefaultServerUrl: () => getDefaultServerUrl(),
  setDefaultServerUrl: (url) => setDefaultServerUrl(url),
  getWslConfig: () => Promise.resolve(getWslConfig()),
  setWslConfig: (config: WslConfig) => setWslConfig(config),
  getDisplayBackend: async () => null,
  setDisplayBackend: async () => undefined,
  parseMarkdown: async (markdown) => parseMarkdown(markdown),
  checkAppExists: async (appName) => checkAppExists(appName),
  wslPath: async (path, mode) => wslPath(path, mode),
  resolveAppPath: async (appName) => resolveAppPath(appName),
  loadingWindowComplete: () => loadingComplete.resolve(),
  runUpdater: async (alertOnFail) => checkForUpdates(alertOnFail),
  checkUpdate: async () => checkUpdate(),
  installUpdate: async () => installUpdate(),
  setBackgroundColor: (color) => setBackgroundColor(color),
})

function killSidecar() {
  if (!sidecar) return
  const pid = sidecar.pid
  sidecar.kill()
  sidecar = null
  // tree-kill is async; also send process group signal as immediate fallback
  if (pid && process.platform !== "win32") {
    try {
      process.kill(-pid, "SIGTERM")
    } catch {}
  }
}

function ensureLoopbackNoProxy() {
  const loopback = ["127.0.0.1", "localhost", "::1"]
  const upsert = (key: string) => {
    const items = (process.env[key] ?? "")
      .split(",")
      .map((value: string) => value.trim())
      .filter((value: string) => Boolean(value))

    for (const host of loopback) {
      if (items.some((value: string) => value.toLowerCase() === host)) continue
      items.push(host)
    }

    process.env[key] = items.join(",")
  }

  upsert("NO_PROXY")
  upsert("no_proxy")
}

async function getSidecarPort() {
  const fromEnv = process.env.OPENCODE_PORT
  if (fromEnv) {
    const parsed = Number.parseInt(fromEnv, 10)
    if (!Number.isNaN(parsed)) return parsed
  }

  return await new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.on("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (typeof address !== "object" || !address) {
        server.close()
        reject(new Error("Failed to get port"))
        return
      }
      const port = address.port
      server.close(() => resolve(port))
    })
  })
}

function sqliteFileExists() {
  const xdg = process.env.XDG_DATA_HOME
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), ".local", "share")
  return existsSync(join(base, "opencode", "opencode.db"))
}

function setupUpdater() {
  if (!UPDATER_ENABLED) return
  logger.log("updater configured", {
    currentVersion: app.getVersion(),
    platform: process.platform,
    channel: CHANNEL,
  })
}

function platformTag() {
  if (process.platform === "win32") return "windows"
  if (process.platform === "darwin") return "macos"
  if (process.platform === "linux") return "linux"
  return null
}

async function latest() {
  const tag = platformTag()
  if (!tag) return null
  if (tag !== "windows") {
    return {
      version: app.getVersion(),
      tags: [tag, CHANNEL === "prod" ? "stable" : CHANNEL],
      download_url: null,
      release_notes: null,
      created_at: new Date().toISOString(),
    } satisfies Release
  }

  const url = new URL(UPDATE_URL)
  url.searchParams.set("app", "kicode_desktop")
  url.searchParams.append("tags", tag)
  url.searchParams.append("tags", "stable")

  const res = await fetch(url)
  if (!res.ok) throw new Error(`Update API returned ${res.status}`)

  const body = (await res.json()) as Partial<Release>
  if (typeof body.version !== "string") throw new Error("Update API missing version")
  if (typeof body.download_url !== "string") throw new Error("Update API missing download_url")

  return {
    version: body.version,
    tags: Array.isArray(body.tags) ? body.tags.filter((x): x is string => typeof x === "string") : [],
    download_url: body.download_url,
    release_notes: typeof body.release_notes === "string" ? body.release_notes : null,
    created_at: typeof body.created_at === "string" ? body.created_at : "",
  } satisfies Release
}

async function installer(rel: Release) {
  if (file?.version === rel.version && existsSync(file.path)) return file.path
  if (!rel.download_url) throw new Error("Update download is unavailable")

  const res = await fetch(rel.download_url)
  if (!res.ok) throw new Error(`Installer download failed with ${res.status}`)

  const dir = await mkdtemp(join(tmpdir(), "kicode-update-"))
  const name = new URL(rel.download_url).pathname.split("/").filter(Boolean).at(-1) ?? `KiCode_${rel.version}.msi`
  const path = join(dir, name)
  const buf = Buffer.from(await res.arrayBuffer())
  await writeFile(path, buf)
  file = { version: rel.version, path }
  return path
}

async function checkUpdate() {
  if (!UPDATER_ENABLED) return { updateAvailable: false }
  logger.log("checking for updates", {
    currentVersion: app.getVersion(),
    platform: process.platform,
    channel: CHANNEL,
  })
  try {
    ready = null
    const rel = await latest()
    logger.log("update metadata fetched", {
      releaseVersion: rel?.version ?? null,
      releaseDate: rel?.created_at ?? null,
      files: rel?.download_url ? [rel.download_url] : [],
    })
    if (!rel || rel.version === app.getVersion()) {
      logger.log("no update available", {
        reason: "provider returned no newer version",
      })
      return { updateAvailable: false }
    }
    ready = rel
    logger.log("update available", { version: rel.version })
    return { updateAvailable: true, version: rel.version }
  } catch (error) {
    ready = null
    logger.error("update check failed", error)
    return { updateAvailable: false, failed: true }
  }
}

async function installUpdate() {
  const rel = ready
  if (!rel) return
  const path = await installer(rel)
  logger.log("launching installer", {
    version: rel.version,
    path,
  })
  const err = await shell.openPath(path)
  if (err) throw new Error(err)
  killSidecar()
  app.exit(0)
  await new Promise<void>(() => undefined)
}

async function checkForUpdates(alertOnFail: boolean) {
  if (!UPDATER_ENABLED) return
  logger.log("checkForUpdates invoked", { alertOnFail })
  const result = await checkUpdate()
  if (!result.updateAvailable) {
    if (result.failed) {
      logger.log("no update decision", { reason: "update check failed" })
      if (!alertOnFail) return
      await dialog.showMessageBox({
        type: "error",
        message: "Update check failed.",
        title: "Update Error",
      })
      return
    }

    logger.log("no update decision", { reason: "already up to date" })
    if (!alertOnFail) return
    await dialog.showMessageBox({
      type: "info",
      message: "You're up to date.",
      title: "No Updates",
    })
    return
  }

  const response = await dialog.showMessageBox({
    type: "info",
    message: `KiCode ${result.version ?? ""} is available. Install now?`,
    title: "Update Available",
    buttons: ["Install", "Later"],
    defaultId: 0,
    cancelId: 1,
  })
  logger.log("update prompt response", {
    version: result.version ?? null,
    installNow: response.response === 0,
  })
  if (response.response === 0) {
    await installUpdate()
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function defer<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

import { check } from "@tauri-apps/plugin-updater"
import { ask, message } from "@tauri-apps/plugin-dialog"
import { initI18n, t } from "./i18n"

const UPDATE_URL = "https://releases.kispace.cc/api/public/latest"

type UpdateInfo = {
  updateAvailable: boolean
  version?: string
  current?: string
  downloadUrl?: string
  failed?: boolean
  reason?: string
  installable?: boolean
}

type Release = {
  version: string
  download_url?: string | null
  created_at?: string
}

export const UPDATER_ENABLED = window.__OPENCODE__?.updaterEnabled ?? false

function clean(version: string) {
  const value = version.trim().replace(/^v/i, "")
  const part = value.split("-")[0]?.split("+")[0]
  if (!part) return null
  const list = part
    .split(".")
    .map((item) => Number.parseInt(item, 10))
    .filter((item) => Number.isFinite(item))
  if (list.length === 0) return null
  return list.join(".")
}

function same(a: string, b: string) {
  const left = clean(a)
  const right = clean(b)
  if (!left || !right) return a.trim() === b.trim()
  return left === right
}

function channel() {
  const value = window.__OPENCODE__?.channel
  if (value === "dev" || value === "beta" || value === "stable") return value
  return "stable"
}

export function detail(result: UpdateInfo, current?: string) {
  const lines = [
    `Current: ${result.current ?? current ?? "-"}`,
    `Latest: ${result.version ?? "-"}`,
    `Download: ${result.downloadUrl ?? "-"}`,
  ]
  if (result.reason) lines.push(`Reason: ${result.reason}`)
  return lines.join("\n")
}

async function latest(os?: string) {
  if (os !== "windows") return null
  const url = new URL(UPDATE_URL)
  url.searchParams.set("app", "kicode_desktop")
  url.searchParams.append("tags", os)
  url.searchParams.append("tags", channel())
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Update API returned ${res.status}`)
  const body = (await res.json()) as Release
  if (typeof body.version !== "string") throw new Error("Update API missing version")
  return {
    version: body.version,
    downloadUrl: typeof body.download_url === "string" ? body.download_url : undefined,
  }
}

export async function checkNow(current: string, os?: string): Promise<UpdateInfo> {
  if (os === "windows") {
    try {
      const rel = await latest(os)
      if (!rel) {
        return {
          updateAvailable: false,
          current,
          reason: "no release metadata",
        }
      }
      const matched = same(rel.version, current)
      return {
        updateAvailable: !matched,
        version: rel.version,
        current,
        downloadUrl: rel.downloadUrl,
        installable: false,
        reason: matched
          ? "remote version equals current version"
          : UPDATER_ENABLED
            ? "metadata check succeeded, built-in install is available"
            : "metadata check succeeded, built-in install is disabled in this build",
      }
    } catch (err) {
      return {
        updateAvailable: false,
        version: undefined,
        current,
        failed: true,
        reason: err instanceof Error ? err.message : String(err),
      }
    }
  }

  try {
    const next = await check()
    if (!next) {
      return {
        updateAvailable: false,
        current,
        reason: UPDATER_ENABLED ? "plugin updater returned null" : "plugin updater disabled in this build",
      }
    }
    return {
      updateAvailable: true,
      version: next.version,
      current,
      installable: true,
    }
  } catch (err) {
    return {
      updateAvailable: false,
      current,
      failed: true,
      reason: err instanceof Error ? err.message : String(err),
    }
  }
}

export async function runUpdater({ alertOnFail, current, os }: { alertOnFail: boolean; current: string; os?: string }) {
  await initI18n()
  const result = await checkNow(current, os)

  if (result.failed) {
    if (alertOnFail) {
      await message([t("desktop.updater.checkFailed.message"), detail(result, current)].join("\n"), {
        title: t("desktop.updater.checkFailed.title"),
      })
    }
    return
  }

  if (!result.updateAvailable) {
    if (alertOnFail) {
      await message([t("desktop.updater.none.message"), detail(result, current)].join("\n"), {
        title: t("desktop.updater.none.title"),
      })
    }
    return
  }

  const ok = await ask([t("desktop.updater.downloaded.prompt", { version: result.version ?? "" }), detail(result, current)].join("\n"), {
    title: t("desktop.updater.downloaded.title"),
  })
  if (!ok || !result.downloadUrl) return
  window.open(result.downloadUrl, "_blank", "noopener,noreferrer")
}

import { Auth } from "@/auth"

const root = process.env.OPENCODE_KICODE_URL || "https://kicode.chat"
const loginURL = process.env.OPENCODE_KICODE_AUTH_URL || `${root}/api/llm_login`
const refreshURL = process.env.OPENCODE_KICODE_REFRESH_URL || `${root}/api/auth/refresh`
const profileURL = process.env.OPENCODE_KICODE_PROFILE_URL || `${root}/api/auth/profile`
const registerURL = process.env.OPENCODE_KICODE_REGISTER_URL || `${root}/api/auth/register`
const codeURL = process.env.OPENCODE_KICODE_CODE_URL || `${root}/api/auth/send-verification-code`
const key = "kicode"
const skew = 60_000
const beat = 60_000
const fallback = 25 * 60_000
let seen = ""
let ping = 0
let refs = 0
let timer: ReturnType<typeof setInterval> | undefined
let task: Promise<void> | undefined

type Token = {
  access_token?: string
  refresh_token?: string
  token_type?: string
}

type Login = {
  username: string
  password: string
}

type Register = {
  username: string
  email: string
  password: string
  code: string
}

type Code = {
  email: string
}

const isObj = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object"

const parse = async (res: Response) => {
  const text = await res.text()
  const body = text
    ? await Promise.resolve()
        .then(() => JSON.parse(text))
        .catch(() => undefined)
    : undefined
  return { body, text }
}

const message = (res: Response, body: unknown, text: string, fallbackText: string) => {
  if (isObj(body)) {
    const detail = body.detail
    if (typeof detail === "string" && detail) return detail
    const msg = body.message
    if (typeof msg === "string" && msg) return msg
  }
  const msg = text.trim()
  if (msg) return msg
  return `${fallbackText} (${res.status})`
}

const expiry = (token: string) => {
  const part = token.split(".")[1]
  if (!part) return Date.now() + fallback
  const json = Buffer.from(part, "base64url").toString("utf8")
  const body = JSON.parse(json) as { exp?: unknown }
  if (typeof body.exp !== "number" || !Number.isFinite(body.exp)) return Date.now() + fallback
  return body.exp * 1000
}

const clear = async () => {
  seen = ""
  ping = 0
  await Auth.remove(key).catch(() => undefined)
}

const save = async (username: string, token: { access: string; refresh: string }) => {
  seen = ""
  ping = 0
  const row = new Auth.Session({
    type: "session",
    username,
    access: token.access,
    refresh: token.refresh,
    expires: expiry(token.access),
  })
  await Auth.set(key, row)
  return row
}

const read = async () => {
  const row = await Auth.get(key)
  if (row?.type !== "session") return
  return row
}

const run = async (drop: boolean) => {
  const row = await read()
  if (!row) return
  return live(row).catch(async () => {
    if (!drop) return row
    await clear()
    return
  })
}

const tick = (drop: boolean) => {
  if (task) return task
  task = run(drop)
    .then(() => undefined)
    .finally(() => {
      task = undefined
    })
  return task
}

const live = async (row: Auth.Session) => {
  if (row.expires <= Date.now() + skew) return KiCodeAuth.refresh()
  if (seen === row.access && ping > Date.now() - beat) return row
  const res = await fetch(profileURL, {
    headers: {
      Authorization: `Bearer ${row.access}`,
    },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined)
  seen = row.access
  ping = Date.now()
  if (res?.status === 401) return KiCodeAuth.refresh()
  return row
}

const token = (body: unknown, fallbackText: string) => {
  if (!isObj(body)) throw new Error(fallbackText)
  const access = body.access_token
  const refresh = body.refresh_token
  if (typeof access !== "string" || !access || typeof refresh !== "string" || !refresh) {
    throw new Error(fallbackText)
  }
  return { access, refresh }
}

const post = async (url: string, init: RequestInit, fallbackText: string) => {
  const res = await fetch(url, init)
  const { body, text } = await parse(res)
  if (!res.ok) {
    throw new Error(message(res, body, text, fallbackText))
  }
  return body
}

export namespace KiCodeAuth {
  export const session = async () => {
    return run(true)
  }

  export const status = async () => {
    const row = await session()
    if (!row) return { authenticated: false as const }
    return {
      authenticated: true as const,
      username: row.username,
    }
  }

  export const refresh = async () => {
    const row = await read()
    if (!row) return
    const body = await post(
      refreshURL,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${row.refresh}`,
        },
      },
      "KiCode token refresh failed",
    ).catch(async (err) => {
      if (typeof err === "object" && err !== null && "status" in err && err.status === 401) {
        await clear()
      }
      throw err
    })
    return save(row.username, token(body, "KiCode refresh returned no token"))
  }

  export const login = async (input: Login) => {
    const username = input.username.trim()
    if (!username || !input.password) throw new Error("Username and password are required")
    const body = await post(
      loginURL,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          username,
          password: input.password,
        }),
      },
      "KiCode login failed",
    )
    return save(username, token(body, "KiCode login returned no token"))
  }

  export const register = async (input: Register) =>
    post(
      registerURL,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(input),
      },
      "KiCode register failed",
    )

  export const sendCode = async (input: Code) =>
    post(
      codeURL,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(input),
      },
      "KiCode verification code request failed",
    )

  export const logout = clear

  export const start = (ms = beat) => {
    refs += 1
    if (timer) return
    void tick(false)
    timer = setInterval(() => void tick(false), ms)
    timer.unref?.()
  }

  export const stop = () => {
    refs = Math.max(0, refs - 1)
    if (refs > 0 || !timer) return
    clearInterval(timer)
    timer = undefined
  }
}

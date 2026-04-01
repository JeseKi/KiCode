import { createSimpleContext } from "@opencode-ai/ui/context"
import { createMemo, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { useGlobalSDK } from "./global-sdk"
import { usePlatform } from "./platform"
import { useServer } from "./server"

type Status = {
  authenticated?: boolean
  username?: string
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

const poll = 30_000

const isObj = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object"

const parse = async (res: Response) => {
  const text = await res.text()
  const data = text
    ? await Promise.resolve()
        .then(() => JSON.parse(text))
        .catch(() => undefined)
    : undefined
  return { data, text }
}

const message = (res: Response, data: unknown, text: string, fallback: string) => {
  if (isObj(data)) {
    const detail = data.detail
    if (typeof detail === "string" && detail) return detail
    const msg = data.message
    if (typeof msg === "string" && msg) return msg
  }
  const msg = text.trim()
  if (msg) return msg
  return `${fallback} (${res.status})`
}

export const { use: useAuth, provider: AuthProvider } = createSimpleContext({
  name: "Auth",
  init: () => {
    const server = useServer()
    const platform = usePlatform()
    const globalSDK = useGlobalSDK()

    const [store, setStore] = createStore({
      ready: false,
      loading: false,
      authenticated: false,
      username: undefined as string | undefined,
      notice: undefined as undefined | "expired",
    })

    const request = async (path: string, init?: RequestInit) => {
      const current = server.current
      if (!current) throw new Error("No server available")

      const headers = new Headers(init?.headers)
      if (init?.body && !headers.has("content-type")) {
        headers.set("content-type", "application/json")
      }
      if (current.http.password && !headers.has("authorization")) {
        headers.set(
          "authorization",
          `Basic ${btoa(`${current.http.username ?? "opencode"}:${current.http.password}`)}`,
        )
      }

      const res = await (platform.fetch ?? fetch)(new URL(path, current.http.url).toString(), {
        ...init,
        headers,
      })
      const { data, text } = await parse(res)
      if (!res.ok) throw new Error(message(res, data, text, "Request failed"))
      return data
    }

    const sync = async () => {
      const prev = store.authenticated
      const data = (await request("/kicode/session")) as Status
      const next = !!data?.authenticated
      setStore({
        ready: true,
        authenticated: next,
        username: next ? data.username : undefined,
        notice: !next && prev ? "expired" : undefined,
      })
      return next
    }

    const refresh = async () => {
      setStore("loading", true)
      return sync().finally(() => setStore("loading", false))
    }

    const login = async (input: Login) => {
      setStore("loading", true)
      return request("/kicode/login", {
        method: "POST",
        body: JSON.stringify(input),
      })
        .then(async () => {
          setStore({
            ready: true,
            authenticated: true,
            username: input.username.trim(),
            notice: undefined,
          })
          await globalSDK.client.global.dispose().catch(() => undefined)
        })
        .finally(() => setStore("loading", false))
    }

    const register = async (input: Register) =>
      request("/kicode/register", {
        method: "POST",
        body: JSON.stringify(input),
      })

    const sendCode = async (input: Code) =>
      request("/kicode/send-verification-code", {
        method: "POST",
        body: JSON.stringify(input),
      })

    const logout = async () => {
      setStore("loading", true)
      return request("/kicode/logout", {
        method: "POST",
      })
        .then(async () => {
          setStore({
            ready: true,
            loading: false,
            authenticated: false,
            username: undefined,
            notice: undefined,
          })
          await globalSDK.client.global.dispose().catch(() => undefined)
        })
        .finally(() => setStore("loading", false))
    }

    let timer: ReturnType<typeof setInterval> | undefined
    const visible = () => {
      if (document.visibilityState !== "visible") return
      void refresh().catch(() => undefined)
    }

    void refresh().catch(() => {
      setStore({
        ready: true,
        authenticated: false,
        username: undefined,
      })
    })
    timer = setInterval(() => void refresh().catch(() => undefined), poll)
    document.addEventListener("visibilitychange", visible)

    onCleanup(() => {
      if (timer) clearInterval(timer)
      document.removeEventListener("visibilitychange", visible)
    })

    return {
      ready: createMemo(() => store.ready),
      loading: createMemo(() => store.loading),
      authenticated: createMemo(() => store.authenticated),
      username: createMemo(() => store.username),
      notice: createMemo(() => store.notice),
      refresh,
      login,
      register,
      sendCode,
      logout,
    }
  },
})

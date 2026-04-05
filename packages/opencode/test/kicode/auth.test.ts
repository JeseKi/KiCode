import { afterEach, expect, mock, test } from "bun:test"
import { Auth } from "../../src/auth"
import { KiCodeAuth } from "../../src/kicode/auth"

const originalFetch = globalThis.fetch

function jwt(ms: number) {
  const exp = Math.floor((Date.now() + ms) / 1000)
  const head = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url")
  const body = Buffer.from(JSON.stringify({ exp })).toString("base64url")
  return `${head}.${body}.sig`
}

afterEach(async () => {
  globalThis.fetch = originalFetch
  await Auth.remove("kicode")
})

test("refreshes kicode session when token is near expiry", async () => {
  const next = jwt(10 * 60_000)
  globalThis.fetch = mock((url: string | URL | Request) => {
    if (url.toString() !== "https://kicode.chat/api/auth/refresh") {
      throw new Error(`unexpected url: ${url.toString()}`)
    }
    return Promise.resolve(
      new Response(
        JSON.stringify({
          access_token: next,
          refresh_token: "rt_new",
        }),
        { status: 200 },
      ),
    )
  }) as unknown as typeof fetch

  await Auth.set(
    "kicode",
    new Auth.Session({
      type: "session",
      username: "ki",
      access: jwt(30_000),
      refresh: "rt_old",
      expires: Date.now() + 30_000,
    }),
  )

  const row = await KiCodeAuth.session()
  const saved = await Auth.get("kicode")

  expect(row?.access).toBe(next)
  expect(row?.refresh).toBe("rt_new")
  expect(saved?.type).toBe("session")
  if (saved?.type === "session") {
    expect(saved.access).toBe(next)
    expect(saved.refresh).toBe("rt_new")
  }
})

test("refreshes kicode session when profile returns 401", async () => {
  const now = Date.now()
  const old = jwt(10 * 60_000)
  const next = jwt(20 * 60_000)
  const calls: Array<{ url: string; auth: string | null }> = []

  globalThis.fetch = mock((url: string | URL | Request, init?: RequestInit) => {
    const text = url.toString()
    calls.push({
      url: text,
      auth: new Headers(init?.headers).get("Authorization"),
    })
    if (text === "https://kicode.chat/api/auth/profile") {
      return Promise.resolve(new Response(null, { status: 401 }))
    }
    if (text === "https://kicode.chat/api/auth/refresh") {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            access_token: next,
            refresh_token: "rt_new",
          }),
          { status: 200 },
        ),
      )
    }
    throw new Error(`unexpected url: ${text}`)
  }) as unknown as typeof fetch

  await Auth.set(
    "kicode",
    new Auth.Session({
      type: "session",
      username: "ki",
      access: old,
      refresh: "rt_old",
      expires: now + 10 * 60_000,
    }),
  )

  const row = await KiCodeAuth.session()

  expect(row?.access).toBe(next)
  expect(row?.refresh).toBe("rt_new")
  expect(calls).toEqual([
    {
      url: "https://kicode.chat/api/auth/profile",
      auth: `Bearer ${old}`,
    },
    {
      url: "https://kicode.chat/api/auth/refresh",
      auth: "Bearer rt_old",
    },
  ])
})

test("checks profile at most once per heartbeat", async () => {
  const now = Date.now()
  const old = jwt(10 * 60_000)
  const calls: string[] = []

  globalThis.fetch = mock((url: string | URL | Request) => {
    const text = url.toString()
    calls.push(text)
    if (text === "https://kicode.chat/api/auth/profile") {
      return Promise.resolve(new Response(JSON.stringify({ username: "ki" }), { status: 200 }))
    }
    throw new Error(`unexpected url: ${text}`)
  }) as unknown as typeof fetch

  await Auth.set(
    "kicode",
    new Auth.Session({
      type: "session",
      username: "ki",
      access: old,
      refresh: "rt_old",
      expires: now + 10 * 60_000,
    }),
  )

  await KiCodeAuth.session()
  await KiCodeAuth.session()

  expect(calls).toEqual(["https://kicode.chat/api/auth/profile"])
})

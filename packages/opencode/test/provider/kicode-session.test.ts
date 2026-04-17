import { afterEach, expect, mock, test } from "bun:test"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Provider } from "../../src/provider/provider"
import { ProviderID } from "../../src/provider/schema"
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
  await KiCodeAuth.logout()
})

test("kicode provider fetch refreshes and retries after 401", async () => {
  const old = jwt(10 * 60_000)
  const next = jwt(20 * 60_000)
  const calls: Array<{ url: string; auth: string | null }> = []

  globalThis.fetch = mock((url: string | URL | Request, init?: RequestInit) => {
    const text = url.toString()
    const auth = new Headers(init?.headers).get("Authorization")
    calls.push({ url: text, auth })

    if (text === "https://kicode.chat/api/auth/profile") {
      return Promise.resolve(new Response(JSON.stringify({ username: "ki" }), { status: 200 }))
    }

    if (text === "https://kicode.chat/api/codex/v1/models") {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            object: "list",
            data: [{ id: "gpt-5.2" }],
          }),
          { status: 200 },
        ),
      )
    }

    if (text === "https://kicode.chat/api/claude/v1/models") {
      return Promise.resolve(
        new Response(
          JSON.stringify({
            data: [{ id: "claude-sonnet-4-20250514", display_name: "Claude Sonnet 4" }],
            has_more: false,
          }),
          { status: 200 },
        ),
      )
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

    if (text === "https://kicode.chat/api/codex/v1/responses") {
      if (auth === `Bearer ${old}`) return Promise.resolve(new Response("stale", { status: 401 }))
      if (auth === `Bearer ${next}`) return Promise.resolve(new Response("ok", { status: 200 }))
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
      expires: Date.now() + 10 * 60_000,
    }),
  )

  await using tmp = await tmpdir({
    init: async (dir) => {
      await Bun.write(
        path.join(dir, "opencode.json"),
        JSON.stringify({
          $schema: "https://opencode.ai/config.json",
        }),
      )
    },
  })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const providers = await Provider.list()
      const run = providers[ProviderID.openai].options.fetch as typeof fetch
      const res = await run("https://kicode.chat/api/codex/v1/responses", {
        method: "POST",
        headers: {
          Authorization: "Bearer stale-static",
          "content-type": "application/json",
        },
        body: JSON.stringify({ input: "ping" }),
      })

      expect(res.status).toBe(200)
      expect(await res.text()).toBe("ok")
    },
  })

  expect(
    calls.filter((item) => item.url === "https://kicode.chat/api/codex/v1/responses").map((item) => item.auth),
  ).toEqual([`Bearer ${old}`, `Bearer ${next}`])
})

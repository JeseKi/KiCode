import { afterEach, describe, expect, mock, test } from "bun:test"
import path from "path"
import { Auth } from "../../src/auth"
import { KiCodeAuth } from "../../src/kicode/auth"
import { Instance } from "../../src/project/instance"
import { MessageID, SessionID } from "../../src/session/schema"
import { ImageGenTool } from "../../src/tool/imagegen"
import { tmpdir } from "../fixture/fixture"

const original = globalThis.fetch

const ctx = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make("message"),
  callID: "",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

function jwt(ms: number) {
  const exp = Math.floor((Date.now() + ms) / 1000)
  const head = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url")
  const body = Buffer.from(JSON.stringify({ exp })).toString("base64url")
  return `${head}.${body}.sig`
}

async function auth(access = jwt(10 * 60_000), refresh = "rt_old") {
  await Auth.set(
    "kicode",
    new Auth.Session({
      type: "session",
      username: "ki",
      access,
      refresh,
      expires: Date.now() + 10 * 60_000,
    }),
  )
  return { access, refresh }
}

afterEach(async () => {
  globalThis.fetch = original
  await KiCodeAuth.logout()
})

describe("tool.imagegen", () => {
  test("generates images with kicode auth and returns a response log", async () => {
    const { access } = await auth()
    const calls: Array<{ url: string; auth: string | null; body?: Record<string, unknown> }> = []

    globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      const url = input.toString()
      calls.push({
        url,
        auth: new Headers(init?.headers).get("Authorization"),
        body: typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : undefined,
      })
      if (url === "https://kicode.chat/api/auth/profile") return new Response(JSON.stringify({ username: "ki" }))
      if (url === "https://kicode.chat/api/codex/v1/images/generations") {
        return new Response(
          JSON.stringify({
            data: [{ b64_json: "aW1n", revised_prompt: "better prompt" }],
            usage: { total_tokens: 10 },
          }),
        )
      }
      throw new Error(`unexpected url: ${url}`)
    }) as unknown as typeof fetch

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await ImageGenTool.init()
        const result = await tool.execute(
          {
            action: "generate",
            prompt: "draw a clean icon",
            size: "1024x1024",
            quality: "low",
          },
          ctx,
        )

        expect(calls.map((item) => item.url)).toEqual([
          "https://kicode.chat/api/auth/profile",
          "https://kicode.chat/api/codex/v1/images/generations",
        ])
        expect(calls[1].auth).toBe(`Bearer ${access}`)
        expect(calls[1].body).toMatchObject({
          model: "gpt-image-2",
          prompt: "draw a clean icon",
          size: "1024x1024",
          quality: "low",
          output_format: "png",
          background: "auto",
          n: 1,
        })
        expect(result.output).toBe(result.metadata.logPath)
        expect(result.metadata.logPath).toStartWith(path.join(tmp.path, ".logs", "image_gen_"))
        expect(result.attachments).toBeUndefined()
        const log = await Bun.file(result.metadata.logPath as string).json()
        expect(log.request.headers.authorization).toBe("Bearer ***")
        expect(log.response.status).toBe(200)
        expect(result.metadata.revised).toEqual(["better prompt"])
        expect(log.images[0]).toMatchObject({
          filename: "imagegen-1.png",
          mime: "image/png",
          data_url: "data:image/png;base64,aW1n",
        })
      },
    })
  })

  test("refreshes and retries after image endpoint returns 401", async () => {
    const old = jwt(10 * 60_000)
    const next = jwt(20 * 60_000)
    await auth(old)
    const auths: Array<string | null> = []

    globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      const url = input.toString()
      const header = new Headers(init?.headers).get("Authorization")
      if (url === "https://kicode.chat/api/auth/profile") return new Response(JSON.stringify({ username: "ki" }))
      if (url === "https://kicode.chat/api/auth/refresh") {
        expect(header).toBe("Bearer rt_old")
        return new Response(JSON.stringify({ access_token: next, refresh_token: "rt_new" }))
      }
      if (url === "https://kicode.chat/api/codex/v1/images/generations") {
        auths.push(header)
        if (header === `Bearer ${old}`) return new Response("stale", { status: 401 })
        return new Response(JSON.stringify({ data: [{ b64_json: "aW1n" }] }))
      }
      throw new Error(`unexpected url: ${url}`)
    }) as unknown as typeof fetch

    const tool = await ImageGenTool.init()
    const result = await tool.execute({ action: "generate", prompt: "draw" }, ctx)

    expect(auths).toEqual([`Bearer ${old}`, `Bearer ${next}`])
    const log = await Bun.file(result.output).json()
    expect(log.images[0].data_url).toBe("data:image/png;base64,aW1n")
    expect(result.attachments).toBeUndefined()
  })

  test("edits local images with multipart form data", async () => {
    await auth()
    const forms: FormData[] = []

    globalThis.fetch = mock(async (input: string | URL | Request, init?: RequestInit) => {
      const url = input.toString()
      if (url === "https://kicode.chat/api/auth/profile") return new Response(JSON.stringify({ username: "ki" }))
      if (url === "https://kicode.chat/api/codex/v1/images/edits") {
        forms.push(init?.body as FormData)
        return new Response(JSON.stringify({ data: [{ b64_json: "ZWRpdA==" }] }))
      }
      throw new Error(`unexpected url: ${url}`)
    }) as unknown as typeof fetch

    await using tmp = await tmpdir({
      init: async (dir) => {
        const png = Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==",
          "base64",
        )
        await Bun.write(path.join(dir, "image.png"), png)
        await Bun.write(path.join(dir, "mask.png"), png)
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await ImageGenTool.init()
        const result = await tool.execute(
          {
            action: "edit",
            prompt: "make it blue",
            images: ["image.png"],
            mask: "mask.png",
            output_format: "webp",
          },
          ctx,
        )

        expect(result.attachments).toBeUndefined()
        const log = await Bun.file(result.output).json()
        expect(log.images[0].mime).toBe("image/webp")
      },
    })

    expect(forms.length).toBe(1)
    expect(forms[0].get("prompt")).toBe("make it blue")
    expect(forms[0].get("model")).toBe("gpt-image-2")
    expect(forms[0].get("output_format")).toBe("webp")
    expect(forms[0].getAll("image[]").length).toBe(1)
    expect(forms[0].get("mask")).toBeDefined()
  })

  test("requires images for edit", async () => {
    const tool = await ImageGenTool.init()
    await expect(tool.execute({ action: "edit", prompt: "edit" }, ctx)).rejects.toThrow("images is required")
  })

  test("requires kicode auth", async () => {
    const tool = await ImageGenTool.init()
    await expect(tool.execute({ action: "generate", prompt: "draw" }, ctx)).rejects.toThrow("请重新登陆 KiCode")
  })

  test("rejects non-image local files", async () => {
    await auth()
    globalThis.fetch = mock(async (input: string | URL | Request) => {
      const url = input.toString()
      if (url === "https://kicode.chat/api/auth/profile") return new Response(JSON.stringify({ username: "ki" }))
      throw new Error(`unexpected url: ${url}`)
    }) as unknown as typeof fetch

    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "note.txt"), "not an image")
      },
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await ImageGenTool.init()
        await expect(
          tool.execute({ action: "edit", prompt: "edit", images: ["note.txt"] }, ctx),
        ).rejects.toThrow("Unsupported image MIME type")
      },
    })
  })

  test("surfaces upstream errors", async () => {
    await auth()
    globalThis.fetch = mock(async (input: string | URL | Request) => {
      const url = input.toString()
      if (url === "https://kicode.chat/api/auth/profile") return new Response(JSON.stringify({ username: "ki" }))
      if (url === "https://kicode.chat/api/codex/v1/images/generations") {
        return new Response(JSON.stringify({ error: { message: "blocked" } }), { status: 400 })
      }
      throw new Error(`unexpected url: ${url}`)
    }) as unknown as typeof fetch

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await ImageGenTool.init()
        const error = await tool.execute({ action: "generate", prompt: "draw" }, ctx).catch((err) => err)
        expect(error).toBeInstanceOf(Error)
        expect(error.message).toContain("blocked")
        const file = error.message.match(/Debug log: (.+)$/m)?.[1]
        expect(file).toStartWith(path.join(tmp.path, ".logs", "image_gen_"))
        const log = await Bun.file(file!).json()
        expect(log.request.headers.authorization).toBe("Bearer ***")
        expect(log.request.body.prompt).toBe("draw")
        expect(log.response.status).toBe(400)
        expect(log.response.body.error.message).toBe("blocked")
      },
    })
  })

  test("logs missing image data responses", async () => {
    await auth()
    globalThis.fetch = mock(async (input: string | URL | Request) => {
      const url = input.toString()
      if (url === "https://kicode.chat/api/auth/profile") return new Response(JSON.stringify({ username: "ki" }))
      if (url === "https://kicode.chat/api/codex/v1/images/generations") {
        return new Response(JSON.stringify({ data: [], usage: { total_tokens: 1 } }))
      }
      throw new Error(`unexpected url: ${url}`)
    }) as unknown as typeof fetch

    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await ImageGenTool.init()
        const error = await tool.execute({ action: "generate", prompt: "draw" }, ctx).catch((err) => err)
        expect(error).toBeInstanceOf(Error)
        expect(error.message).toContain("KiCode image response did not include image data")
        const file = error.message.match(/Debug log: (.+)$/m)?.[1]
        expect(file).toStartWith(path.join(tmp.path, ".logs", "image_gen_"))
        const log = await Bun.file(file!).json()
        expect(log.request.headers.authorization).toBe("Bearer ***")
        expect(log.response.status).toBe(200)
        expect(log.response.body.data).toEqual([])
      },
    })
  })
})

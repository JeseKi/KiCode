import path from "path"
import z from "zod"
import { KiCodeAuth } from "@/kicode/auth"
import { Filesystem } from "@/util/filesystem"
import { Instance } from "@/project/instance"
import { abortAfterAny } from "@/util/abort"
import { Tool } from "./tool"
import { assertExternalDirectory } from "./external-directory"
import DESCRIPTION from "./imagegen.txt"

const root = process.env.OPENCODE_KICODE_URL || "https://kicode.chat"
const url = process.env.OPENCODE_KICODE_IMAGE_URL || `${root}/api/codex/v1/images`
const timeout = 120_000
const max = 50 * 1024 * 1024

const Output = z.enum(["png", "jpeg", "webp"])
const Source = z.string().min(1)

type Row = {
  b64_json?: unknown
  revised_prompt?: unknown
  url?: unknown
}

type Body = {
  data?: unknown
  usage?: unknown
  error?: unknown
}

type Diag = {
  request: {
    url: string
    method: string
    headers: Record<string, string>
    body: unknown
  }
  response?: {
    status: number
    headers: Record<string, string>
    body: unknown
    text: string
  }
  images?: Array<{
    filename: string
    mime: string
    data_url: string
  }>
}

function obj(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object"
}

function dir() {
  try {
    return Instance.directory
  } catch {
    return process.cwd()
  }
}

function headers(input: HeadersInit | undefined, auth = false) {
  const out: Record<string, string> = {}
  new Headers(input).forEach((value, key) => {
    out[key] = key.toLowerCase() === "authorization" && value.startsWith("Bearer ") ? "Bearer ***" : value
  })
  if (auth && !out.authorization) out.authorization = "Bearer ***"
  return out
}

async function record(input: Diag) {
  const file = path.resolve(dir(), ".logs", `image_gen_${Date.now()}.json`)
  await Filesystem.writeJson(file, {
    created_at: new Date().toISOString(),
    ...input,
  })
  return file
}

function err(body: unknown, text: string, status: number) {
  if (obj(body)) {
    const error = body.error
    if (obj(error) && typeof error.message === "string") return error.message
    const detail = body.detail
    if (typeof detail === "string") return detail
    const message = body.message
    if (typeof message === "string") return message
  }
  const msg = text.trim()
  if (msg) return msg
  return `KiCode image request failed (${status})`
}

async function json(res: Response) {
  const text = await res.text()
  const body = text
    ? await Promise.resolve()
        .then(() => JSON.parse(text))
        .catch(() => undefined)
    : undefined
  return { body, text }
}

async function token() {
  const row = await KiCodeAuth.session()
  if (!row?.access) throw new Error("请重新登陆 KiCode 以使用 imagegen。")
  return row.access
}

async function call(input: string, init: RequestInit, signal: AbortSignal) {
  const head = new Headers(init.headers)
  head.set("Authorization", `Bearer ${await token()}`)
  const res = await fetch(input, {
    ...init,
    headers: head,
    signal,
  })
  if (res.status !== 401) return res

  const row = await KiCodeAuth.refresh().catch(() => undefined)
  if (!row?.access) {
    void KiCodeAuth.logout()
    throw new Error("KiCode Session 过期，请重新登录。")
  }

  const retry = new Headers(init.headers)
  retry.set("Authorization", `Bearer ${row.access}`)
  return fetch(input, {
    ...init,
    headers: retry,
    signal,
  })
}

async function read(src: string, ctx: Tool.Context) {
  if (src.startsWith("data:")) {
    const match = src.match(/^data:([^;,]+)?(;base64)?,(.*)$/s)
    if (!match) throw new Error("Invalid data URL image source")
    const mime = match[1] || "application/octet-stream"
    const bytes = match[2] ? Buffer.from(match[3], "base64") : Buffer.from(decodeURIComponent(match[3]))
    if (!mime.startsWith("image/")) throw new Error(`Unsupported image MIME type: ${mime}`)
    if (bytes.byteLength > max) throw new Error("Image source exceeds 50MB")
    return { bytes, mime, name: `image.${mime.split("/")[1] ?? "png"}` }
  }

  if (src.startsWith("http://") || src.startsWith("https://")) {
    const { signal, clearTimeout } = abortAfterAny(timeout, ctx.abort)
    const res = await fetch(src, { signal })
    clearTimeout()
    if (!res.ok) throw new Error(`Failed to fetch image source (${res.status}): ${src}`)
    const mime = res.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase() || Filesystem.mimeType(src)
    if (!mime.startsWith("image/")) throw new Error(`Unsupported image MIME type: ${mime}`)
    const bytes = Buffer.from(await res.arrayBuffer())
    if (bytes.byteLength > max) throw new Error("Image source exceeds 50MB")
    return { bytes, mime, name: path.basename(new URL(src).pathname) || `image.${mime.split("/")[1] ?? "png"}` }
  }

  const file =
    process.platform === "win32"
      ? Filesystem.normalizePath(path.resolve(Instance.directory, src))
      : path.resolve(Instance.directory, src)
  const stat = Filesystem.stat(file)
  if (!stat?.isFile()) throw new Error(`Image file not found: ${file}`)
  await assertExternalDirectory(ctx, file, { kind: "file" })
  await ctx.ask({
    permission: "read",
    patterns: [file],
    always: ["*"],
    metadata: {},
  })
  const mime = Filesystem.mimeType(file)
  if (!mime.startsWith("image/")) throw new Error(`Unsupported image MIME type: ${mime}`)
  if (Number(stat.size) > max) throw new Error("Image source exceeds 50MB")
  return { bytes: await Filesystem.readBytes(file), mime, name: path.basename(file) }
}

async function image(row: Row) {
  if (typeof row.b64_json === "string" && row.b64_json) return row.b64_json
  if (typeof row.url !== "string" || !row.url) return
  const res = await fetch(row.url)
  if (!res.ok) throw new Error(`Failed to fetch generated image (${res.status})`)
  return Buffer.from(await res.arrayBuffer()).toString("base64")
}

function bytes(buf: Buffer) {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
}

function ref(input: Awaited<ReturnType<typeof read>>) {
  return {
    name: input.name,
    mime: input.mime,
    size: input.bytes.byteLength,
  }
}

export const ImageGenTool = Tool.define("imagegen", {
  description: DESCRIPTION,
  parameters: z
    .object({
      action: z.enum(["generate", "edit"]).describe("Whether to generate a new image or edit source images."),
      prompt: z.string().min(1).describe("Detailed image generation or editing prompt."),
      model: z.string().optional().describe('Image model to use. Defaults to "gpt-image-2".'),
      size: z.string().optional().describe('Output size such as "auto", "1024x1024", "1536x1024", or "1024x1536".'),
      quality: z.enum(["auto", "low", "medium", "high"]).optional().describe('Output quality. Defaults to "auto".'),
      output_format: Output.optional().describe('Output format. Defaults to "png".'),
      background: z.enum(["auto", "opaque", "transparent"]).optional().describe('Background handling. Defaults to "auto".'),
      n: z.number().int().min(1).max(4).optional().describe("Number of images to generate. Defaults to 1."),
      images: z.array(Source).optional().describe("Source image paths, URLs, or data URLs. Required for edit."),
      mask: Source.optional().describe("Optional mask image path, URL, or data URL for edit."),
    })
    .refine((input) => input.action === "generate" || Boolean(input.images?.length), {
      message: "images is required when action is edit",
      path: ["images"],
    }),
  async execute(params, ctx) {
    await ctx.ask({
      permission: "imagegen",
      patterns: [params.prompt, ...(params.images ?? []), ...(params.mask ? [params.mask] : [])],
      always: ["*"],
      metadata: {
        action: params.action,
        model: params.model,
        size: params.size,
        quality: params.quality,
        output_format: params.output_format,
      },
    })

    const format = params.output_format ?? "png"
    const init = {
      model: params.model ?? "gpt-image-2",
      prompt: params.prompt,
      size: params.size ?? "auto",
      quality: params.quality ?? "auto",
      output_format: format,
      background: params.background ?? "auto",
      n: params.n ?? 1,
    }
    const { signal, clearTimeout } = abortAfterAny(timeout, ctx.abort)
    let diag: Diag | undefined
    const res = await (async () => {
      try {
        return params.action === "generate"
          ? await (async () => {
              const req = {
                method: "POST",
                headers: {
                  "content-type": "application/json",
                },
                body: JSON.stringify(init),
              }
              diag = {
                request: {
                  url: `${url}/generations`,
                  method: req.method,
                  headers: headers(req.headers, true),
                  body: init,
                },
              }
              return call(`${url}/generations`, req, signal)
            })()
          : await (async () => {
              const form = new FormData()
              Object.entries(init).forEach(([key, value]) => form.append(key, String(value)))
              const refs = await Promise.all(params.images!.map((src) => read(src, ctx)))
              refs.forEach((ref) =>
                form.append("image[]", new Blob([bytes(ref.bytes)], { type: ref.mime }), ref.name),
              )
              const mask = params.mask ? await read(params.mask, ctx) : undefined
              if (mask) {
                form.append("mask", new Blob([bytes(mask.bytes)], { type: mask.mime }), mask.name)
              }
              diag = {
                request: {
                  url: `${url}/edits`,
                  method: "POST",
                  headers: headers(undefined, true),
                  body: {
                    ...init,
                    images: refs.map(ref),
                    mask: mask ? ref(mask) : undefined,
                  },
                },
              }
              return call(`${url}/edits`, { method: "POST", body: form }, signal)
            })()
      } catch (error) {
        if (!diag) throw error
        const file = await record(diag)
        throw new Error(`${error instanceof Error ? error.message : String(error)}\nDebug log: ${file}`)
      } finally {
        clearTimeout()
      }
    })()

    const parsed = await json(res)
    diag!.response = {
      status: res.status,
      headers: headers(res.headers),
      body: parsed.body,
      text: parsed.text,
    }
    if (!res.ok) {
      const file = await record(diag!)
      throw new Error(`${err(parsed.body, parsed.text, res.status)}\nDebug log: ${file}`)
    }

    const body = parsed.body as Body
    const rows = Array.isArray(body.data) ? (body.data as Row[]) : []
    const imgs = await Promise.all(rows.map(image))
      .then((list) => list.filter((item): item is string => Boolean(item)))
      .catch(async (error) => {
        const file = await record(diag!)
        throw new Error(`${error instanceof Error ? error.message : String(error)}\nDebug log: ${file}`)
      })
    if (!imgs.length) {
      const file = await record(diag!)
      throw new Error(`KiCode image response did not include image data\nDebug log: ${file}`)
    }

    const revised = rows
      .map((row) => (typeof row.revised_prompt === "string" ? row.revised_prompt : undefined))
      .filter((item): item is string => Boolean(item))
    diag!.images = imgs.map((b64, idx) => ({
      filename: `imagegen-${idx + 1}.${format}`,
      mime: `image/${format}`,
      data_url: `data:image/${format};base64,${b64}`,
    }))
    const log = await record(diag!)

    return {
      title: `imagegen ${params.action}`,
      output: log,
      metadata: {
        action: params.action,
        model: init.model,
        size: init.size,
        quality: init.quality,
        output_format: format,
        count: imgs.length,
        usage: body.usage,
        logPath: log,
        revised,
      },
    }
  },
})

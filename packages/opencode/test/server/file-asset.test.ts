import { afterEach, describe, expect, test } from "bun:test"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

afterEach(async () => {
  await Instance.disposeAll()
})

const png = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00,
  0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4, 0x89,
])

describe("file asset endpoint", () => {
  test("serves raster images from the project", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "image.png"), png)
      },
    })

    const app = Server.Default()
    const res = await app.request(`/file/asset?path=${encodeURIComponent(path.join(tmp.path, "image.png"))}`, {
      headers: {
        "x-opencode-directory": tmp.path,
      },
    })

    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("image/png")
    expect(Buffer.from(await res.arrayBuffer()).equals(png)).toBe(true)
  })

  test("serves encoded image paths", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "image one.png"), png)
      },
    })

    const res = await Server.Default().request(
      `/file/asset?path=${encodeURIComponent(path.join(tmp.path, "image%20one.png"))}`,
      {
        headers: {
          "x-opencode-directory": tmp.path,
        },
      },
    )

    expect(res.status).toBe(200)
    expect(res.headers.get("content-type")).toContain("image/png")
  })

  test("rejects paths outside the project", async () => {
    await using tmp = await tmpdir()
    await using other = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "image.png"), png)
      },
    })

    const res = await Server.Default().request(
      `/file/asset?path=${encodeURIComponent(path.join(other.path, "image.png"))}`,
      {
        headers: {
          "x-opencode-directory": tmp.path,
        },
      },
    )

    expect(res.status).toBe(403)
  })

  test("rejects non-images", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "note.txt"), "hello")
      },
    })

    const res = await Server.Default().request("/file/asset?path=note.txt", {
      headers: {
        "x-opencode-directory": tmp.path,
      },
    })

    expect(res.status).toBe(415)
  })
})

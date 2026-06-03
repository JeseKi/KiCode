import { DataProvider } from "@opencode-ai/ui/context"
import { showToast } from "@opencode-ai/ui/toast"
import { base64Encode } from "@opencode-ai/util/encode"
import { useLocation, useNavigate, useParams } from "@solidjs/router"
import { createEffect, createMemo, type ParentProps, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { LocalProvider } from "@/context/local"
import { usePlatform } from "@/context/platform"
import { useServer } from "@/context/server"
import { SDKProvider } from "@/context/sdk"
import { SyncProvider, useSync } from "@/context/sync"
import { decode64 } from "@/utils/base64"

function DirectoryDataProvider(props: ParentProps<{ directory: string }>) {
  const location = useLocation()
  const navigate = useNavigate()
  const params = useParams()
  const platform = usePlatform()
  const server = useServer()
  const sync = useSync()
  const slug = createMemo(() => base64Encode(props.directory))

  const asset = async (file: string) => {
    const current = server.current?.http
    if (!current) return

    const url = new URL("/file/asset", current.url)
    url.searchParams.set("path", file)
    url.searchParams.set("directory", props.directory)

    if (!current.password) return url.toString()

    const res = await (platform.fetch ?? fetch)(url, {
      headers: {
        Authorization: `Basic ${btoa(`${current.username ?? "opencode"}:${current.password}`)}`,
      },
    })
    if (!res.ok) return
    return URL.createObjectURL(await res.blob())
  }

  createEffect(() => {
    const next = sync.data.path.directory
    if (!next || next === props.directory) return
    const path = location.pathname.slice(slug().length + 1)
    navigate(`/${base64Encode(next)}${path}${location.search}${location.hash}`, { replace: true })
  })

  createEffect(() => {
    const id = params.id
    if (!id) return
    void sync.session.sync(id)
  })

  return (
    <DataProvider
      data={sync.data}
      directory={props.directory}
      asset={asset}
      onNavigateToSession={(sessionID: string) => navigate(`/${slug()}/session/${sessionID}`)}
      onSessionHref={(sessionID: string) => `/${slug()}/session/${sessionID}`}
    >
      <LocalProvider>{props.children}</LocalProvider>
    </DataProvider>
  )
}

export default function Layout(props: ParentProps) {
  const params = useParams()
  const language = useLanguage()
  const navigate = useNavigate()
  let invalid = ""

  const resolved = createMemo(() => {
    if (!params.dir) return ""
    return decode64(params.dir) ?? ""
  })

  createEffect(() => {
    const dir = params.dir
    if (!dir) return
    if (resolved()) {
      invalid = ""
      return
    }
    if (invalid === dir) return
    invalid = dir
    showToast({
      variant: "error",
      title: language.t("common.requestFailed"),
      description: language.t("directory.error.invalidUrl"),
    })
    navigate("/", { replace: true })
  })

  return (
    <Show when={resolved()} keyed>
      {(resolved) => (
        <SDKProvider directory={() => resolved}>
          <SyncProvider>
            <DirectoryDataProvider directory={resolved}>{props.children}</DirectoryDataProvider>
          </SyncProvider>
        </SDKProvider>
      )}
    </Show>
  )
}

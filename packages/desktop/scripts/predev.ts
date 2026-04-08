import { $ } from "bun"

import { copyBinaryToSidecarFolder, getCurrentSidecar, resolveTarget, windowsify } from "./utils"

const target = resolveTarget()

const sidecarConfig = getCurrentSidecar(target)

const binaryPath = windowsify(`../opencode/dist/${sidecarConfig.ocBinary}/bin/opencode`)

await (sidecarConfig.ocBinary.includes("-baseline")
  ? $`cd ../opencode && bun run build --single --baseline`
  : $`cd ../opencode && bun run build --single`)

await copyBinaryToSidecarFolder(binaryPath, target)

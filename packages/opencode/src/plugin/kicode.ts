import type { Hooks, PluginInput } from "@opencode-ai/plugin"

const root = process.env.OPENCODE_KICODE_URL || "https://kicode.chat"
const auth = process.env.OPENCODE_KICODE_AUTH_URL || `${root}/api/llm_login`

async function login(input: Record<string, string>) {
  const user = input.username?.trim()
  const pass = input.password ?? ""
  if (!user || !pass) throw new Error("Username and password are required")

  const res = await fetch(auth, {
    method: "POST",
    headers: {
      "content-type": "application/json",
    },
    body: JSON.stringify({
      username: user,
      password: pass,
    }),
  })

  const text = await res.text()
  if (!res.ok) {
    const msg = text.trim()
    throw new Error(msg || `KiCode login failed (${res.status})`)
  }

  const data = JSON.parse(text) as {
    access_token?: string
  }
  if (!data.access_token) throw new Error("KiCode login returned no access token")

  return {
    url: "",
    instructions: "Signing in with KiCode",
    method: "auto" as const,
    callback: async () => ({
      type: "success" as const,
      key: data.access_token!,
    }),
  }
}

function methods() {
  return [
    {
      type: "oauth" as const,
      label: "KiCode account",
      prompts: [
        {
          type: "text" as const,
          key: "username",
          message: "Username",
          placeholder: "your account username",
        },
        {
          type: "text" as const,
          key: "password",
          message: "Password",
          placeholder: "your account password",
        },
      ],
      authorize: login,
    },
  ]
}

export async function KiCodeOpenAIAuthPlugin(_input: PluginInput): Promise<Hooks> {
  return {
    auth: {
      provider: "openai",
      methods: methods(),
    },
  }
}

export async function KiCodeAnthropicAuthPlugin(_input: PluginInput): Promise<Hooks> {
  return {
    auth: {
      provider: "anthropic",
      methods: methods(),
    },
  }
}

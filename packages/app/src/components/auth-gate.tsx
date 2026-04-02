import { Button } from "@opencode-ai/ui/button"
import { Logo } from "@opencode-ai/ui/logo"
import { Spinner } from "@opencode-ai/ui/spinner"
import { TextField } from "@opencode-ai/ui/text-field"
import { createEffect, createMemo, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useAuth } from "@/context/auth"
import { useLanguage } from "@/context/language"

const mail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const copy = {
  en: {
    badge: "Desktop access",
    title: "Sign in to KiCode",
    subtitle: "The app unlocks model access from your KiCode account after login.",
    note: "Use one account to manage model access, sign-in state, and provider availability in one place.",
    quota: "Unified balance",
    ready: "Ready to use",
    safe: "Data security",
    login: "Login",
    register: "Register",
    username: "Username",
    usernameHint: "your account username",
    password: "Password",
    passwordHint: "your password",
    email: "Email",
    emailHint: "you@example.com",
    code: "Code",
    codeHint: "6-digit code",
    confirm: "Confirm password",
    confirmHint: "repeat your password",
    send: "Send code",
    sending: "Sending...",
    submitLogin: "Sign in",
    submitRegister: "Create account",
    working: "Submitting...",
    sent: "Verification code sent. Check your email.",
    done: "Registered. Sign in with your new account.",
    expired: "Your login expired. Please sign in again.",
    requiredUser: "Username is required",
    requiredPass: "Password is required",
    requiredEmail: "Email is required",
    invalidEmail: "Enter a valid email",
    requiredCode: "Verification code is required",
    shortPass: "Password must be at least 8 characters",
    mismatch: "Passwords do not match",
  },
  zh: {
    badge: "桌面端访问",
    title: "登录 KiCode",
    subtitle: "应用登录后会自动使用你的 KiCode 账户额度访问模型。",
    note: "通过一个账户即可直接进行模型访问和调用智能体，让您的体验更加丝滑。",
    quota: "统一额度",
    ready: "开箱即用",
    safe: "数据安全",
    login: "登录",
    register: "注册",
    username: "用户名",
    usernameHint: "输入你的账户用户名",
    password: "密码",
    passwordHint: "输入你的密码",
    email: "邮箱",
    emailHint: "you@example.com",
    code: "验证码",
    codeHint: "6 位验证码",
    confirm: "确认密码",
    confirmHint: "再次输入密码",
    send: "发送验证码",
    sending: "发送中...",
    submitLogin: "立即登录",
    submitRegister: "创建账号",
    working: "提交中...",
    sent: "验证码已发送，请检查邮箱。",
    done: "注册成功，请使用新账号登录。",
    expired: "登录已过期，请重新登录。",
    requiredUser: "请输入用户名",
    requiredPass: "请输入密码",
    requiredEmail: "请输入邮箱",
    invalidEmail: "请输入正确的邮箱格式",
    requiredCode: "请输入验证码",
    shortPass: "密码至少 8 位",
    mismatch: "两次输入的密码不一致",
  },
}

export function AuthGate() {
  const auth = useAuth()
  const language = useLanguage()
  const text = createMemo(() => (/^zh/.test(language.locale()) ? copy.zh : copy.en))

  const [store, setStore] = createStore({
    mode: "login" as "login" | "register",
    busy: false,
    codeBusy: false,
    wait: 0,
    error: undefined as string | undefined,
    ok: undefined as string | undefined,
    login: {
      username: "",
      password: "",
    },
    register: {
      username: "",
      email: "",
      password: "",
      confirm: "",
      code: "",
    },
  })

  createEffect(() => {
    if (store.wait <= 0) return
    const timer = setInterval(() => {
      setStore("wait", (value) => (value <= 1 ? 0 : value - 1))
    }, 1000)
    onCleanup(() => clearInterval(timer))
  })

  const setError = (error: unknown) => {
    setStore("error", error instanceof Error ? error.message : String(error))
  }

  const clear = () => {
    setStore("error", undefined)
    setStore("ok", undefined)
  }

  const submitLogin = async (event: SubmitEvent) => {
    event.preventDefault()
    clear()
    if (!store.login.username.trim()) return setStore("error", text().requiredUser)
    if (!store.login.password) return setStore("error", text().requiredPass)
    setStore("busy", true)
    await auth
      .login({
        username: store.login.username,
        password: store.login.password,
      })
      .catch(setError)
      .finally(() => setStore("busy", false))
  }

  const sendCode = async () => {
    clear()
    if (!store.register.email.trim()) return setStore("error", text().requiredEmail)
    if (!mail.test(store.register.email.trim())) return setStore("error", text().invalidEmail)
    setStore("codeBusy", true)
    await auth
      .sendCode({
        email: store.register.email.trim(),
      })
      .then(() => {
        setStore("ok", text().sent)
        setStore("wait", 60)
      })
      .catch(setError)
      .finally(() => setStore("codeBusy", false))
  }

  const submitRegister = async (event: SubmitEvent) => {
    event.preventDefault()
    clear()
    if (!store.register.username.trim()) return setStore("error", text().requiredUser)
    if (!store.register.email.trim()) return setStore("error", text().requiredEmail)
    if (!mail.test(store.register.email.trim())) return setStore("error", text().invalidEmail)
    if (store.register.password.length < 8) return setStore("error", text().shortPass)
    if (store.register.password !== store.register.confirm) return setStore("error", text().mismatch)
    if (!store.register.code.trim()) return setStore("error", text().requiredCode)
    setStore("busy", true)
    await auth
      .register({
        username: store.register.username.trim(),
        email: store.register.email.trim(),
        password: store.register.password,
        code: store.register.code.trim(),
      })
      .then(() => {
        setStore("mode", "login")
        setStore("register", {
          username: "",
          email: "",
          password: "",
          confirm: "",
          code: "",
        })
        setStore("wait", 0)
        setStore("ok", text().done)
      })
      .catch(setError)
      .finally(() => setStore("busy", false))
  }

  return (
    <div class="min-h-dvh bg-background-base px-6 py-10 text-text-strong">
      <div class="mx-auto flex min-h-[calc(100dvh-5rem)] max-w-[1080px] items-center justify-center">
        <div class="grid w-full max-w-[980px] gap-6 rounded-[28px] border border-border-weak-base bg-surface-base p-6 shadow-xs-border-base lg:grid-cols-2 lg:p-8">
          <div class="flex h-full flex-col justify-between gap-10 rounded-[20px] bg-[linear-gradient(135deg,var(--surface-raised-base),var(--surface-base))] p-6 lg:p-7">
            <div class="flex flex-col gap-5">
              <div class="inline-flex w-fit items-center gap-2 rounded-full border border-border-weak-base bg-surface-base px-3 py-1 text-12-medium text-text-base">
                <div class="size-2 rounded-full bg-[#C46D42]" />
                {text().badge}
              </div>
              <Logo class="w-40 opacity-90" />
              <div class="flex flex-col gap-3">
                <h1 class="text-28-medium tracking-tight text-text-strong">{text().title}</h1>
                <p class="max-w-[34rem] text-14-regular leading-7 text-text-base">{text().subtitle}</p>
                <p class="max-w-[36rem] text-13-regular leading-6 text-text-weak">{text().note}</p>
              </div>
            </div>
            <ul class="flex flex-col gap-3 text-14-medium text-text-strong">
              {[text().quota, text().ready, text().safe].map((item) => (
                <li class="flex items-center gap-3 rounded-2xl border border-border-weak-base bg-surface-base/80 px-4 py-3">
                  <span class="text-base leading-none text-[#C46D42]">✅</span>
                  <span>{item}</span>
                </li>
              ))}
            </ul>
            <div class="grid gap-3 text-13-regular text-text-weak sm:grid-cols-2">
              <div class="rounded-2xl border border-border-weak-base bg-surface-base px-4 py-3">OpenAI</div>
              <div class="rounded-2xl border border-border-weak-base bg-surface-base px-4 py-3">Anthropic</div>
            </div>
          </div>

          <div class="flex h-full flex-col justify-center gap-6 rounded-[20px] bg-surface-base p-3 lg:p-4">
            <div class="grid w-full grid-cols-2 rounded-2xl bg-surface-raised-base p-1">
              <button
                type="button"
                class="w-full rounded-[14px] px-4 py-2 text-14-medium transition-colors"
                classList={{
                  "bg-surface-base text-text-strong shadow-xs-border-base": store.mode === "login",
                  "text-text-weak": store.mode !== "login",
                }}
                onClick={() => {
                  clear()
                  setStore("mode", "login")
                }}
              >
                {text().login}
              </button>
              <button
                type="button"
                class="w-full rounded-[14px] px-4 py-2 text-14-medium transition-colors"
                classList={{
                  "bg-surface-base text-text-strong shadow-xs-border-base": store.mode === "register",
                  "text-text-weak": store.mode !== "register",
                }}
                onClick={() => {
                  clear()
                  setStore("mode", "register")
                }}
              >
                {text().register}
              </button>
            </div>

            <Show when={auth.notice() === "expired"}>
              <div class="rounded-2xl border border-border-warning-base bg-surface-warning-base px-4 py-3 text-13-regular text-text-base">
                {text().expired}
              </div>
            </Show>
            <Show when={store.error}>
              {(value) => (
                <div class="rounded-2xl border border-border-critical-base bg-surface-critical-base px-4 py-3 text-13-regular text-text-base">
                  {value()}
                </div>
              )}
            </Show>
            <Show when={store.ok}>
              {(value) => (
                <div class="rounded-2xl border border-border-success-base bg-surface-success-base px-4 py-3 text-13-regular text-text-base">
                  {value()}
                </div>
              )}
            </Show>

            <Show
              when={store.mode === "login"}
              fallback={
                <form class="flex flex-col gap-4" onSubmit={submitRegister}>
                  <TextField
                    label={text().username}
                    placeholder={text().usernameHint}
                    value={store.register.username}
                    onChange={(value) => setStore("register", "username", value)}
                    disabled={store.busy}
                    autofocus
                  />
                  <TextField
                    label={text().email}
                    placeholder={text().emailHint}
                    type="email"
                    value={store.register.email}
                    onChange={(value) => setStore("register", "email", value)}
                    disabled={store.busy || store.codeBusy}
                  />
                  <div class="grid gap-3 sm:grid-cols-[1fr_auto]">
                    <TextField
                      label={text().code}
                      placeholder={text().codeHint}
                      value={store.register.code}
                      onChange={(value) => setStore("register", "code", value)}
                      disabled={store.busy}
                    />
                    <div class="flex items-end">
                      <Button
                        type="button"
                        size="large"
                        variant="secondary"
                        disabled={store.codeBusy || store.wait > 0 || store.busy}
                        onClick={() => void sendCode()}
                      >
                        {store.codeBusy ? text().sending : store.wait > 0 ? `${store.wait}s` : text().send}
                      </Button>
                    </div>
                  </div>
                  <TextField
                    label={text().password}
                    placeholder={text().passwordHint}
                    type="password"
                    value={store.register.password}
                    onChange={(value) => setStore("register", "password", value)}
                    disabled={store.busy}
                  />
                  <TextField
                    label={text().confirm}
                    placeholder={text().confirmHint}
                    type="password"
                    value={store.register.confirm}
                    onChange={(value) => setStore("register", "confirm", value)}
                    disabled={store.busy}
                  />
                  <Button type="submit" size="large" variant="primary" disabled={store.busy}>
                    {store.busy ? text().working : text().submitRegister}
                  </Button>
                </form>
              }
            >
              <form class="flex flex-col gap-4" onSubmit={submitLogin}>
                <TextField
                  label={text().username}
                  placeholder={text().usernameHint}
                  value={store.login.username}
                  onChange={(value) => setStore("login", "username", value)}
                  disabled={store.busy}
                  autofocus
                />
                <TextField
                  label={text().password}
                  placeholder={text().passwordHint}
                  type="password"
                  value={store.login.password}
                  onChange={(value) => setStore("login", "password", value)}
                  disabled={store.busy}
                />
                <Button type="submit" size="large" variant="primary" disabled={store.busy}>
                  <Show
                    when={store.busy}
                    fallback={text().submitLogin}
                  >
                    <span class="inline-flex items-center gap-2">
                      <Spinner />
                      {text().working}
                    </span>
                  </Show>
                </Button>
              </form>
            </Show>
          </div>
        </div>
      </div>
    </div>
  )
}

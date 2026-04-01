import { Hono } from "hono"
import { describeRoute, resolver, validator } from "hono-openapi"
import { lazy } from "@/util/lazy"
import { KiCodeAuth } from "@/kicode/auth"
import { errors } from "../error"
import z from "zod"

const Login = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
})

const Register = z.object({
  username: z.string().min(3),
  email: z.string().email(),
  password: z.string().min(8),
  code: z.string().min(6),
})

const Code = z.object({
  email: z.string().email(),
})

const Status = z.object({
  authenticated: z.boolean(),
  username: z.string().optional(),
})

const fail = (error: unknown) => ({
  message: error instanceof Error ? error.message : String(error),
})

export const KiCodeRoutes = lazy(() =>
  new Hono()
    .get(
      "/session",
      describeRoute({
        summary: "Get KiCode auth session",
        description: "Returns the current KiCode app login state.",
        operationId: "kicode.session",
        responses: {
          200: {
            description: "Current KiCode login state",
            content: {
              "application/json": {
                schema: resolver(Status),
              },
            },
          },
        },
      }),
      async (c) => {
        return c.json(await KiCodeAuth.status())
      },
    )
    .post(
      "/login",
      describeRoute({
        summary: "Login to KiCode",
        description: "Authenticates the app with KiCode and stores the session locally.",
        operationId: "kicode.login",
        responses: {
          200: {
            description: "Logged in",
            content: {
              "application/json": {
                schema: resolver(Status),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", Login),
      async (c) => {
        const body = c.req.valid("json")
        return KiCodeAuth.login(body)
          .then(() => c.json({ authenticated: true, username: body.username.trim() }))
          .catch((error) => c.json(fail(error), 400))
      },
    )
    .post(
      "/register",
      describeRoute({
        summary: "Register KiCode account",
        description: "Registers a KiCode account for app login.",
        operationId: "kicode.register",
        responses: {
          201: {
            description: "Registered",
            content: {
              "application/json": {
                schema: resolver(z.unknown()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", Register),
      async (c) => {
        const body = c.req.valid("json")
        return KiCodeAuth.register(body)
          .then((data) => c.json(data, 201))
          .catch((error) => c.json(fail(error), 400))
      },
    )
    .post(
      "/send-verification-code",
      describeRoute({
        summary: "Send KiCode verification code",
        description: "Sends the registration verification code email.",
        operationId: "kicode.sendCode",
        responses: {
          200: {
            description: "Sent",
            content: {
              "application/json": {
                schema: resolver(z.unknown()),
              },
            },
          },
          ...errors(400),
        },
      }),
      validator("json", Code),
      async (c) => {
        const body = c.req.valid("json")
        return KiCodeAuth.sendCode(body)
          .then((data) => c.json(data))
          .catch((error) => c.json(fail(error), 400))
      },
    )
    .post(
      "/logout",
      describeRoute({
        summary: "Logout KiCode",
        description: "Clears the stored KiCode app login session.",
        operationId: "kicode.logout",
        responses: {
          200: {
            description: "Logged out",
            content: {
              "application/json": {
                schema: resolver(z.boolean()),
              },
            },
          },
        },
      }),
      async (c) => {
        await KiCodeAuth.logout()
        return c.json(true)
      },
    ),
)

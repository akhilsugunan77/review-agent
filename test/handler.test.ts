import { describe, it, expect } from "@effect/vitest"
import { Effect, Redacted } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/http"
import { createHmac } from "node:crypto"
import { makeHandler, PullRequestEventSchema } from "./handler.ts"
import { Reviewer } from "./Reviewer.ts"
import { Github } from "./Github.ts"

const sign = (payload: string) =>
  `sha256=${createHmac("sha256", "test-secret").update(payload).digest("hex")}`

const run = (secret?: string) => {
  const body = JSON.stringify(
    PullRequestEventSchema.make({
      action: "create",
      number: 1,
      pull_request: { title: "Example" },
      repository: {
        full_name: "Effect-TS/effect",
      },
    }),
  )

  const req = HttpServerRequest.fromWeb(
    new Request("http://localhost:3000/webhook", {
      method: "POST",
      body,
      headers: {
        "x-hub-signature-256": sign(body),
      },
    }),
  )

  return makeHandler(Redacted.make(secret ?? "test-secret")).pipe(
    Effect.provideService(HttpServerRequest.HttpServerRequest, req),
  )
}

describe("Handler", () => {
  it.effect("Valid webhook", () =>
    Effect.gen(function* () {
      const response = yield* run()
      expect(response.status).toBe(200)
      const webResponse = HttpServerResponse.toWeb(response)
      const text = yield* Effect.promise(() => webResponse.text())
      expect(text).toBe("Fake review: this diff has 2 lines look good")
    }).pipe(Effect.provide([Github.mock, Reviewer.mock])),
  )
  it.effect("Bad signature", () =>
    Effect.gen(function* () {
      const response = yield* run("wrong-secret")
      expect(response.status).toBe(401)
    }).pipe(Effect.provide([Github.mock, Reviewer.mock])),
  )

  it.effect("Github down", () =>
    Effect.gen(function* () {
      const response = yield* run()
      expect(response.status).toBe(502)
    }).pipe(Effect.provide([Github.fail, Reviewer.mock])),
  )
})

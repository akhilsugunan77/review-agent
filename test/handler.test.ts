import { describe, it, expect } from "@effect/vitest"
import { Effect, Layer, Redacted } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/http"
import { createHmac } from "node:crypto"
import { makeHandler, PullRequestEventSchema } from "../src/handler.ts"
import { Reviewer } from "../src/Reviewer.ts"
import { Github } from "../src/Github.ts"
import pullRequestOpenedJson from "./fixtures/pull_request.opened.json" with { type: "json" }
import pullRequestSynchronizeJson from "./fixtures/pull_request.synchronize.json" with { type: "json" }
import { readFileSync } from "node:fs"

const secret = "test-secret"

const exampleDiff = readFileSync(new URL("./fixtures/example.diff", import.meta.url), "utf-8")

const githubSpy = (diff: string, posted: Array<string>) =>
  Layer.succeed(
    Github,
    Github.of({
      getPullRequestDiff: () =>
        Effect.succeed([{ filename: "hello.txt", patch: diff, status: "updated" }]),
      postComment: (_repo, _prNo, body) => Effect.sync(() => posted.push(body)),
    }),
  )

const sign = (payload: string) =>
  `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`

const runPullRequestEvent = (payload: Record<string, any>) => {
  const body = JSON.stringify(payload)
  const req = HttpServerRequest.fromWeb(
    new Request("http://localhost:3000/webhook", {
      method: "POST",
      body,
      headers: {
        "x-hub-signature-256": sign(body),
        "x-github-event": "pull_request",
      },
    }),
  )

  return makeHandler(Redacted.make(secret)).pipe(
    Effect.provideService(HttpServerRequest.HttpServerRequest, req),
  )
}

const run = (secretToken: string, githubEvent?: string, action?: string) => {
  const body = JSON.stringify(
    PullRequestEventSchema.make({
      action: action ?? "opened",
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
        "x-github-event": githubEvent ?? "pull_request",
      },
    }),
  )

  return makeHandler(Redacted.make(secretToken)).pipe(
    Effect.provideService(HttpServerRequest.HttpServerRequest, req),
  )
}

describe("Handler", () => {
  it.effect("PING", () =>
    Effect.gen(function* () {
      const response = yield* run(secret, "ping")
      expect(response.status).toBe(200)
      const webResponse = HttpServerResponse.toWeb(response)
      const text = yield* Effect.promise(() => webResponse.text())
      expect(text).toBe("PONG")
    }).pipe(Effect.provide([Github.mockWithDiff(exampleDiff), Reviewer.mock])),
  )
  it.effect("Pull request with action closed", () =>
    Effect.gen(function* () {
      // UPDATE WITH ACTUAL PAYLOAD
      const response = yield* run(secret, "pull_request", "closed")
      expect(response.status).toBe(200)
      const webResponse = HttpServerResponse.toWeb(response)
      const text = yield* Effect.promise(() => webResponse.text())
      expect(text).toBe("ignored action: closed")
    }).pipe(Effect.provide([Github.mockWithDiff(exampleDiff), Reviewer.mock])),
  )

  const posted: Array<string> = []
  it.effect("Pull request with synchronize", () =>
    Effect.gen(function* () {
      const response = yield* runPullRequestEvent(pullRequestSynchronizeJson)
      expect(response.status).toBe(200)
      expect(posted).toEqual(["Fake review: this diff has 648 lines look good"])
    }).pipe(Effect.provide([githubSpy(exampleDiff, posted), Reviewer.mock])),
  )
  it.effect("Valid webhook", () =>
    Effect.gen(function* () {
      const response = yield* runPullRequestEvent(pullRequestOpenedJson)
      expect(response.status).toBe(200)
      const webResponse = HttpServerResponse.toWeb(response)
      const text = yield* Effect.promise(() => webResponse.text())
      expect(text).toBe("Fake review: this diff has 648 lines look good")
    }).pipe(Effect.provide([Github.mockWithDiff(exampleDiff), Reviewer.mock])),
  )
  it.effect("Bad signature", () =>
    Effect.gen(function* () {
      const response = yield* run("wrong-secret")
      expect(response.status).toBe(401)
    }).pipe(Effect.provide([Github.mockWithDiff(exampleDiff), Reviewer.mock])),
  )

  it.effect("Github down", () =>
    Effect.gen(function* () {
      const response = yield* run(secret)
      expect(response.status).toBe(502)
    }).pipe(Effect.provide([Github.fail, Reviewer.mock])),
  )
})

import { describe, it, expect } from "@effect/vitest"
import { Effect, Redacted } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/http"
import { createHmac } from "node:crypto"
import { makeHandler, PullRequestEventSchema } from "../src/handler.ts"
import { ReviewQueue, type ReviewJob } from "../src/ReviewQueue.ts"
import pullRequestOpenedJson from "./fixtures/pull_request.opened.json" with { type: "json" }
import pullRequestSynchronizeJson from "./fixtures/pull_request.synchronize.json" with { type: "json" }

const secret = "test-secret"

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
      pull_request: {
        title: "Example",
        body: null,
        head: { sha: "abc123" },
        base: { sha: "def456" },
      },
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

const text = (response: HttpServerResponse.HttpServerResponse) =>
  Effect.promise(() => HttpServerResponse.toWeb(response).text())

const expectedJob = (payload: typeof PullRequestEventSchema.Type): ReviewJob => ({
  repo: payload.repository.full_name,
  number: payload.number,
  headSha: payload.pull_request.head.sha,
  baseSha: payload.pull_request.base.sha,
  title: payload.pull_request.title,
  body: payload.pull_request.body,
})

describe("Handler", () => {
  it.effect("PING", () =>
    Effect.gen(function* () {
      const response = yield* run(secret, "ping")
      expect(response.status).toBe(200)
      expect(yield* text(response)).toBe("PONG")
    }).pipe(Effect.provide(ReviewQueue.mock)),
  )

  const ignored: Array<ReviewJob> = []
  it.effect("Pull request with action closed", () =>
    Effect.gen(function* () {
      const response = yield* run(secret, "pull_request", "closed")
      expect(response.status).toBe(200)
      expect(yield* text(response)).toBe("ignored action: closed")
      expect(ignored).toEqual([])
    }).pipe(Effect.provide(ReviewQueue.mockWith(ignored))),
  )

  const opened: Array<ReviewJob> = []
  it.effect("Opened queues a review and answers 202 right away", () =>
    Effect.gen(function* () {
      const response = yield* runPullRequestEvent(pullRequestOpenedJson)
      expect(response.status).toBe(202)
      expect(yield* text(response)).toBe("Review queued")
      expect(opened).toEqual([expectedJob(pullRequestOpenedJson)])
    }).pipe(Effect.provide(ReviewQueue.mockWith(opened))),
  )

  const synchronized: Array<ReviewJob> = []
  it.effect("Synchronize queues a review of the new head", () =>
    Effect.gen(function* () {
      const response = yield* runPullRequestEvent(pullRequestSynchronizeJson)
      expect(response.status).toBe(202)
      expect(synchronized).toEqual([expectedJob(pullRequestSynchronizeJson)])
    }).pipe(Effect.provide(ReviewQueue.mockWith(synchronized))),
  )

  const unsigned: Array<ReviewJob> = []
  it.effect("Bad signature", () =>
    Effect.gen(function* () {
      const response = yield* run("wrong-secret")
      expect(response.status).toBe(401)
      expect(unsigned).toEqual([])
    }).pipe(Effect.provide(ReviewQueue.mockWith(unsigned))),
  )

  it.effect("Queue down", () =>
    Effect.gen(function* () {
      const response = yield* run(secret)
      expect(response.status).toBe(503)
    }).pipe(Effect.provide(ReviewQueue.fail)),
  )
})

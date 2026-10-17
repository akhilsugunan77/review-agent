import { describe, it, expect } from "@effect/vitest"
import { Effect, Layer, Option, Redacted } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/http"
import { createHmac } from "node:crypto"
import { makeHandler, PullRequestEventSchema } from "../src/handler.ts"
import { Reviewer } from "../src/Reviewer.ts"
import type { ReviewContext } from "../src/projectContext.ts"
import { Github, type ReviewInput } from "../src/Github.ts"
import pullRequestOpenedJson from "./fixtures/pull_request.opened.json" with { type: "json" }
import pullRequestSynchronizeJson from "./fixtures/pull_request.synchronize.json" with { type: "json" }
import { readFileSync } from "node:fs"

const secret = "test-secret"

const exampleDiff = readFileSync(new URL("./fixtures/example.diff", import.meta.url), "utf-8")

const githubSpy = (
  diff: string,
  posted: Array<ReviewInput>,
  readme: Option.Option<string> = Option.none(),
  readmeRefs: Array<string> = [],
) =>
  Layer.succeed(
    Github,
    Github.of({
      getPullRequestDiff: () =>
        Effect.succeed([{ filename: "hello.txt", patch: diff, status: "updated" }]),
      createReview: (_repo, _prNo, review) => Effect.sync(() => posted.push(review)),
      getReadme: (_repo, ref) => Effect.sync(() => (readmeRefs.push(ref), readme)),
    }),
  )

const reviewerSpy = (contexts: Array<ReviewContext>) =>
  Layer.succeed(
    Reviewer,
    Reviewer.of({
      review: (_diff, context) =>
        Effect.sync(() => (contexts.push(context), { confidence: 8, summary: "ok", comments: [] })),
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

  const posted: Array<ReviewInput> = []
  it.effect("Pull request with synchronize", () =>
    Effect.gen(function* () {
      const response = yield* runPullRequestEvent(pullRequestSynchronizeJson)
      expect(response.status).toBe(200)
      expect(posted).toEqual([
        {
          commitId: pullRequestSynchronizeJson.pull_request.head.sha,
          body: "**Merge confidence:** 8/10 — Fake review: this diff has 651 lines look good",
          comments: [],
        },
      ])
    }).pipe(Effect.provide([githubSpy(exampleDiff, posted), Reviewer.mock])),
  )

  const inlinePosted: Array<ReviewInput> = []
  const onDiffLine = { path: "hello.txt", line: 2, body: "Breaks when two is empty." }
  const offDiffLine = { path: "hello.txt", line: 99, body: "Not part of the diff." }
  it.effect("Comments on diff lines go inline, the rest go in the body", () =>
    Effect.gen(function* () {
      const response = yield* runPullRequestEvent(pullRequestOpenedJson)
      expect(response.status).toBe(200)
      expect(inlinePosted).toEqual([
        {
          commitId: pullRequestOpenedJson.pull_request.head.sha,
          body:
            "**Merge confidence:** 8/10 — Fake review: this diff has 7 lines look good" +
            "\n\n**Other notes**\n- `hello.txt:99` — Not part of the diff.",
          comments: [onDiffLine],
        },
      ])
    }).pipe(
      Effect.provide([
        githubSpy("@@ -1,2 +1,3 @@\n one\n+two\n three", inlinePosted),
        Reviewer.mockWith([onDiffLine, offDiffLine]),
      ]),
    ),
  )
  const readmeRefs: Array<string> = []
  const contexts: Array<ReviewContext> = []
  it.effect("Reviews with the README from the base commit and the PR title and description", () =>
    Effect.gen(function* () {
      const response = yield* runPullRequestEvent(pullRequestOpenedJson)
      expect(response.status).toBe(200)
      expect(readmeRefs).toEqual([pullRequestOpenedJson.pull_request.base.sha])
      expect(contexts).toEqual([
        {
          title: pullRequestOpenedJson.pull_request.title,
          description: Option.none(),
          readme: Option.some("# Project\n\nBooking app."),
        },
      ])
    }).pipe(
      Effect.provide([
        githubSpy(exampleDiff, [], Option.some("# Project\n\n\n\nBooking app."), readmeRefs),
        reviewerSpy(contexts),
      ]),
    ),
  )
  it.effect("Valid webhook", () =>
    Effect.gen(function* () {
      const response = yield* runPullRequestEvent(pullRequestOpenedJson)
      expect(response.status).toBe(200)
      const webResponse = HttpServerResponse.toWeb(response)
      const text = yield* Effect.promise(() => webResponse.text())
      expect(text).toBe(
        "**Merge confidence:** 8/10 — Fake review: this diff has 651 lines look good",
      )
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

import { describe, it, expect } from "@effect/vitest"
import { Effect, Layer, Option } from "effect"
import { HttpClientError, HttpClientRequest, HttpClientResponse } from "effect/http"
import { readFileSync } from "node:fs"
import { Github, GithubError, type PullRequest, type ReviewInput } from "../src/Github.ts"
import { Reviewer, ReviewerError } from "../src/Reviewer.ts"
import type { ReviewJob } from "../src/ReviewQueue.ts"
import type { ReviewContext } from "../src/projectContext.ts"
import { handleReviewMessage, RetryReview, reviewPullRequest } from "../src/reviewPullRequest.ts"

const exampleDiff = readFileSync(new URL("./fixtures/example.diff", import.meta.url), "utf-8")

const job: ReviewJob = {
  repo: "akhilsugunan77/review-agent",
  number: 7,
  headSha: "head123",
  baseSha: "base456",
  title: "Example",
  body: null,
}

const githubSpy = (options: {
  posted: Array<ReviewInput>
  diff?: string
  pr?: PullRequest
  readme?: Option.Option<string>
  readmeRefs?: Array<string>
  createReview?: Effect.Effect<void, GithubError>
}) =>
  Layer.succeed(
    Github,
    Github.of({
      getPullRequestDiff: () =>
        Effect.succeed([
          { filename: "hello.txt", patch: options.diff ?? exampleDiff, status: "updated" },
        ]),
      getPullRequest: () =>
        Effect.succeed(options.pr ?? { state: "open", head: { sha: job.headSha } }),
      createReview: (_repo, _prNo, review) =>
        options.createReview ?? Effect.sync(() => options.posted.push(review)),
      getReadme: (_repo, ref) =>
        Effect.sync(() => (options.readmeRefs?.push(ref), options.readme ?? Option.none())),
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

const reviewerFail = Layer.succeed(
  Reviewer,
  Reviewer.of({ review: () => new ReviewerError({ cause: "Workers AI timed out" }) }),
)

const githubStatusError = (status: number) => {
  const request = HttpClientRequest.post("https://api.github.com/repos/x/y/pulls/7/reviews")
  return new GithubError({
    cause: new HttpClientError.HttpClientError({
      reason: new HttpClientError.StatusCodeError({
        request,
        response: HttpClientResponse.fromWeb(request, new Response(null, { status })),
      }),
    }),
  })
}

describe("reviewPullRequest", () => {
  const posted: Array<ReviewInput> = []
  it.effect("Posts the review on the job's head commit", () =>
    Effect.gen(function* () {
      yield* reviewPullRequest(job)
      expect(posted).toEqual([
        {
          commitId: job.headSha,
          body: "**Merge confidence:** 8/10 — Fake review: this diff has 651 lines look good",
          comments: [],
        },
      ])
    }).pipe(Effect.provide([githubSpy({ posted }), Reviewer.mock])),
  )

  const inlinePosted: Array<ReviewInput> = []
  const onDiffLine = { path: "hello.txt", line: 2, body: "Breaks when two is empty." }
  const offDiffLine = { path: "hello.txt", line: 99, body: "Not part of the diff." }
  it.effect("Comments on diff lines go inline, the rest go in the body", () =>
    Effect.gen(function* () {
      yield* reviewPullRequest(job)
      expect(inlinePosted).toEqual([
        {
          commitId: job.headSha,
          body:
            "**Merge confidence:** 8/10 — Fake review: this diff has 7 lines look good" +
            "\n\n**Other notes**\n- `hello.txt:99` — Not part of the diff.",
          comments: [onDiffLine],
        },
      ])
    }).pipe(
      Effect.provide([
        githubSpy({ posted: inlinePosted, diff: "@@ -1,2 +1,3 @@\n one\n+two\n three" }),
        Reviewer.mockWith([onDiffLine, offDiffLine]),
      ]),
    ),
  )

  const readmeRefs: Array<string> = []
  const contexts: Array<ReviewContext> = []
  it.effect("Reviews with the README from the base commit and the PR title and description", () =>
    Effect.gen(function* () {
      yield* reviewPullRequest(job)
      expect(readmeRefs).toEqual([job.baseSha])
      expect(contexts).toEqual([
        {
          title: job.title,
          description: Option.none(),
          readme: Option.some("# Project\n\nBooking app."),
        },
      ])
    }).pipe(
      Effect.provide([
        githubSpy({
          posted: [],
          readme: Option.some("# Project\n\n\n\nBooking app."),
          readmeRefs,
        }),
        reviewerSpy(contexts),
      ]),
    ),
  )

  const stalePosted: Array<ReviewInput> = []
  const staleContexts: Array<ReviewContext> = []
  it.effect("Skips a job whose commit is no longer the PR head", () =>
    Effect.gen(function* () {
      yield* reviewPullRequest(job)
      expect(staleContexts).toEqual([])
      expect(stalePosted).toEqual([])
    }).pipe(
      Effect.provide([
        githubSpy({ posted: stalePosted, pr: { state: "open", head: { sha: "newer789" } } }),
        reviewerSpy(staleContexts),
      ]),
    ),
  )

  const closedPosted: Array<ReviewInput> = []
  it.effect("Skips a closed PR", () =>
    Effect.gen(function* () {
      yield* reviewPullRequest(job)
      expect(closedPosted).toEqual([])
    }).pipe(
      Effect.provide([
        githubSpy({ posted: closedPosted, pr: { state: "closed", head: { sha: job.headSha } } }),
        Reviewer.mock,
      ]),
    ),
  )
})

describe("handleReviewMessage", () => {
  it.effect("Retries when the LLM fails", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(handleReviewMessage(job))
      expect(error).toBeInstanceOf(RetryReview)
    }).pipe(Effect.provide([githubSpy({ posted: [] }), reviewerFail])),
  )

  it.effect("Retries on a GitHub 5xx", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(handleReviewMessage(job))
      expect(error).toBeInstanceOf(RetryReview)
    }).pipe(
      Effect.provide([
        githubSpy({ posted: [], createReview: githubStatusError(502) }),
        Reviewer.mock,
      ]),
    ),
  )

  it.effect("Retries when GitHub rate limits", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(handleReviewMessage(job))
      expect(error).toBeInstanceOf(RetryReview)
    }).pipe(
      Effect.provide([
        githubSpy({ posted: [], createReview: githubStatusError(429) }),
        Reviewer.mock,
      ]),
    ),
  )

  it.effect("Drops the job on a GitHub 4xx, since a retry fails the same way", () =>
    handleReviewMessage(job).pipe(
      Effect.provide([
        githubSpy({ posted: [], createReview: githubStatusError(422) }),
        Reviewer.mock,
      ]),
    ),
  )

  const malformedPosted: Array<ReviewInput> = []
  it.effect("Drops a malformed message", () =>
    Effect.gen(function* () {
      yield* handleReviewMessage({ repo: "x/y" })
      expect(malformedPosted).toEqual([])
    }).pipe(Effect.provide([githubSpy({ posted: malformedPosted }), Reviewer.mock])),
  )
})

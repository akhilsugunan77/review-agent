import { Effect, Schema } from "effect"
import { HttpClientError } from "effect/http"
import { Github, type GithubError } from "./Github.ts"
import { Reviewer, ReviewerError } from "./Reviewer.ts"
import { ReviewJob } from "./ReviewQueue.ts"
import { makeReviewContext } from "./projectContext.ts"
import { formatReviewBody, placeComments, reviewableFiles, toDiff } from "./reviewableFiles.ts"

/** Failing with this makes the queue redeliver the job later */
export class RetryReview extends Schema.TaggedError<RetryReview>()("RetryReview", {
  cause: Schema.Defect(),
}) {}

export const reviewPullRequest = Effect.fn("reviewPullRequest")(function* (job: ReviewJob) {
  const github = yield* Github
  // The job can run after newer commits landed (or the PR closed); only review the current head
  const pr = yield* github.getPullRequest(job.repo, job.number)
  if (pr.state !== "open" || pr.head.sha !== job.headSha) {
    yield* Effect.logInfo("Skipping stale review job", {
      repo: job.repo,
      number: job.number,
      jobSha: job.headSha,
      headSha: pr.head.sha,
      state: pr.state,
    })
    return
  }
  const files = reviewableFiles(yield* github.getPullRequestDiff(job.repo, job.number))
  // Read from the base commit so a PR can't rewrite the context it's reviewed with
  const readme = yield* github.getReadme(job.repo, job.baseSha)
  const context = makeReviewContext({ title: job.title, description: job.body, readme })
  const reviewer = yield* Reviewer
  const review = yield* reviewer.review(toDiff(files), context)
  const { inline, unplaced } = placeComments(files, review.comments)
  yield* github.createReview(job.repo, job.number, {
    commitId: job.headSha,
    body: formatReviewBody(review, unplaced),
    comments: inline,
  })
})

// Retry what might pass next time (LLM hiccups, GitHub 5xx, rate limits, network).
// GitHub also returns 404s for a few seconds after a push while the new head propagates, so client errors get retried too
const isRetryable = (error: GithubError | ReviewerError) => {
  if (error instanceof ReviewerError) return true
  if (!HttpClientError.isHttpClientError(error.cause)) return false
  const status = error.cause.response?.status
  return status === undefined || status >= 400
}

const retryOrDrop = (error: GithubError | ReviewerError) =>
  isRetryable(error)
    ? Effect.fail(new RetryReview({ cause: error }))
    : Effect.logError("Dropping review job, a retry would fail the same way", error)

/** Queue consumer entry point: fails only when the job should be retried */
export const handleReviewMessage = (body: unknown) =>
  Schema.decodeUnknownEffect(ReviewJob)(body).pipe(
    Effect.flatMap(reviewPullRequest),
    Effect.catchTags({
      SchemaError: (error) => Effect.logError("Dropping malformed review job", error.message),
      GithubError: retryOrDrop,
      ReviewerError: retryOrDrop,
    }),
  )

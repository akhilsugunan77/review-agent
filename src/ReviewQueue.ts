import { Context, Effect, Layer, Schema } from "effect"

/** What the webhook hands to the background review. Kept small: queue messages are capped at 128 KB */
export const ReviewJob = Schema.Struct({
  repo: Schema.String,
  number: Schema.Finite,
  headSha: Schema.String,
  baseSha: Schema.String,
  title: Schema.String,
  body: Schema.NullOr(Schema.String),
})

export type ReviewJob = typeof ReviewJob.Type

export class ReviewQueueError extends Schema.TaggedError<ReviewQueueError>()("ReviewQueueError", {
  cause: Schema.Defect(),
}) {}

/** Runtime-neutral queue: the Cloudflare Queue lives behind this in worker.ts */
export class ReviewQueue extends Context.Service<
  ReviewQueue,
  {
    enqueue(job: ReviewJob): Effect.Effect<void, ReviewQueueError>
  }
>()("review-agent/ReviewQueue") {
  static readonly mockWith = (enqueued: Array<ReviewJob>) =>
    Layer.succeed(
      ReviewQueue,
      ReviewQueue.of({ enqueue: (job) => Effect.sync(() => enqueued.push(job)) }),
    )

  static readonly mock = ReviewQueue.mockWith([])

  static readonly fail = Layer.succeed(
    ReviewQueue,
    ReviewQueue.of({ enqueue: () => new ReviewQueueError({ cause: "Enqueue failed" }) }),
  )
}

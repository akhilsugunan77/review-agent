import { Context, Effect, Layer, Schema } from "effect"

export class ReviewerError extends Schema.TaggedError<ReviewerError>()("ReviewerError", {
  cause: Schema.Defect(),
}) {}

export class Reviewer extends Context.Service<
  Reviewer,
  {
    review: (diff: string) => Effect.Effect<string, ReviewerError>
  }
>()("review-agent/Reviewer") {
  static readonly mock = Layer.succeed(
    Reviewer,
    Reviewer.of({
      review: (diff) =>
        Effect.succeed(`Fake review: this diff has ${diff.split("\n").length} lines look good`),
    }),
  )
}

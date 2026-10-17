import { RuntimeContext } from "alchemy"
import * as Cloudflare from "alchemy/Cloudflare"
import { Config, Effect, Layer, Stream } from "effect"
import { Github } from "./Github.ts"
import { ReviewQueue, ReviewQueueError } from "./ReviewQueue.ts"
import { Reviewer } from "./Reviewer.ts"
import { makeHandler } from "./handler.ts"
import { handleReviewMessage } from "./reviewPullRequest.ts"

const Services = Layer.mergeAll(Github.layer, Reviewer.layer)

export default Cloudflare.Worker(
  "Worker",
  { main: import.meta.url },
  Effect.gen(function* () {
    const webhookSecret = yield* Config.Redacted("GITHUB_WEBHOOK_SECRET")
    const github = yield* Github
    const reviewer = yield* Reviewer
    const queue = yield* Cloudflare.Queues.Queue("ReviewJobs")
    const writeQueue = yield* Cloudflare.Queues.WriteQueue(queue)

    // One job per batch, so a retry only redelivers the failed review
    yield* Cloudflare.Queues.consumeQueueMessages(
      queue,
      { batchSize: 1, maxRetries: 3, retryDelay: "1 minute" },
      (messages) =>
        Stream.runForEach(messages, (message) => handleReviewMessage(message.body)).pipe(
          Effect.provideService(Github, github),
          Effect.provideService(Reviewer, reviewer),
        ),
    )

    // send needs the RuntimeContext of the current request, so the service is built per request
    const reviewQueue = Effect.gen(function* () {
      const runtime = yield* RuntimeContext
      return ReviewQueue.of({
        enqueue: (job) =>
          writeQueue.send(job).pipe(
            Effect.provideService(RuntimeContext, runtime),
            Effect.mapError((cause) => new ReviewQueueError({ cause })),
          ),
      })
    })

    return {
      fetch: makeHandler(webhookSecret).pipe(Effect.provideServiceEffect(ReviewQueue, reviewQueue)),
    }
    // oxlint-disable-next-line effecttsgo/strict-effect-provide This is the entrypoint for worker
  }).pipe(
    Effect.provide([
      Services,
      Cloudflare.Queues.WriteQueueBinding,
      Cloudflare.Queues.EventSourceLive,
    ]),
  ),
)

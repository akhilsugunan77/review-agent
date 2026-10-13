import * as Cloudflare from "alchemy/Cloudflare"
import { Config, Effect, Layer } from "effect"
import { Github } from "./Github.ts"
import { Reviewer } from "./Reviewer.ts"
import { makeHandler } from "./handler.ts"

const Services = Layer.mergeAll(Github.layer, Reviewer.layer)

export default Cloudflare.Worker(
  "Worker",
  { main: import.meta.url },
  Effect.gen(function* () {
    const webhookSecret = yield* Config.Redacted("GITHUB_WEBHOOK_SECRET")
    const github = yield* Github
    const reviewer = yield* Reviewer
    return {
      fetch: makeHandler(webhookSecret).pipe(
        Effect.provideService(Github, github),
        Effect.provideService(Reviewer, reviewer),
      ),
    }
    // oxlint-disable-next-line effecttsgo/strict-effect-provide This is the entrypoint for worker
  }).pipe(Effect.provide([Services])),
)

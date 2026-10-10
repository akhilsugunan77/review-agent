import * as Cloudflare from "alchemy/Cloudflare"
import { Config, Effect, Redacted, Schema } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/http"

export default Cloudflare.Worker(
  "Worker",
  { main: import.meta.url },
  Effect.gen(function* () {
    console.log("setup ran")
    const webhookSecret = yield* Config.Redacted("GITHUB_WEBHOOK_SECRET")
    console.log(webhookSecret)
    return {
      fetch: makeHandler(webhookSecret),
    }
  }),
)

const PullRequestEventSchema = Schema.Struct({
  action: Schema.String,
  number: Schema.Finite,
  pull_request: Schema.Struct({ title: Schema.String }),
  repository: Schema.Struct({ full_name: Schema.String }),
})

const makeHandler = (_webhookSecret: Redacted.Redacted) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest
    const { url, method } = request
    if (url === "/webhook" && method === "POST") {
      const event = yield* HttpServerRequest.schemaBodyJson(PullRequestEventSchema)
      return HttpServerResponse.text(
        `Reviewing PR #${event.number} "${event.pull_request.title} in ${event.repository.full_name}"`,
      )
    }
    return HttpServerResponse.text("Not found", { status: 404 })
  }).pipe(
    Effect.catchTags({
      HttpServerError: () =>
        Effect.succeed(HttpServerResponse.text("Invalid JSON", { status: 400 })),
      SchemaError: (error) =>
        Effect.succeed(HttpServerResponse.text(error.message, { status: 400 })),
    }),
  )

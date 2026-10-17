import { describe, expect, it } from "@effect/vitest"
import { Effect } from "effect"
import { decodeWorkersAiResponse } from "../src/Reviewer.ts"

const review = {
  analysis: "Checked src/handler.ts.",
  confidence: 8,
  summary: "One bug.",
  comments: [{ path: "src/handler.ts", line: 58, body: "Breaks. **Fails when:** X." }],
}

describe("decodeWorkersAiResponse", () => {
  it.effect("reads result.response (Llama and most Workers AI models)", () =>
    Effect.gen(function* () {
      expect(yield* decodeWorkersAiResponse({ result: { response: review } })).toEqual(review)
    }),
  )

  it.effect("reads choices[0].message.content as a JSON string (gpt-oss)", () =>
    Effect.gen(function* () {
      const json = {
        result: {
          object: "chat.completion",
          choices: [
            {
              message: {
                role: "assistant",
                content: JSON.stringify(review),
                reasoning_content: "We need to review changes...",
              },
            },
          ],
        },
      }
      expect(yield* decodeWorkersAiResponse(json)).toEqual(review)
    }),
  )

  it.effect("fails when the model ran out of tokens and returned no content", () =>
    Effect.gen(function* () {
      const json = { result: { choices: [{ message: { content: null, reasoning_content: "…" } }] } }
      const error = yield* Effect.flip(decodeWorkersAiResponse(json))
      expect(error.message).toContain("content")
    }),
  )
})

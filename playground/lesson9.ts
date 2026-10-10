import { Effect, Redacted } from "effect"
import { describe, it, expect } from "@effect/vitest"
import { InvalidSignature, verifySignature } from "../src/verifySignature.ts"

const validSign = {
  secret: Redacted.make("It's a Secret to Everybody"),
  payload: "Hello, World!",
  header: "sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17",
}

const invalidHeader = {
  secret: Redacted.make("It's a Secret to Everybody"),
  payload: "Hello, World!",
  header: "sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043217",
}

const noHeader = {
  secret: Redacted.make("It's a Secret to Everybody"),
  payload: "Hello, World!",
}

describe("verifySignature", () => {
  it.effect("Accepts a valid signature", () =>
    verifySignature(validSign.secret, validSign.payload, validSign.header),
  )
  it.effect("Rejects mismatched signatures", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        verifySignature(noHeader.secret, noHeader.payload, invalidHeader.header),
      )
      expect(error).toBeInstanceOf(InvalidSignature)
    }),
  )
  it.effect("Rejects missing header", () =>
    Effect.gen(function* () {
      const error = yield* Effect.flip(
        verifySignature(noHeader.secret, noHeader.payload, undefined),
      )
      expect(error).toBeInstanceOf(InvalidSignature)
    }),
  )
})

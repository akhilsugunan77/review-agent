import { Data, Effect, Redacted } from "effect"

const hmacSha256Hex = async (secret: string, payload: string) => {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    {
      name: "HMAC",
      hash: "SHA-256",
    },
    false,
    ["sign"],
  )
  const signature = await crypto.subtle.sign("HMAC", key, enc.encode(payload))
  return Array.from(new Uint8Array(signature), (b) => b.toString(16).padStart(2, "0")).join("")
}

export class InvalidSignature extends Data.TaggedError("InvalidSignature")<{
  reason: string
}> {}

export const verifySignature = (
  secret: Redacted.Redacted,
  payload: string,
  header: string | undefined,
) =>
  Effect.gen(function* () {
    // One check for both cases: compute the expected signature once and compare
    const expected = yield* Effect.promise(() => hmacSha256Hex(Redacted.value(secret), payload))
    if (header === undefined || header !== `sha256=${expected}`) {
      return yield* new InvalidSignature({ reason: "Signature mismatch" })
    }
    return true
  })

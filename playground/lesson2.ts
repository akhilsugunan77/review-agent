import { Effect } from "effect"

// A
const greeting = Effect.succeed("hello")

console.log(await Effect.runPromise(greeting))

// B
const sideEffect = Effect.sync(() => {
  console.log("I am running!")
  return 42
})

const program = Effect.gen(function* () {
  const text = yield* greeting
  const num = yield* sideEffect
  return `${text} ${num}`
})

console.log(await Effect.runPromise(program))

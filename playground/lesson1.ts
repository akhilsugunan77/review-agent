import { Effect } from "effect"

// A
const greeting = Effect.succeed("hello")

console.log(await Effect.runPromise(greeting))

// B
const sideEffect = Effect.sync(() => {
  console.log("I am running!")
  return 42
})

console.log("defined sideEffect")

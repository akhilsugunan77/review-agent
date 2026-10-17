import { describe, expect, it } from "@effect/vitest"
import { commentableLines, numberPatch } from "../src/diffLines.ts"

const patch = `@@ -10,4 +10,5 @@
 const a = 1
-const b = 2
+const b = 3
+const c = 4
 return a
@@ -40,2 +41,2 @@ function tail() {
-old()
+next()
 end()
\\ No newline at end of file`

describe("commentableLines", () => {
  it("has added and context lines from every hunk, numbered on the new side", () => {
    expect([...commentableLines(patch)]).toEqual([10, 11, 12, 13, 41, 42])
  })

  it("excludes lines outside the hunks", () => {
    expect(commentableLines(patch).has(40)).toBe(false)
  })

  it("is empty for an empty patch", () => {
    expect(commentableLines("").size).toBe(0)
  })
})

describe("numberPatch", () => {
  it("prefixes new-file lines with their number and leaves removed lines blank", () => {
    expect(numberPatch(patch).split("\n")).toEqual([
      "@@ -10,4 +10,5 @@",
      "   10  const a = 1",
      "      -const b = 2",
      "   11 +const b = 3",
      "   12 +const c = 4",
      "   13  return a",
      "@@ -40,2 +41,2 @@ function tail() {",
      "      -old()",
      "   41 +next()",
      "   42  end()",
      "      \\ No newline at end of file",
    ])
  })
})

import { describe, expect, it } from "@effect/vitest"
import { formatReviewBody, placeComments, reviewableFiles } from "../src/reviewableFiles.ts"

const file = (filename: string, patch?: string) => ({ filename, status: "modified", patch })

describe("reviewableFiles", () => {
  it("skips lockfiles and fixtures at any depth and files without a patch", () => {
    const files = [
      file("src/a.ts", "@@ -1 +1 @@\n+x"),
      file("pnpm-lock.yaml", "@@ -1 +1 @@\n+x"),
      file("apps/web/package-lock.json", "@@ -1 +1 @@\n+x"),
      file("test/fixtures/pull_request.opened.json", "@@ -1 +1 @@\n+x"),
      file("logo.png"),
    ]
    expect(reviewableFiles(files).map((f) => f.filename)).toEqual(["src/a.ts"])
  })
})

describe("placeComments", () => {
  const files = [file("src/a.ts", "@@ -1,2 +1,3 @@\n one\n+two\n three")]

  it("keeps comments on diff lines inline and moves the rest out", () => {
    const ok = { path: "src/a.ts", line: 2, body: "inline" }
    const outsideHunk = { path: "src/a.ts", line: 50, body: "far away" }
    const unknownFile = { path: "src/b.ts", line: 1, body: "not in the diff" }
    expect(placeComments(files, [ok, outsideHunk, unknownFile])).toEqual({
      inline: [ok],
      unplaced: [outsideHunk, unknownFile],
    })
  })
})

describe("formatReviewBody", () => {
  const review = { analysis: "", confidence: 6, summary: "One risky change.", comments: [] }

  it("is just the confidence line when everything went inline", () => {
    expect(formatReviewBody(review, [])).toBe("**Merge confidence:** 6/10 — One risky change.")
  })

  it("lists comments that couldn't go inline", () => {
    expect(formatReviewBody(review, [{ path: "src/a.ts", line: 50, body: "far away" }])).toBe(
      "**Merge confidence:** 6/10 — One risky change.\n\n**Other notes**\n- `src/a.ts:50` — far away",
    )
  })
})

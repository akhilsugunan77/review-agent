import { describe, expect, it } from "@effect/vitest"
import { Option } from "effect"
import { cleanReadme, makeReviewContext } from "../src/projectContext.ts"
import { userMessage } from "../src/Reviewer.ts"

describe("cleanReadme", () => {
  it("drops badges, images and HTML comments", () => {
    const readme = [
      "# App",
      "[![CI](https://x/badge.svg)](https://x/actions)",
      "![logo](logo.png)",
      '<img src="shot.png" width="300">',
      "<!-- toc -->",
      "",
      "",
      "",
      "Books appointments.",
    ].join("\n")
    expect(cleanReadme(readme)).toBe("# App\n\nBooks appointments.")
  })

  it("caps the length and says so", () => {
    expect(cleanReadme("abcdefghij", 4)).toBe("abcd\n\n[...truncated]")
  })
})

describe("makeReviewContext", () => {
  it("treats an empty description or README as none", () => {
    expect(
      makeReviewContext({ title: "T", description: "  ", readme: Option.some("<!-- x -->") }),
    ).toEqual({ title: "T", description: Option.none(), readme: Option.none() })
  })
})

describe("userMessage", () => {
  it("puts each part in its own section, diff last, and leaves out a missing README", () => {
    const message = userMessage("--- a.ts\n1 +x", {
      title: "Fix dropdown",
      description: Option.some("Opens on click"),
      readme: Option.none(),
    })
    expect(message).toBe(
      "<pull_request_title>\nFix dropdown\n</pull_request_title>\n\n" +
        "<pull_request_description>\nOpens on click\n</pull_request_description>\n\n" +
        "<diff>\n--- a.ts\n1 +x\n</diff>",
    )
  })
})

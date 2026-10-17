import { Option } from "effect"

// The model's context window is small and the diff needs most of it
export const MAX_README_CHARS = 12_000
export const MAX_DESCRIPTION_CHARS = 4_000

/** What the reviewer knows about the project and the change, beyond the diff */
export interface ReviewContext {
  readonly title: string
  readonly description: Option.Option<string>
  readonly readme: Option.Option<string>
}

const truncate = (text: string, max: number) =>
  text.length <= max ? text : `${text.slice(0, max)}\n\n[...truncated]`

/**
 * Drops what costs tokens but tells the model nothing (badges, images, HTML
 * comments, blank runs), then caps the length.
 */
export const cleanReadme = (readme: string, max = MAX_README_CHARS) =>
  truncate(
    readme
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)/g, "")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/<img\b[^>]*>/gi, "")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
    max,
  )

export const makeReviewContext = (input: {
  title: string
  description: string | null
  readme: Option.Option<string>
}): ReviewContext => ({
  title: input.title,
  description: Option.fromNullishOr(input.description).pipe(
    Option.map((d) => d.trim()),
    Option.filter((d) => d.length > 0),
    Option.map((d) => truncate(d, MAX_DESCRIPTION_CHARS)),
  ),
  readme: input.readme.pipe(
    Option.map((r) => cleanReadme(r)),
    Option.filter((r) => r.length > 0),
  ),
})

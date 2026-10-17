import type { PullRequestFile } from "./Github.ts"
import type { Review, ReviewComment } from "./Reviewer.ts"
import { commentableLines, numberPatch } from "./diffLines.ts"

const IGNORED = ["pnpm-lock.yaml", "package-lock.json", "yarn.lock", "bun.lock"]

export const reviewableFiles = (files: ReadonlyArray<PullRequestFile>) => {
  return files.filter((file) => {
    if (!file.patch) return false
    const splitPaths = file.filename.split("/")
    return !splitPaths.some((sp) => IGNORED.includes(sp))
  })
}

export const toDiff = (files: ReadonlyArray<PullRequestFile>) =>
  files
    .map(
      (file) => `
--- ${file.filename}
${numberPatch(file.patch ?? "")}
`,
    )
    .join("\n\n")

/**
 * Splits the model's comments into ones GitHub can anchor to a diff line and
 * ones it can't (wrong path, or a line outside every hunk). Sending even one
 * unanchorable comment makes GitHub reject the whole review with a 422.
 */
export const placeComments = (
  files: ReadonlyArray<PullRequestFile>,
  comments: ReadonlyArray<ReviewComment>,
) => {
  const lines = new Map(files.map((file) => [file.filename, commentableLines(file.patch ?? "")]))
  const inline: Array<ReviewComment> = []
  const unplaced: Array<ReviewComment> = []
  for (const comment of comments) {
    if (lines.get(comment.path)?.has(comment.line)) inline.push(comment)
    else unplaced.push(comment)
  }
  return { inline, unplaced }
}

/** The overall review comment: merge confidence first, then any comments that couldn't go inline. */
export const formatReviewBody = (review: Review, unplaced: ReadonlyArray<ReviewComment>) => {
  const header = `**Merge confidence:** ${review.confidence}/10 — ${review.summary}`
  if (unplaced.length === 0) return header
  const notes = unplaced.map((c) => `- \`${c.path}:${c.line}\` — ${c.body}`).join("\n")
  return `${header}\n\n**Other notes**\n${notes}`
}

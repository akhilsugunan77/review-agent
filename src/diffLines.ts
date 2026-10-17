// Helpers for line numbers inside a unified diff patch (the `patch` field GitHub
// returns per file). Line numbers are for the new version of the file, which is
// what a review comment with side RIGHT points at.

const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/

type PatchLine =
  | { readonly kind: "hunk"; readonly text: string }
  | { readonly kind: "added" | "context"; readonly line: number; readonly text: string }
  | { readonly kind: "removed" | "meta"; readonly text: string }

const parsePatch = (patch: string): ReadonlyArray<PatchLine> => {
  // Lines before the first hunk header aren't part of any hunk
  let next: number | undefined
  return patch.split("\n").map((text): PatchLine => {
    const header = HUNK_HEADER.exec(text)
    if (header) {
      next = Number(header[1])
      return { kind: "hunk", text }
    }
    if (next === undefined) return { kind: "meta", text }
    if (text.startsWith("+")) return { kind: "added", line: next++, text }
    if (text.startsWith("-")) return { kind: "removed", text }
    // "\ No newline at end of file" doesn't take up a line
    if (text.startsWith("\\")) return { kind: "meta", text }
    return { kind: "context", line: next++, text }
  })
}

/** Prefixes every line that exists in the new file with its line number, so the model can cite real lines. */
export const numberPatch = (patch: string) =>
  parsePatch(patch)
    .map((line) => {
      switch (line.kind) {
        case "hunk":
          return line.text
        case "added":
        case "context":
          return `${String(line.line).padStart(5)} ${line.text}`
        default:
          return `${" ".repeat(5)} ${line.text}`
      }
    })
    .join("\n")

/** The new-file lines GitHub accepts a RIGHT side review comment on. Any other line makes it reject the whole review. */
export const commentableLines = (patch: string): ReadonlySet<number> =>
  new Set(
    parsePatch(patch).flatMap((line) =>
      line.kind === "added" || line.kind === "context" ? [line.line] : [],
    ),
  )

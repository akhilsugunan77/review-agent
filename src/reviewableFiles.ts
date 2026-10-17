import type { PullRequestFile } from "./Github.ts"

const IGNORED = ["pnpm-lock.yaml", "package-lock.json", "yarn.lock", "bun.lock"]

export const reviewableFiles = (files: ReadonlyArray<PullRequestFile>) => {
  return files.filter((file) => {
    if (!file.patch) return false
    const splitPaths = file.filename.split("/")
    return !!splitPaths.filter((sp) => IGNORED.includes(sp))
  })
}

export const toDiff = (files: ReadonlyArray<PullRequestFile>) =>
  files
    .map(
      (file) => `
---
${file.filename}\n${file.patch}
`,
    )
    .join("\n\n")

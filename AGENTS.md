# AGENTS.md

Guidance for AI agents (and people) working in this repo.

## What this project is

review-agent is a **full QA bot for pull requests**. It doesn't only read diffs. It understands the project and the business, runs the change in a sandbox (production build plus a clone of the production database), tests it against the requirement (PR description or JIRA ticket), records screenshots or videos of failures, and posts:

- inline comments on the exact diff lines
- one overall **Merge confidence** comment (how safely this can merge without a production issue)

It re-reviews on every push, reviews all open PRs, and replies to authors: it either **discusses** a point or **acknowledges and resolves** it.

The full vision, feature list and **current status table** are in [README.md](README.md). Read it before planning work. Most of the vision isn't built yet, so check the status table to see what exists before assuming a feature does.

## Architecture (today)

GitHub webhook → Cloudflare Worker (`src/worker.ts`) → `makeHandler` (`src/handler.ts`):
verify signature → parse event (`opened` / `synchronize`) → `Github.getPullRequestDiff` → `reviewableFiles` / `toDiff` → `Reviewer.review` (Workers AI) → `Github.postComment`.

Infrastructure is defined in `alchemy.run.ts` (Alchemy v2 beta).

## Conventions

- **Effect-TS is fixed. The runtime is not.** Cloudflare Workers was picked because it was easy to set up, and it may change. Keep Cloudflare-specific code at the edges (`src/worker.ts`, `alchemy.run.ts`, Layers) so the core logic stays independent of the runtime.
- **Effect v4.** Follow the idiomatic patterns in `node_modules/effect/CLAUDE.md` and `node_modules/effect/ai-docs/src/**`.
  - Services are `Context.Service` classes with a `static layer` (real) and `static mock` / `fail` layers for tests.
  - Errors are `Schema.TaggedError` with a `cause`. The handler maps each one to an HTTP status with `Effect.catchTags`.
  - Use `Effect.fn("name")` for service methods, and `Config.Redacted` for secrets.
- Define the Worker's `fetch` handler as a top-level value (`makeHandler`), not inline in `Cloudflare.Worker` setup. Inline handlers break error-type inference (`any-unknown-in-error-context` lint).
- Keep policy (which files to review, which events to handle) in the handler or helpers. Services only talk to external APIs.
- Tests live in `test/` and use real GitHub payload fixtures from `test/fixtures`. Use mocks so tests never call the real network or LLM.
- Paying for an LLM is off the table until the app works end to end. Use free options (Workers AI free tier).

## Commands

Use **pnpm**, not npx.

```sh
pnpm test     # vitest
pnpm check    # typecheck + lint + format check — run before committing
pnpm dev      # local dev
pnpm deploy   # deploy to Cloudflare
```

Secrets live in `.env` (`GITHUB_WEBHOOK_SECRET`, `GITHUB_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_AI_TOKEN`). Never commit them.

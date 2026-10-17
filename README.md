# review-agent

A full QA bot for pull requests. It has the whole project's context: the business, the codebase and where the product is heading. It doesn't stop at reading the diff. It runs the change, tests it against the requirement, records evidence and tells you how confident it is that the PR is safe to merge.

## The idea

Say there's a bug: _"the dropdown doesn't open on click."_ A client agent (or a person) fixes it and opens a PR. That triggers review-agent, which:

1. **Understands the requirement.** It reads the PR description and the linked JIRA ticket, or whatever describes what the change is meant to do.
2. **Spins up a sandbox.** It starts an isolated environment with a clone of the production database, so tests run against realistic data.
3. **Clones the repository.** It reads the whole project, not only the diff, to understand how the change fits.
4. **Runs the production build** and **tests it against the requirement.** For the example above, it opens the page and clicks the dropdown.
5. **Records evidence.** When something fails, it captures a screenshot or a video showing the problem.
6. **Reviews the code** at the same time as it tests.
7. **Comments on the PR:**
   - inline comments on the exact diff lines, with screenshots or videos attached where relevant
   - one overall **Merge confidence** comment: how confident we are that merging won't cause a production issue
8. **Tests big flows too.** It can exercise long end-to-end journeys (signup → checkout, and so on) and record them as videos. There's no limit on scope.

### Continuous and conversational

- **Every open PR** gets reviewed once, and again **whenever new commits are pushed**.
- **It understands replies.** When the author replies to one of its comments, the agent decides to either:
  - **discuss**: reply with more reasoning, evidence or a follow-up question, or
  - **acknowledge and resolve**: accept that the point can be ignored and close the comment.

  (More reply actions will come later.)

### What "context" means here

The agent should review like a senior engineer who has been on the team for years:

- **Project context:** what this product does and who it's for
- **Business context:** why things are the way they are, and which flows matter most
- **Future direction:** where the product is heading, so it can flag changes that work against that
- **Full code knowledge:** the entire repository, not just the diff

## Current status

The project is in its early stages and is being built step by step. What exists today:

| Area                                                                                        | Status           |
| ------------------------------------------------------------------------------------------- | ---------------- |
| GitHub webhook endpoint (`POST /webhook`) with signature verification and schema validation | ✅               |
| Handles `pull_request` `opened` and `synchronize` events (re-reviews on new commits)        | ✅               |
| Fetches the PR's changed files and skips lockfiles                                          | ✅ (in progress) |
| LLM review via Cloudflare Workers AI (small free model)                                     | ✅ basic         |
| Posts the review as one PR comment, including a Merge confidence score                      | ✅               |
| Inline comments on specific diff lines                                                      | ⏳               |
| Project/business context file read from the target repo                                     | ⏳               |
| Fast webhook response plus background processing (GitHub times out after 10s)               | ⏳               |
| Tool-using agent that explores the codebase (read files, search)                            | ⏳               |
| GitHub App identity (bot account instead of a personal token)                               | ⏳               |
| Updating its comment on new pushes instead of posting new ones                              | ⏳               |
| Understanding replies (discuss or resolve)                                                  | ⏳               |
| Sandbox with a cloned production database                                                   | ⏳               |
| Run the build and test against the requirement (JIRA/PR)                                    | ⏳               |
| Screenshots and videos as evidence                                                          | ⏳               |
| Reviewing all open PRs                                                                      | ⏳               |

## Tech stack

- **Runtime:** Cloudflare Workers (could change later; chosen because it was easy to set up)
- **Infrastructure as code:** [Alchemy](https://alchemy.run) (`alchemy.run.ts`)
- **Language and framework:** TypeScript with [Effect](https://effect.website) v4 (services as `Context.Service` + `Layer`, typed errors, `Schema`). This is a fixed choice.
- **LLM:** Cloudflare Workers AI over its REST API (free tier for now)
- **Tests:** vitest + `@effect/vitest`
- **Lint and format:** oxlint (with effect-tsgo rules), oxfmt

## Layout

```
alchemy.run.ts           # Alchemy stack: deploys the Worker
src/worker.ts            # Worker entrypoint: reads config, builds services, provides them to the handler
src/handler.ts           # Webhook handler: verify → parse → fetch PR → review → comment
src/verifySignature.ts   # HMAC check of GitHub's x-hub-signature-256
src/Github.ts            # Github service (fetch PR files, post comments) + mocks
src/Reviewer.ts          # Reviewer service (LLM call, prompt) + mock
src/reviewableFiles.ts   # Which files get reviewed; turns files into diff text
test/                    # Handler and signature tests, real webhook payload fixtures
```

## Development

Use **pnpm** (`npx` fails because the package manager is pinned).

```sh
pnpm install
pnpm dev        # local dev via Alchemy
pnpm test       # vitest
pnpm check      # typecheck + lint + format check
pnpm deploy     # deploy to Cloudflare
```

Required environment variables (in `.env`):

| Variable                | Purpose                      |
| ----------------------- | ---------------------------- |
| `GITHUB_WEBHOOK_SECRET` | Verifies webhook signatures  |
| `GITHUB_TOKEN`          | Reads PRs and posts comments |
| `CLOUDFLARE_ACCOUNT_ID` | Workers AI endpoint          |
| `CLOUDFLARE_AI_TOKEN`   | Workers AI auth              |

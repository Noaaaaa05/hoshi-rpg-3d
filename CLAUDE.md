# Claude Code

@AGENTS.md

The shared rules live in `AGENTS.md` so that ChatGPT and Claude follow the same ones. Change rules there. Keep this file to notes that apply only to Claude Code. The owner's guide in Japanese is [docs/CLAUDE_CODE.md](docs/CLAUDE_CODE.md).

## Checks

- `npm run check`, `npm run rpg:check`, `npm run meshy:dry-run` and `npm test` run on Node 22 with no install.
- `npm run test:browser` needs `npm ci` and the Playwright Chromium and WebKit builds. When a session cannot install them, open the PR and read its `Game checks` result. Say in the report that the browser suite ran on GitHub Actions and not in the session.

## GitHub from a cloud session

- The session acts as the repository owner. `gh pr` and `gh issue` are refused because they use GraphQL. Use the REST API, for example `gh api repos/Noaaaaa05/hoshi-rpg-3d/pulls`.
- A session pushes branches only. It cannot push tags or delete branches, so the `meshy-approval-*` tags are created by the Actions workflow and never by hand.
- A PR that only adds entries to `assets/rpg/catalog.json` goes on a `codex/rpg-content-<name>` branch. The release gate matches that prefix for every agent, so keep it. Any other change goes on `claude/<topic>` and is merged after `Game checks` passes and the owner agrees.

## Paid APIs

- `MESHY_API_KEY` stays in GitHub Actions Secrets. Do not copy it into a cloud environment variable, a file or a prompt.
- A workflow run started with the session's GitHub identity would pass the owner check in `Meshy motions`. Starting that workflow with `mode: generate`, or any other workflow that spends credits, is a paid operation under `AGENTS.md`. Quote the operation, the count and the credits, then wait for the owner's answer.

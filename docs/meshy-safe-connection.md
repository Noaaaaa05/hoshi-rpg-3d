# Meshy integration — safe starting point

This repository uses the Actions secret `MESHY_API_KEY` for future Meshy integrations. Do **not** put the key in repository files, issues, PRs, screenshots or chat.

## First step: zero-cost local readiness check

In GitHub **Actions**, run **Meshy connection readiness (no API calls)** via **Run workflow** on `main`. It only verifies that the secret exists; it does not authenticate with Meshy, contact any network API, or consume credits. A green check is **not** proof of a working Meshy connection.

`MESHY_API_KEY2` is unused and can be deleted from repository secrets once `MESHY_API_KEY` is confirmed.

## Required guardrails before adding generation

- Generation and any credit-consuming request must be **disabled by default**.
- Each run must require a fresh, explicit user approval for the specific asset and a numeric credit/price cap. Approval is not reusable.
- Check available credits, pricing, and endpoint capabilities against current official Meshy documentation before implementing.
- Do not automatically retry, batch, or trigger paid calls on pushes, PRs, schedules or failures.
- Destructive deletion of remote assets requires separate confirmation.
- Keep credentials in GitHub Secrets; never print, echo, commit or upload them.
- Verify animation availability, licensing, GLB export and compatibility with Three.js before deployment.
- Review game changes in a pull request; preserve a rollback path.

## Intended workflow

1. AI drafts an asset and motion plan, including estimated credit cost.
2. User approves the exact scope and cap.
3. Manually triggered protected generation job (future work).
4. Download and inspect model, animation and licenses.
5. Open a game integration PR and test on iPhone.

This PR implements **only** step-zero secret readiness; it does not grant ChatGPT autonomous control of the Meshy account.

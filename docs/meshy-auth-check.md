# Meshy API authentication test

This manual workflow calls the [official free Balance API](https://docs.meshy.ai/en/api/balance) once using `MESHY_API_KEY` from GitHub Actions Secrets.

## How to run

1. Merge this PR into `main`.
2. Open **Actions → Meshy API authentication check (free)**.
3. Choose **Run workflow** on `main`.
4. Open the job log to see either `Meshy API authentication succeeded` and available credits, or a failure status.

This is **one GET request**, without retries. It does not create, modify, delete, or download any model or animation, and does not spend Meshy credits.

### Failure interpretation

- `401`: key invalid/revoked, or unauthorized.
- `403`: account or key restrictions, including IP allowlist.
- `429`: rate limit.
- Other status: inspect Meshy service status or API documentation. No automatic retry.

Do not paste the API key into logs, chat, code or screenshots. This test confirms authentication only; it does not grant ChatGPT autonomous control of Meshy or authorize paid generation. Future paid requests require separate explicit approval, specific asset scope, and a spending cap.

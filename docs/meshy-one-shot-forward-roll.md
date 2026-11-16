# One-shot Meshy forward roll — approved 3-credit test

**User authorization:** one Swift Text to Motion generation, maximum 3 Meshy API credits, no retries, no other paid tasks.

The workflow is **manual only** and requires the exact confirmation text `APPROVE-ONE-FORWARD-ROLL-3-CREDITS`. It runs only from `main`.

It checks the free balance API first, then creates a unique Git tag `meshy-one-shot-forward-roll-swift-2026-11-16` as an atomic permanent one-use lock **before** the paid request. If the lock already exists, the workflow fails without generating. Never delete the lock tag. It then submits exactly one `POST /openapi/v1/text-to-motion` with `mode: swift`, `duration: 3`, and a forward shoulder-roll prompt. No retries, polling, retargeting, rigging, model generation or deletion. If the POST times out or fails after lock creation, **do not rerun**: inspect Meshy's API task list manually first.

The created task ID appears in the GitHub Actions job summary. The task is asynchronous; a green workflow means submission succeeded, not that the clip has finished. A separate free GET can later retrieve task status and a signed BVH download URL. Meshy retains output for about 3 days after completion. A BVH clip is not yet attached to the existing GLB protagonist.

**Cost:** official Meshy Text to Motion API Swift mode: 3 credits. This job does not use Prime (10 credits). The GitHub Actions job itself may consume GitHub Actions minutes depending on account billing. Never share API keys or raw authentication headers.

Official docs: https://docs.meshy.ai/en/api/text-to-motion

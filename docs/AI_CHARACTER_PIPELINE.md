# AI character pipeline: hero and enemies

This branch adds a safe, offline planning stage, **not** a finished end-to-end generator.

## Plan
Edit `config/ai-characters.json` for hero and enemy concepts. Run **AI character pipeline - safe plan** from GitHub Actions to create a downloadable `character-plan` artifact. It does not contact Meshy, charge credits, modify assets, or deploy.

## Required implementation phases
1. Choose and authenticate a licensed image-generation provider; produce original character concept images.
2. Convert each approved concept into textured 3D with Meshy API.
3. Rig each model; verify successful task IDs and joint compatibility.
4. Generate and bind motion clips for each character.
5. Validate GLB meshes, materials, animations, budgets, and mobile performance.
6. Stage tested assets and game integration in a review pull request; never auto-merge.

## Mandatory paid safety gate
Before implementing any paid POST, add an offline quote step using current API pricing and a fixed plan SHA. Require a **separate manual execution** supplying that exact SHA, a positive per-run credit cap, and an explicit paid-consent flag. Reject missing or changed plans, insufficient caps, and unexpected request types. Store the Meshy key only in GitHub Actions Secrets. Require GitHub Environment reviewer protection for paid execution where available. Do not auto-retry uncertain POSTs; persist task IDs for resumability. Also configure a provider-side credit limit, since application-side estimates cannot guarantee charges.

The existing `meshy-motions.yml` is separate and remains unchanged. Existing game and published assets are not modified by this PR.

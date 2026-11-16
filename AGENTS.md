# RPG development

- Start from the latest GitHub `main`. Read [docs/AUTOMATION_PROGRESS.md](docs/AUTOMATION_PROGRESS.md) and [docs/RPG_AUTOMATION.md](docs/RPG_AUTOMATION.md).
- For data-driven features, turn the requested change into a request JSON and use `npm run rpg:apply`. Run the content, unit and browser checks before merging. For an additive catalog-only PR use the release gate. When Actions cannot publish, complete the tested release through the connected GitHub account.
- Use the existing Meshy task retrieval workflow for read-only requests. A request to add game content does not authorize a paid Meshy operation. Match explicit approval to the operation, count and credit ceiling, and preserve approval reservation refs.
- Keep the current iPhone landscape controls, save compatibility and public Pages URL. Report which browsers were tested and leave real-device tests identified when unavailable.

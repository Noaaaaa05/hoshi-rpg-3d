# Hero motion production plan — NOT YET APPROVED

Target: Azure Swordsman in the existing Three.js RPG.

- Idle: upright, confident, relaxed shoulders, subtle breathing, no sleepy slouch.
- Dodge: one forward shoulder roll with crouch, tuck and stand-up, not a whole-model rotation.
- Keep the thumb-friendly inventory and existing movement/collision rules.

## Estimated Meshy API credits

Official pricing reference: https://docs.meshy.ai/en/api/pricing

| Operation | Estimated credits |
|---|---:|
| Text to Motion swift ×2 | 6 |
| Animation retarget ×2 | 6 |
| Rigging (only if required) | 0 or 5 |
| **Total** | **12–17** |

These are **estimates, not a quote**. API credits and account eligibility must be confirmed before any task. Text to Motion generates raw clips, and Animation API retargets them onto a successful Meshy rig. The existing GLB's skeleton must be inspected first; a Meshy rigging task may be necessary. Clip quality and successful import into Three.js are not guaranteed.

## Safety

**No generation is enabled by this PR.** The JSON plan is explicitly unapproved and the workflow runs locally without a Meshy key, network API calls, or spending. Each future credit-consuming task requires a new explicit user approval with an exact task, current cost and maximum credit cap; never automatically retry. Remote deletion requires separate consent.

Next milestone: inspect the existing hero GLB and choose whether a Meshy-compatible rig can be reused, then request approval for one exact paid task before enabling it.

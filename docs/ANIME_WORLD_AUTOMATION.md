# Anime fantasy world automation

This PR implements an **offline world-planning stage only**. It does not generate images, GLBs, animations, or change the playable game.

## Proposed architecture

1. World planner: original style guide, zone layout, asset manifest and NPC/enemy motion sets.
2. Image provider: generate character and prop concept art (provider, pricing, license and authentication must be selected).
3. Meshy adapter: generate textured static props and humanoid/creature models, polling task status.
4. Animation adapter: rig eligible models and generate supported motion clips; fall back to procedural animation for creatures when unsupported.
5. Validator: inspect GLB nodes, materials, skinning, animation clips, scale, mobile budgets and licensing.
6. Game adapter: use Three.js loaders, NPC behavior, collisions, LOD and terrain generation; test in iPhone Safari.
7. Delivery: create a review PR with previews; never auto-merge or deploy paid assets without review.

## Paid authorization gate

All API operations remain disabled in this phase. Before any paid execution is implemented, build a quote from current provider pricing and immutable plan hash, then require a separate manually approved run with explicit consent and maximum credits. Reject hash mismatch or missing approval; enforce task-type allowlists and no unbounded retries. Keep API keys in GitHub Actions Secrets. GitHub environment approval is recommended, and provider spending limits should also be configured. Estimates do not guarantee actual billing.

## First playable milestone

One small town, one forest, one cave; merchant, guard, slime, goblin and a cave boss; NPC interaction, combat, mobile controls and performance tests.

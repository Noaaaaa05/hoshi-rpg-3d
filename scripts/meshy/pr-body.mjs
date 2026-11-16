import { readFile } from 'node:fs/promises';
const report=JSON.parse(await readFile('work/meshy/report.json','utf8'));
console.log(`Add ${report.targets.join(', ')} motions as animation-only GLBs, preserving the active character mesh and existing game rules.

The pipeline checked bone names, hierarchy, rest transforms, inverse bind matrices, playback speed and sampled ground penetration before updating the manifest. Source GLBs and credit/task reports are available in the workflow artifact.

Validation: npm run check, npm test, Chromium and WebKit browser tests passed in this workflow.

Review the visual motion quality before merging. Generated motion quality and real iPhone frame rate require a human check. Merging keeps the existing GitHub Pages deployment path.

Run: https://github.com/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`);

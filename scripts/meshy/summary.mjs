import { readFile, appendFile } from 'node:fs/promises';
const read=async file=>{try{return JSON.parse(await readFile(`work/meshy/${file}.json`,'utf8'));}catch{return null;}};
const plan=await read('plan'),state=await read('state'),report=await read('report');
const text=[
  '## Meshy motions',
  `Mode: ${plan?.dryRun?'dry-run (0 Meshy requests)':'generate'}`,
  `Targets: ${(plan?.targets||[]).join(', ')}`,
  `Estimated credits: ${plan?.estimatedCredits??'unavailable'} / limit: ${plan?.maxCredits??0}`,
  `Reserved credits: ${state?.reservedCredits??0}; confirmed consumed credits: ${state?.consumedCredits??0}`,
  `Integrated motions: ${report?.validated?.length??0}`,
  'A reservation with no task ID is uncertain: do not automatically retry the POST.',
  'Download meshy-report for task IDs, source GLBs and validation results. Review the PR before merging; Pages settings are unchanged.',
  'Setup and mobile instructions: docs/MESHY_AUTOMATION.md',
].join('\n\n')+'\n';
if(process.env.GITHUB_STEP_SUMMARY)await appendFile(process.env.GITHUB_STEP_SUMMARY,text);
else console.log(text);

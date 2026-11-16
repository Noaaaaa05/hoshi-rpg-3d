import { readFile,writeFile } from 'node:fs/promises';
import path from 'node:path';
import { approvalReservation } from '../meshy/approval-lock.mjs';
import { generateModels,makePlan } from './production.mjs';
const [batch,reviewFile,approvalFile,output,...args]=process.argv.slice(2);
if(!batch||!reviewFile||!approvalFile||!output||args.length)throw new Error('Run only in an owner-approved Actions job: <approved-bundle> <review.json> <approval.json> <private-output>');
if(process.env.GITHUB_ACTIONS!=='true'||process.env.ASSET_PAID_CONFIRM!=='YES')throw new Error('Paid generation is disabled; obtain explicit approval for these exact assets first');
const [catalog,review,approval]=await Promise.all([path.join(batch,'catalog.json'),reviewFile,approvalFile].map(async f=>JSON.parse(await readFile(f,'utf8'))));
if(approval.id!==process.env.MESHY_APPROVAL_ID)throw new Error('Approval ID mismatch');
const publication=process.env.ASSET_PUBLIC_ARTIFACTS==='YES';
const plan=makePlan(catalog,review,{...approval.selection,publication});
const beforeCharge=approvalReservation(process.env);
try{
  const report=await generateModels({catalog,review,plan,batch,output,approval,apiKey:process.env.MESHY_API_KEY,beforeCharge,publication,resume:process.env.ASSET_RESUME_STATE});
  await writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({completed:Object.keys(report.tasks).length,confirmedCredits:report.confirmedCredits}));
}catch{console.error('Asset generation stopped. Inspect the saved task journal; never automatically repeat an uncertain POST.');process.exitCode=1;}

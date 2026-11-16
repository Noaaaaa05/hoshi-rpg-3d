import { register } from 'node:module';
import { readFile } from 'node:fs/promises';
import { approvalReservation } from './approval-lock.mjs';
// Resolve the exact vendored Three.js, without adding runtime CDN dependencies.
register('../../tests/three-loader.mjs',import.meta.url);
const {runPipeline}=await import('./pipeline.mjs');
const args=process.argv.slice(2),options={};let resume=null;
const envOptions={MESHY_TARGETS:'targets',MESHY_MOTION_MODE:'mode',MESHY_MAX_CREDITS:'maxCredits',MESHY_RIG_TASK_ID:'rigTaskId'};
for(const [env,key] of Object.entries(envOptions))if(process.env[env])options[key]=process.env[env];
try{
  for(let i=0;i<args.length;i++){
    const name=args[i];
    if(name==='--execute'){options.execute=true;continue;}
    if(name==='--dry-run'){options.execute=false;continue;}
    const key={'--targets':'targets','--motion-mode':'mode','--max-credits':'maxCredits','--rig-task-id':'rigTaskId','--resume':'resume'}[name];
    if(!key||!args[i+1]||args[i+1].startsWith('--'))throw new Error('Unknown or incomplete CLI option');
    const value=args[++i];if(key==='resume')resume=value;else options[key]=value;
  }
  if(!resume&&process.env.MESHY_RESUME_STATE)resume=process.env.MESHY_RESUME_STATE;
  const config=JSON.parse(await readFile('config/meshy-motions.json','utf8'));
  const allowPaid=process.env.MESHY_ALLOW_PAID==='YES';
  const beforeCharge=options.execute&&allowPaid?approvalReservation(process.env):undefined;
  const report=await runPipeline({config,options,resume,apiKey:process.env.MESHY_API_KEY,allowPaid,beforeCharge});
  // Print only our allowlisted report, never requests, keys or signed URLs.
  console.log(JSON.stringify(report,null,2));
}catch(error){console.error(`Meshy pipeline stopped: ${error.message}`);process.exitCode=1;}

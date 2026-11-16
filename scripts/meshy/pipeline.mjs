import { readFile, writeFile, mkdir, copyFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { MOTION_STATES } from '../../js/motion-state.js';
import { rigProfile, assertCompatibleRig } from '../../js/motion-library.js';
import { inspectFile, loadGLB, validateMotion, animationPack } from './glb.mjs';

export const API='https://api.meshy.ai/openapi/v1';
const hash=value=>createHash('sha256').update(value).digest('hex');
const id=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,200}$/.test(value);
export function planGeneration(config,{targets=MOTION_STATES,mode='swift',maxCredits=0,rigTaskId=''}={}) {
  if(['swift','prime','animation'].some(k=>!Number.isInteger(config.credits[k])||config.credits[k]<=0))throw new Error('Invalid reviewed pricing');
  if(typeof targets==='string')targets=targets.split(',').map(t=>t.trim());
  if(!targets.length||new Set(targets).size!==targets.length||targets.some(t=>!MOTION_STATES.includes(t)||!config.motions[t]))throw new Error('Invalid or duplicate targets');
  if(!['swift','prime'].includes(mode))throw new Error('Invalid motion mode');
  maxCredits=Number(maxCredits);
  if(!Number.isInteger(maxCredits)||maxCredits<0||maxCredits>config.hardCreditLimit)throw new Error('Credit limit must be an integer within the configured hard limit');
  if(rigTaskId&&!id(rigTaskId))throw new Error('Invalid rig task ID');
  for(const target of targets){
    const m=config.motions[target];
    if(typeof m.prompt!=='string'||!m.prompt.trim()||m.prompt.length>400||!Number.isFinite(m.duration)||m.duration<2||m.duration>10||m.duration*2%1)throw new Error(`Invalid motion configuration: ${target}`);
    if(m.range!==null&&m.range!==undefined&&(!Array.isArray(m.range)||m.range.length!==2||!m.range.every(Number.isFinite)||m.range[0]<0||m.range[1]<=m.range[0]||m.range[1]>m.duration))throw new Error(`Invalid clip range: ${target}`);
  }
  const perMotion=config.credits[mode]+config.credits.animation;
  if(!Number.isInteger(perMotion)||perMotion<=0)throw new Error('Invalid reviewed pricing');
  return {targets,mode,maxCredits,rigTaskId,perMotion,estimatedCredits:perMotion*targets.length,
    pricingReviewed:config.pricingReviewed,missing:rigTaskId?[]:['MESHY_RIG_TASK_ID'],
    requests:targets.flatMap(target=>[{target,endpoint:'/text-to-motion',credits:config.credits[mode],body:{prompt:config.motions[target].prompt,mode,duration:config.motions[target].duration}},
      {target,endpoint:'/animations',credits:config.credits.animation,body:{rig_task_id:rigTaskId||'<required>',motion_task_id:`<${target} motion task>`}}])};
}

export function createClient(apiKey,{fetchImpl=fetch,sleep=ms=>new Promise(r=>setTimeout(r,ms)),pollInterval=5000,maxPolls=240}={}) {
  async function request(endpoint,body){
    let response;
    try {response=await fetchImpl(`${API}${endpoint}`,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${apiKey}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(45000),redirect:'error'});}
    catch{throw new Error(`Meshy ${body?'POST':'GET'} failed (no automatic POST retry; inspect saved task state)`);}
    if(!response.ok)throw new Error(`Meshy HTTP ${response.status}; response body withheld to protect credentials and signed URLs`);
    try{return await response.json();}catch{throw new Error('Meshy returned invalid JSON');}
  }
  return {
    request,
    async poll(endpoint,taskId){
      if(!id(taskId))throw new Error('Invalid task ID in response');
      for(let attempt=0;attempt<maxPolls;attempt++){
        const task=await request(`${endpoint}/${encodeURIComponent(taskId)}`);
        if(task.status==='SUCCEEDED')return task;
        if(['FAILED','CANCELED'].includes(task.status))throw new Error(`Meshy task ${task.status}; see Meshy dashboard for details`);
        if(!['PENDING','IN_PROGRESS'].includes(task.status))throw new Error('Unknown Meshy task status');
        await sleep(pollInterval);
      }
      throw new Error('Meshy polling timed out; resume using the saved task IDs');
    },
    async download(url){
      let parsed;try{parsed=new URL(url);}catch{throw new Error('Missing asset URL');}
      if(parsed.protocol!=='https:'||parsed.username||parsed.password||!(parsed.hostname==='assets.meshy.ai'||parsed.hostname.endsWith('.assets.meshy.ai')))throw new Error('Unexpected Meshy asset host');
      // Never send Authorization to the signed asset download endpoint.
      let response;try{response=await fetchImpl(parsed.href,{signal:AbortSignal.timeout(90000),redirect:'error'});}catch{throw new Error('GLB download failed');}
      if(!response.ok)throw new Error(`GLB download HTTP ${response.status}`);
      if(Number(response.headers.get('content-length'))>25*1024*1024)throw new Error('Generated GLB exceeds 25 MiB');
      const reader=response.body.getReader(),parts=[];let length=0;
      try{while(true){const {value,done}=await reader.read();if(done)break;length+=value.byteLength;if(length>25*1024*1024)throw new Error('Generated GLB exceeds 25 MiB');parts.push(Buffer.from(value));}}
      finally{await reader.cancel().catch(()=>{});}
      return Buffer.concat(parts);
    }
  };
}

export async function runPipeline({root=process.cwd(),config,options={},apiKey='',allowPaid=false,client,outputDir='work/meshy',resume=null,beforeCharge}={}) {
  const plan=planGeneration(config,options),out=path.resolve(root,outputDir);
  await mkdir(out,{recursive:true});
  const inspection=await Promise.all(['assets/models/hero.glb',config.baseModel].map(file=>inspectFile(path.join(root,file))));
  const baseBytes=await readFile(path.join(root,config.baseModel));
  // Reviewing clip selection/ranges must not recreate already-paid source tasks.
  const generation=Object.fromEntries(plan.targets.map(name=>[name,{prompt:config.motions[name].prompt,duration:config.motions[name].duration}]));
  const fingerprint=hash(JSON.stringify({targets:plan.targets,mode:plan.mode,rigTaskId:plan.rigTaskId,generation,credits:config.credits,hero:hash(baseBytes)}));
  await writeFile(path.join(out,'plan.json'),JSON.stringify({dryRun:!options.execute,...plan,inspection,baseSHA256:hash(baseBytes)},null,2)+'\n');
  if(!options.execute)return {dryRun:true,networkRequests:0,...plan,inspection};
  if(!allowPaid||!apiKey||!plan.rigTaskId)throw new Error('Paid mode requires explicit consent, MESHY_API_KEY and an API rig task ID');
  if(plan.estimatedCredits>plan.maxCredits)throw new Error(`Planned ${plan.estimatedCredits} credits exceeds limit ${plan.maxCredits}`);
  const state=resume?JSON.parse(await readFile(resume,'utf8')):{schemaVersion:1,fingerprint,reservedCredits:0,consumedCredits:0,tasks:{}};
  if(state.fingerprint!==fingerprint||!Number.isInteger(state.reservedCredits)||state.reservedCredits<0||!Number.isFinite(state.consumedCredits)||state.reservedCredits>plan.maxCredits)throw new Error('Resume state does not match this plan/budget');
  const save=async()=>{await writeFile(path.join(out,'state.tmp'),JSON.stringify(state,null,2)+'\n');await rename(path.join(out,'state.tmp'),path.join(out,'state.json'));};
  await save();
  client ||= createClient(apiKey);
  // This read-only preflight happens before the first credit-consuming POST.
  const rig=await client.request(`/rigging/${encodeURIComponent(plan.rigTaskId)}`);
  if(rig.status!=='SUCCEEDED')throw new Error('API rig task is not SUCCEEDED');
  const rigBytes=await client.download(rig.result?.rigged_character_glb_url);
  assertCompatibleRig(await rigProfile(await loadGLB(baseBytes)),await rigProfile(await loadGLB(rigBytes)));
  let approvalReserved=false;
  async function task(key,endpoint,body,cost){
    let record=state.tasks[key];
    if(record?.uncertain&&!record.id)throw new Error('A POST has an uncertain outcome; reconcile it with Meshy before starting another paid run');
    if(!record){
      if(state.reservedCredits+cost>plan.maxCredits)throw new Error('Credit reservation would exceed the limit');
      if(beforeCharge&&!approvalReserved){await beforeCharge();approvalReserved=true;}
      state.reservedCredits+=cost;record=state.tasks[key]={endpoint,reserved:cost,uncertain:true};await save();
      const created=await client.request(endpoint,body);
      if(!id(created.result))throw new Error('No valid task ID returned; do not automatically repeat this POST');
      record.id=created.result;record.uncertain=false;await save();
    }
    if(record.endpoint!==endpoint||!id(record.id))throw new Error('Invalid saved task');
    const result=await client.poll(endpoint,record.id);
    const consumed=result.consumed_credits;
    if(!Number.isInteger(consumed)||consumed<0)throw new Error('Missing actual credit usage; stop before creating another task');
    record.consumedCredits=consumed;record.status='SUCCEEDED';
    state.consumedCredits=Object.values(state.tasks).reduce((n,t)=>n+(t.consumedCredits||0),0);await save();
    if(consumed>record.reserved||state.consumedCredits>plan.maxCredits)throw new Error('Actual pricing exceeds reviewed pricing; further tasks stopped (already incurred charges cannot be undone)');
    return result;
  }
  const entries={},validated=[];
  for(const target of plan.targets){
    const spec=config.motions[target];
    await task(`${target}:motion`,'/text-to-motion',{prompt:spec.prompt,mode:plan.mode,duration:spec.duration},config.credits[plan.mode]);
    const animation=await task(`${target}:animation`,'/animations',{rig_task_id:plan.rigTaskId,motion_task_id:state.tasks[`${target}:motion`].id},config.credits.animation);
    const bytes=await client.download(animation.result?.animation_glb_url);
    await writeFile(path.join(out,`${target}-source.glb`),bytes);
    // Candidate remains available for reviewing ranges even if integration fails.
    const info=await validateMotion(baseBytes,bytes,target,spec,config);
    const pack=animationPack(bytes,info.sourceClip,info.clip),filename=`${target}-${hash(pack).slice(0,12)}.glb`;
    if(pack.length>2*1024*1024)throw new Error('Animation-only pack exceeds the runtime 2 MiB limit');
    await writeFile(path.join(out,filename),pack);validated.push({target,filename,info});
    entries[target]={url:`./motions/${filename}`,clip:info.clip,range:spec.range||null,sha256:hash(pack)};
  }
  // No game files change until every selected motion passes all gates.
  const manifestPath=path.join(root,config.manifest),manifest=JSON.parse(await readFile(manifestPath,'utf8'));
  if(!manifest.player||path.resolve(root,'assets/models',manifest.player.url)!==path.resolve(root,config.baseModel))throw new Error('The active hero changed; refusing integration');
  await mkdir(path.join(root,'assets/models/motions'),{recursive:true});
  for(const {filename} of validated)await copyFile(path.join(out,filename),path.join(root,'assets/models/motions',filename));
  manifest.player.motionLibrary={...manifest.player.motionLibrary,...entries};
  await writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n');
  const report={dryRun:false,targets:plan.targets,reservedCredits:state.reservedCredits,consumedCredits:state.consumedCredits,validated};
  await writeFile(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');
  return report;
}

import { readFile,writeFile,mkdir,realpath,rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { createClient } from '../meshy/pipeline.mjs';
import { readGLB } from '../meshy/glb.mjs';

export const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export const TYPES=['character','monster','weapon','armor','building','nature','magic','unknown'];
const idPattern=/^asset-[a-f0-9]{20}$/;
const digest=/^[a-f0-9]{64}$/;
export const MODEL_REQUEST={model_type:'smart-topology',ai_model:'meshy-t2.5',target_polycount:12000,topology:'triangle',should_texture:true,texture_model:'meshy-n1',texture_resolution:'2k',enable_pbr:false,target_formats:['glb']};
export const PRICING={reviewed:'2026-11-17',imageTo3D:15,rigging:5,presetMotion:3,reference:'https://docs.meshy.ai/en/api/pricing'};

export function validateBatch(catalog){
  if(catalog?.version!==1||catalog.private!==true||!digest.test(catalog.fingerprint||'')||!Array.isArray(catalog.assets)||catalog.assets.length>10000||!Array.isArray(catalog.sources))throw new Error('Invalid private batch catalog');
  const ids=new Set(),sources=new Map(catalog.sources.map(s=>[s.id,s]));
  for(const a of catalog.assets){
    if(!idPattern.test(a.id)||ids.has(a.id)||!sources.has(a.source_id)||!TYPES.includes(a.category)||!digest.test(a.png_sha256)||a.png!==`crops/${a.id}.png`||!Array.isArray(a.flags)||!Array.isArray(a.bbox)||a.bbox.length!==4||!a.bbox.every(Number.isInteger))throw new Error('Invalid asset provenance or path');
    ids.add(a.id);
  }
  return catalog;
}

export function assess(asset,review={},source,publication=false){
  const record=review.assets?.[asset.id],issues=[];
  if(!record||record.png_sha256!==asset.png_sha256)issues.push('review_missing_or_stale');
  if(record?.bbox&&JSON.stringify(record.bbox)!==JSON.stringify(asset.bbox))issues.push('crop_correction_not_rendered');
  if(record?.quality!=='approved'||asset.quality==='failed'||asset.flags.includes('empty_cell'))issues.push('quality_not_approved');
  if(source?.watermark||asset.flags.includes('watermark_present'))issues.push('watermark_blocked');
  const rights=record?.rights;
  if(rights?.status!=='cleared'||typeof rights.evidence!=='string'||!rights.evidence.trim()||typeof rights.reviewer!=='string'||!rights.reviewer.trim()||rights.allow_3d!==true)issues.push('rights_or_3d_permission_missing');
  if(publication&&rights?.allow_publication!==true)issues.push('publication_permission_missing');
  const category=record?.category||asset.category;
  if(!TYPES.includes(category))issues.push('invalid_category');
  if(['magic','unknown'].includes(category))issues.push(category==='magic'?'use_2d_or_particles':'classification_required');
  if(asset.width<32||asset.height<32)issues.push('below_meshy_input_minimum');
  return {category,name:record?.name||asset.name,issues,ready:issues.length===0};
}

export function makePlan(catalog,review={},{limit=16,offset=0,assetIds=null,publication=false}={}){
  validateBatch(catalog);
  if(!Number.isInteger(limit)||limit<10||limit>20)throw new Error('Pilot selection must contain at most 10–20 proposed assets');
  if(!Number.isInteger(offset)||offset<0||offset>10000)throw new Error('Invalid batch offset');
  if(assetIds!==null&&(!Array.isArray(assetIds)||!assetIds.length||assetIds.length>20||new Set(assetIds).size!==assetIds.length||assetIds.some(id=>!catalog.assets.some(a=>a.id===id))))throw new Error('Invalid exact asset selection');
  if(review.catalog_fingerprint&&review.catalog_fingerprint!==catalog.fingerprint)throw new Error('Review belongs to a different batch');
  if(Object.keys(review.assets||{}).length&&(review.version!==1||review.catalog_fingerprint!==catalog.fingerprint))throw new Error('A reviewed batch fingerprint is required');
  const sources=new Map(catalog.sources.map(s=>[s.id,s]));
  const pool=catalog.assets.filter(a=>!['magic','unknown'].includes(review.assets?.[a.id]?.category||a.category)&&!a.flags.some(f=>['watermark_present','empty_cell','duplicate_exact','duplicate_possible'].includes(f)))
    .sort((a,b)=>Number(a.flags.includes('low_resolution'))-Number(b.flags.includes('low_resolution')) || Number(a.flags.some(f=>f.startsWith('touches')))-Number(b.flags.some(f=>f.startsWith('touches'))) || b.width*b.height-a.width*a.height || a.id.localeCompare(b.id));
  const ordered=[];
  for(let round=0;ordered.length<pool.length;round++){
    let added=false;
    for(const type of TYPES.filter(t=>!['magic','unknown'].includes(t))){
      const asset=pool.filter(a=>(review.assets?.[a.id]?.category||a.category)===type)[round];
      if(asset){ordered.push(asset);added=true;}
    }
    if(!added)break;
  }
  const selected=assetIds?assetIds.map(id=>catalog.assets.find(a=>a.id===id)):ordered.slice(offset,offset+limit);
  const entries=selected.map(asset=>{
    const assessment=assess(asset,review,sources.get(asset.source_id),publication),type=assessment.category;
    return {id:asset.id,png_sha256:asset.png_sha256,...assessment,
      stages:[{type:'image-to-3d',status:assessment.ready?'awaiting_paid_approval':'blocked',credits:PRICING.imageTo3D},
        {type:'mobile-budget-validation',status:'waiting'},
        ...(type==='character'?[{type:'rigging',status:'separate_approval_required',anatomy:'biped',credits:PRICING.rigging},{type:'motions',status:'separate_approval_required',suggested:['Idle','Walk','Run','Talk'],creditsPerPreset:PRICING.presetMotion}]:
          type==='monster'?[{type:'anatomy-review',status:'required',note:'Do not assume a biped. Confirm humanoid/quadruped/other before rigging and motion planning.'}]:
          type==='armor'?[{type:'attachment-or-skin-fit',status:'manual_review_required'}]:[]),
        {type:'3d-visual-and-rights-review',status:'required'},{type:'catalog-request',status:'blocked_until_complete'}]};
  });
  const plan={version:1,catalogFingerprint:catalog.fingerprint,selection:{limit,offset,assetIds},modelRequest:MODEL_REQUEST,pricing:PRICING,entries,
    proposedCount:entries.length,readyCount:entries.filter(e=>e.ready).length,estimatedCreditsIfAllApproved:entries.length*PRICING.imageTo3D,
    payableCredits:entries.filter(e=>e.ready).length*PRICING.imageTo3D,
    effectRoute:{count:catalog.assets.filter(a=>a.category==='magic').length,method:'Review licensed PNGs for sprite atlas / THREE.Sprite / additive particles; do not default to 3D generation.'},
    networkRequests:0,paidApproved:false,publication};
  return {...plan,sha256:hash(JSON.stringify(plan))};
}

export async function localAsset(batch,asset){
  const root=await realpath(batch),file=await realpath(path.join(root,asset.png));
  if(!file.startsWith(root+path.sep))throw new Error('Asset symlink leaves the batch');
  const bytes=await readFile(file);
  if(bytes.length>20*1024*1024||hash(bytes)!==asset.png_sha256||!bytes.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')))throw new Error('PNG bytes do not match the reviewed asset');
  if(bytes.length<24||bytes.readUInt32BE(16)!==asset.width||bytes.readUInt32BE(20)!==asset.height)throw new Error('PNG dimensions differ');
  return bytes;
}
async function persist(file,value){await writeFile(file+'.tmp',JSON.stringify(value,null,2)+'\n');await rename(file+'.tmp',file);}

export async function generateModels({catalog,review,plan,batch,output,approval,client,beforeCharge,apiKey,resume,publication=false}={}){
  if(!client&&(!apiKey||typeof apiKey!=='string'))throw new Error('API key is unavailable');
  const recomputed=makePlan(catalog,review,{...plan.selection,publication});
  if(recomputed.sha256!==plan.sha256)throw new Error('Plan changed after review');
  const ready=plan.entries.filter(e=>e.ready);
  if(!ready.length)throw new Error('No rights-cleared and quality-approved assets');
  if(approval?.operation!=='image-to-3d'||approval.plan_sha256!==plan.sha256||!Array.isArray(approval.asset_ids)||JSON.stringify(approval.asset_ids)!==JSON.stringify(ready.map(e=>e.id))||approval.request_count!==ready.length||!Number.isSafeInteger(approval.max_credits)||approval.max_credits<plan.payableCredits||!beforeCharge)throw new Error('Explicit approval must match operation, exact IDs, request count and credit ceiling');
  const images=new Map();
  for(const entry of ready){const asset=catalog.assets.find(a=>a.id===entry.id);images.set(entry.id,await localAsset(batch,asset));}
  await mkdir(output,{recursive:true});
  if(!resume){
    try{await readFile(path.join(output,'state.json'));throw new Error('Existing generation journal: resume it or choose a new output directory');}
    catch(error){if(error.code!=='ENOENT')throw error;}
  }
  const state=resume?JSON.parse(await readFile(resume,'utf8')):{version:1,plan_sha256:plan.sha256,approval_id:approval.id,tasks:{},reservedCredits:0,confirmedCredits:0};
  if(state.plan_sha256!==plan.sha256||state.approval_id!==approval.id||!Number.isInteger(state.reservedCredits)||state.reservedCredits<0||state.reservedCredits>approval.max_credits)throw new Error('Saved generation state does not match approval');
  const save=()=>persist(path.join(output,'state.json'),state);
  await save();
  client ||= createClient(apiKey);
  let reserved=false;
  for(const entry of ready){
    let task=state.tasks[entry.id];
    if(task?.uncertain&&!task.id)throw new Error('Uncertain paid POST: reconcile with Meshy; do not retry');
    if(!task){
      if(resume)throw new Error('Resume is GET-only; remaining submissions require a new scoped approval');
      if(state.reservedCredits+PRICING.imageTo3D>approval.max_credits)throw new Error('Credit ceiling reached');
      if(!reserved){await beforeCharge();reserved=true;}
      task=state.tasks[entry.id]={uncertain:true,reserved:PRICING.imageTo3D};state.reservedCredits+=PRICING.imageTo3D;await save();
      const body={...MODEL_REQUEST,image_url:'data:image/png;base64,'+images.get(entry.id).toString('base64')};
      if(entry.category==='character')body.pose_mode='a-pose';
      const created=await client.request('/image-to-3d',body);
      if(!/^[a-zA-Z0-9_-]{1,200}$/.test(created.result||''))throw new Error('POST returned no task ID; do not retry');
      task.id=created.result;task.uncertain=false;await save();
    }
    const result=await client.poll('/image-to-3d',task.id);
    if(!Number.isInteger(result.consumed_credits)||result.consumed_credits<0)throw new Error('Missing credit usage; stop further submissions');
    task.consumedCredits=result.consumed_credits;
    state.confirmedCredits=Object.values(state.tasks).reduce((n,t)=>n+(t.consumedCredits||0),0);await save();
    if(task.consumedCredits>task.reserved||state.confirmedCredits>approval.max_credits)throw new Error('Actual price exceeds approved estimate; no more submissions (existing charges cannot be reversed)');
    const bytes=await client.download((result.model_urls||result.result?.model_urls)?.glb);
    readGLB(bytes);
    const file=`${entry.id}.glb`;await writeFile(path.join(output,file),bytes);
    task.status='model_received_pending_3d_review';task.file=file;task.sha256=hash(bytes);await save();
  }
  return {plan_sha256:plan.sha256,reservedCredits:state.reservedCredits,confirmedCredits:state.confirmedCredits,tasks:state.tasks};
}

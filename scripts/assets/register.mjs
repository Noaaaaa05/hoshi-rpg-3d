// Stage a finished, licensed GLB through the existing RPG inspector/request flow.
// No placements, runtime code changes, or placeholder primitives are generated.
import { readFile,writeFile,mkdir,copyFile,mkdtemp,rm,realpath,stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL,fileURLToPath } from 'node:url';
import { hash,validateBatch,assess } from './production.mjs';
import { inspectAsset } from '../rpg/asset.mjs';
import { readGLB } from '../meshy/glb.mjs';
const implementationRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');

export async function stageAsset({root=process.cwd(),catalog,review,assetId,glb,output,stage=false,apply=false}={}){
  validateBatch(catalog);
  if(review?.version!==1||review.catalog_fingerprint!==catalog.fingerprint)throw new Error('Reviewed batch required');
  const asset=catalog.assets.find(a=>a.id===assetId);
  if(!asset)throw new Error('Unknown asset ID');
  const status=assess(asset,review,catalog.sources.find(s=>s.id===asset.source_id),true);
  if(!status.ready)throw new Error('Asset is quarantined: '+status.issues.join(', '));
  if((await stat(glb)).size>5*1024*1024)throw new Error('GLB exceeds mobile byte budget');
  const bytes=await readFile(glb),checksum=hash(bytes),modelReview=review.assets[assetId].model;
  if(modelReview?.approved!==true||modelReview.sha256!==checksum||!modelReview.reviewer?.trim()||!modelReview.notes?.trim())throw new Error('Finished 3D model needs a review tied to its exact SHA-256');
  const {json}=readGLB(bytes);
  if(!json.images?.length||!json.materials?.length)throw new Error('New game assets must be textured 3D models');
  if(!json.meshes?.some(m=>m.primitives?.some(p=>p.attributes?.TEXCOORD_0!==undefined&&json.materials[p.material]?.pbrMetallicRoughness?.baseColorTexture)))throw new Error('A textured primitive with UV coordinates is required');
  if(['character','monster'].includes(status.category)&&(!json.skins?.length||!json.animations?.length||modelReview.motion_ready!==true))throw new Error('Character/monster rig and motions are not ready');
  if(status.category==='armor'&&modelReview.attachment_ready!==true)throw new Error('Armor attachment/skinning review is required');
  if(!Number.isFinite(modelReview.height)||modelReview.height<.25||modelReview.height>12)throw new Error('Reviewed game height is required');
  const relative=`models/bulk/${assetId}.glb`,catalogPath='assets/rpg/catalog.json',base=JSON.parse(await readFile(path.join(root,catalogPath),'utf8'));
  const scratch=await mkdtemp(path.join(tmpdir(),'hoshi-register-'));
  let report;
  try{
    await mkdir(path.join(scratch,'assets/rpg'),{recursive:true});await mkdir(path.join(scratch,'assets/models/bulk'),{recursive:true});
    await writeFile(path.join(scratch,catalogPath),JSON.stringify(base));
    const assetRoot=await realpath(path.join(root,'assets'));
    for(const spec of [...Object.values(base.models),...Object.values(base.motions)])if(spec.file){
      const from=await realpath(path.join(assetRoot,spec.file));if(!from.startsWith(assetRoot+path.sep))throw new Error('Existing asset leaves the asset root');
      const to=path.join(scratch,'assets',spec.file);await mkdir(path.dirname(to),{recursive:true});await copyFile(from,to);
    }
    await writeFile(path.join(scratch,'assets',relative),bytes);
    report=await inspectAsset({root:scratch,file:path.join(scratch,'assets',relative),id:assetId});
    if(report.problems.length)throw new Error(report.problems.join('; '));
    const model=report.request.changes.find(c=>c.type==='models');model.value.height=modelReview.height;
    if(modelReview.rotationY!==undefined)model.value.rotationY=modelReview.rotationY;
    // Validate the exact edited request through the same catalog command used by CI.
    const requestFile=path.join(scratch,'request.json');await writeFile(requestFile,JSON.stringify(report.request));
    const result=spawnSync(process.execPath,['--import',path.join(implementationRoot,'tests/register-three.mjs'),path.join(implementationRoot,'scripts/rpg/catalog.mjs'),'apply',requestFile],{cwd:scratch,encoding:'utf8'});
    if(result.status!==0)throw new Error('RPG catalog request validation failed');
  }finally{await rm(scratch,{recursive:true,force:true});}
  if(apply&&!stage)throw new Error('Applying requires explicit staging');
  await mkdir(output,{recursive:true});
  const requestFile=path.join(output,`register-${assetId}.json`);await writeFile(requestFile,JSON.stringify(report.request,null,2)+'\n');
  if(stage){
    const target=path.join(root,'assets',relative);await mkdir(path.dirname(target),{recursive:true});
    // Never overwrite an existing model with different bytes.
    try{if(hash(await readFile(target))!==checksum)throw new Error('Target GLB already exists with different bytes');}
    catch(error){if(error.code!=='ENOENT')throw error;await writeFile(target,bytes,{flag:'wx'});}
    if(apply){
      const result=spawnSync(process.execPath,['--import',path.join(implementationRoot,'tests/register-three.mjs'),path.join(implementationRoot,'scripts/rpg/catalog.mjs'),'apply',requestFile,'--write'],{cwd:root,encoding:'utf8'});
      if(result.status!==0)throw new Error('Catalog apply stopped; keep the staged model on the review branch');
    }
  }
  return {id:assetId,sha256:checksum,request:report.request,staged:stage,applied:apply,placementsAdded:0};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const [batch,reviewFile,assetId,glb,...flags]=process.argv.slice(2);
  if(!batch||!reviewFile||!assetId||!glb||flags.some(f=>!['--stage','--apply'].includes(f)))throw new Error('Usage: npm run assets:register -- <batch> <review.json> <asset-ID> <finished.glb> [--stage] [--apply]');
  const [catalog,review]=await Promise.all([path.join(batch,'catalog.json'),reviewFile].map(async f=>JSON.parse(await readFile(f,'utf8'))));
  console.log(JSON.stringify(await stageAsset({catalog,review,assetId,glb,output:path.join(batch,'requests'),stage:flags.includes('--stage'),apply:flags.includes('--apply')}),null,2));
}

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile,writeFile,mkdir,mkdtemp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { makePlan,assess,hash,generateModels,localAsset,PRICING } from '../scripts/assets/production.mjs';
import { stageAsset } from '../scripts/assets/register.mjs';
import { emptyCatalog } from '../js/rpg-content.js';
import { writeGLB } from '../scripts/meshy/glb.mjs';

function png(width,height){
  function chunk(name,data){const type=Buffer.from(name),bytes=Buffer.concat([type,data]);let crc=0xffffffff;for(const byte of bytes){crc^=byte;for(let n=0;n<8;n++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}const header=Buffer.alloc(4),tail=Buffer.alloc(4);header.writeUInt32BE(data.length);tail.writeUInt32BE((crc^0xffffffff)>>>0);return Buffer.concat([header,bytes,tail]);}
  const head=Buffer.alloc(13);head.writeUInt32BE(width);head.writeUInt32BE(height,4);head[8]=8;head[9]=6;
  const rows=Buffer.alloc((width*4+1)*height);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const p=y*(width*4+1)+1+x*4;rows[p]=100+x;rows[p+1]=70+y;rows[p+2]=20;rows[p+3]=255;}
  return Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),chunk('IHDR',head),chunk('IDAT',deflateSync(rows)),chunk('IEND',Buffer.alloc(0))]);
}
function model(textured=true){
  const positions=Buffer.from(new Float32Array([0,0,0,1,0,0,0,1,0]).buffer),uv=Buffer.from(new Float32Array([0,0,1,0,0,1]).buffer),image=png(1,1),bin=Buffer.concat([positions,uv,image]);
  return writeGLB({asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{name:'SyntheticModel',mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0,TEXCOORD_0:1},...(textured?{material:0}:{})}]}],
    buffers:[{byteLength:bin.length}],bufferViews:[{buffer:0,byteOffset:0,byteLength:positions.length},{buffer:0,byteOffset:positions.length,byteLength:uv.length},{buffer:0,byteOffset:positions.length+uv.length,byteLength:image.length}],
    accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[0,0,0],max:[1,1,0]},{bufferView:1,componentType:5126,count:3,type:'VEC2'}],
    ...(textured?{images:[{bufferView:2,mimeType:'image/png'}],textures:[{source:0}],materials:[{pbrMetallicRoughness:{baseColorTexture:{index:0}}}]}:{})},bin);
}
async function fixture(t,{clear=false}={}){
  const root=await mkdtemp(path.join(tmpdir(),'hoshi-bulk-'));t.after(()=>rm(root,{recursive:true,force:true}));const batch=path.join(root,'private');await mkdir(path.join(batch,'crops'),{recursive:true});
  const bytes=png(64,64),catalog={version:1,private:true,fingerprint:hash('synthetic-fixture'),sources:[{id:'synthetic',name:'Our own synthetic shapes',watermark:false}],assets:[]},review={version:1,catalog_fingerprint:catalog.fingerprint,assets:{}};
  const types=['character','monster','weapon','armor','building','nature'];
  for(let n=0;n<24;n++){
    const id='asset-'+n.toString(16).padStart(20,'0'),asset={id,name:'Synthetic '+n,source_id:'synthetic',category:types[n%6],bbox:[0,0,64,64],width:64,height:64,png:`crops/${id}.png`,png_sha256:hash(bytes),flags:[],quality:'needs_review'};
    catalog.assets.push(asset);await writeFile(path.join(batch,asset.png),bytes);
    if(clear)review.assets[id]={png_sha256:asset.png_sha256,bbox:asset.bbox,quality:'approved',category:asset.category,rights:{status:'cleared',evidence:'Created by this test suite',reviewer:'test',allow_3d:true,allow_publication:true}};
  }
  return {root,batch,catalog,review};
}
function approval(plan){return {id:'synthetic-approval-0001',operation:'image-to-3d',plan_sha256:plan.sha256,asset_ids:plan.entries.filter(e=>e.ready).map(e=>e.id),request_count:plan.readyCount,max_credits:plan.payableCredits};}
function client({fail=false,consumed=15}={}){
  const calls=[];return {calls,async request(endpoint,body){calls.push({endpoint,body});if(fail)throw new Error('uncertain POST');return {result:'synthetic-task-'+calls.length};},async poll(){return {consumed_credits:consumed,model_urls:{glb:'https://assets.meshy.ai/synthetic.glb'}};},async download(){return model();}};
}
test('pilot selects 16 diverse candidates but unknown rights remain quarantined, with zero network calls',async t=>{
  const {catalog,review}=await fixture(t),before=structuredClone(catalog),plan=makePlan(catalog,review);
  assert.equal(plan.proposedCount,16);assert.equal(plan.readyCount,0);assert.equal(plan.estimatedCreditsIfAllApproved,240);assert.equal(plan.networkRequests,0);
  assert.equal(new Set(plan.entries.map(e=>e.category)).size,5);assert.deepEqual(catalog,before);
  assert.ok(plan.entries.find(e=>e.category==='monster').stages.some(s=>s.type==='anatomy-review'));
  assert.ok(plan.entries.find(e=>e.category==='character').stages.some(s=>s.type==='rigging'&&s.status==='separate_approval_required'));
  const next=makePlan(catalog,review,{offset:16});assert.equal(next.proposedCount,4);assert.ok(!next.entries.some(e=>plan.entries.some(p=>p.id===e.id)));
  assert.throws(()=>makePlan(catalog,review,{limit:21}));assert.throws(()=>makePlan(catalog,{...review,catalog_fingerprint:'0'.repeat(64)}));
});
test('magic uses a 2D route; watermarks, stale reviews, corrections and unlicensed publication cannot pass',async t=>{
  const {catalog,review}=await fixture(t,{clear:true}),a=catalog.assets[0],source=catalog.sources[0];
  assert.equal(assess(a,review,source,true).ready,true);
  assert.ok(assess(a,review,{...source,watermark:true}).issues.includes('watermark_blocked'));
  review.assets[a.id].png_sha256='0'.repeat(64);assert.equal(assess(a,review,source).ready,false);review.assets[a.id].png_sha256=a.png_sha256;
  review.assets[a.id].bbox=[1,0,64,64];assert.ok(assess(a,review,source).issues.includes('crop_correction_not_rendered'));review.assets[a.id].bbox=a.bbox;
  review.assets[a.id].rights.allow_publication=false;assert.equal(assess(a,review,source,true).ready,false);assert.equal(assess(a,review,source,false).ready,true);
  a.category='magic';review.assets[a.id].category='magic';assert.ok(!makePlan(catalog,review).entries.some(e=>e.id===a.id));assert.equal(makePlan(catalog,review).effectRoute.count,1);
});
test('exact paid approval is required before reservation, upload or network calls',async t=>{
  const f=await fixture(t,{clear:true}),plan=makePlan(f.catalog,f.review),api=client();let reserved=0;
  for(const changed of [{max_credits:plan.payableCredits-1},{request_count:1},{operation:'rigging'},{plan_sha256:'0'.repeat(64)},{asset_ids:[]}]){
    await assert.rejects(generateModels({...f,plan,approval:{...approval(plan),...changed},output:path.join(f.root,'models'),client:api,beforeCharge:async()=>reserved++}),/approval/);
  }
  assert.equal(reserved,0);assert.equal(api.calls.length,0);
  const altered=structuredClone(plan);altered.entries[0].png_sha256='0'.repeat(64);
  await assert.rejects(generateModels({...f,plan:altered,approval:approval(plan),output:path.join(f.root,'models'),client:api,beforeCharge:async()=>reserved++}),/Plan changed/);
  assert.equal(reserved,0);assert.equal(api.calls.length,0);
});
test('mocked model production reserves once, saves GLBs privately and never includes images or signed URLs in the journal',async t=>{
  const f=await fixture(t,{clear:true}),plan=makePlan(f.catalog,f.review),api=client();let reserved=0;
  const output=path.join(f.root,'models'),report=await generateModels({...f,plan,approval:approval(plan),output,client:api,beforeCharge:async()=>reserved++});
  assert.equal(reserved,1);assert.equal(api.calls.length,16);assert.equal(report.confirmedCredits,240);
  assert.ok(api.calls.every(c=>c.endpoint==='/image-to-3d'&&c.body.target_formats[0]==='glb'&&c.body.image_url.startsWith('data:image/png;base64,')));
  assert.ok(Object.values(report.tasks).every(s=>s.status==='model_received_pending_3d_review'));
  const journal=await readFile(path.join(output,'state.json'),'utf8');assert.ok(!/data:image|https:|Bearer/.test(journal));
  const recovery=client();
  const recovered=await generateModels({...f,plan,approval:approval(plan),output,client:recovery,beforeCharge:async()=>reserved++,resume:path.join(output,'state.json')});
  assert.equal(recovery.calls.length,0);assert.equal(reserved,1);assert.equal(recovered.confirmedCredits,240);
  await assert.rejects(generateModels({...f,plan,approval:approval(plan),output,client:recovery,beforeCharge:async()=>reserved++}),/Existing generation journal/);
});
test('ambiguous paid submissions cannot be repeated, and changed PNGs stop before approval reservation',async t=>{
  const f=await fixture(t,{clear:true}),plan=makePlan(f.catalog,f.review),output=path.join(f.root,'models');
  await assert.rejects(generateModels({...f,plan,approval:approval(plan),output,client:client({fail:true}),beforeCharge:async()=>{}}),/uncertain/);
  const api=client();await assert.rejects(generateModels({...f,plan,approval:approval(plan),output,client:api,beforeCharge:async()=>{},resume:path.join(output,'state.json')}),/Uncertain/);assert.equal(api.calls.length,0);
  const asset=f.catalog.assets.find(a=>a.id===plan.entries[0].id);await writeFile(path.join(f.batch,asset.png),png(32,32));
  let reserved=0;await assert.rejects(generateModels({...f,plan,approval:approval(plan),output,client:api,beforeCharge:async()=>reserved++}),/PNG/);assert.equal(reserved,0);
});
test('unexpected pricing stops further submissions after recording actual spend',async t=>{
  const f=await fixture(t,{clear:true}),plan=makePlan(f.catalog,f.review),api=client({consumed:16});
  await assert.rejects(generateModels({...f,plan,approval:approval(plan),output:path.join(f.root,'models'),client:api,beforeCharge:async()=>{}}),/price/);assert.equal(api.calls.length,1);
});
test('batch provenance rejects path traversal and symlinks before reading unreviewed files',async t=>{
  const f=await fixture(t),a=f.catalog.assets[0];a.png='../private.png';assert.throws(()=>makePlan(f.catalog,f.review),/path/);
  a.png=`crops/${a.id}.png`;await writeFile(path.join(f.batch,a.png),Buffer.from('not a PNG'));await assert.rejects(localAsset(f.batch,a),/PNG/);
});
test('finished model registration is a dry-run request by default, uses the existing catalog gates and adds no placements',async t=>{
  const f=await fixture(t,{clear:true}),asset=f.catalog.assets.find(a=>a.category==='building'),bytes=model(),glb=path.join(f.root,'model.glb');await writeFile(glb,bytes);
  await mkdir(path.join(f.root,'assets/rpg'),{recursive:true});await writeFile(path.join(f.root,'assets/rpg/catalog.json'),JSON.stringify(emptyCatalog()));
  const params={...f,assetId:asset.id,glb,output:path.join(f.root,'requests')};
  await assert.rejects(stageAsset(params),/Finished 3D model/);
  f.review.assets[asset.id].model={approved:true,sha256:hash(bytes),reviewer:'test',notes:'Our own synthetic textured test model',height:1};
  const report=await stageAsset(params);assert.equal(report.staged,false);assert.equal(report.applied,false);assert.equal(report.placementsAdded,0);assert.equal(report.request.changes[0].type,'models');
  const after=JSON.parse(await readFile(path.join(f.root,'assets/rpg/catalog.json'),'utf8'));assert.equal(Object.keys(after.models).length,0);
  const staged=await stageAsset({...params,stage:true,apply:true});assert.equal(staged.applied,true);
  const next=JSON.parse(await readFile(path.join(f.root,'assets/rpg/catalog.json'),'utf8'));assert.ok(next.models[asset.id]);assert.equal(Object.keys(next.placements).length,0);
  await writeFile(glb,model(false));f.review.assets[asset.id].model.sha256=hash(model(false));await assert.rejects(stageAsset(params),/textured/);
});

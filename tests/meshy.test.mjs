import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile,mkdir,mkdtemp,cp,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import * as THREE from '../vendor/three/three.module.js';
import path from 'node:path';
import { planGeneration,runPipeline,createClient } from '../scripts/meshy/pipeline.mjs';
import { loadGLB,readGLB,writeGLB,animationPack,validateMotion } from '../scripts/meshy/glb.mjs';
import { rigProfile,assertCompatibleRig,prepareMotion } from '../js/motion-library.js';
import { MOTION_STATES,ROLL_DURATION,selectDodge } from '../js/motion-state.js';
import { attachSword,createFootGrounding,createPlayerAnimator,prepareModel } from '../js/model-utils.js';
import { PlayerMotor,CollisionGrid } from '../js/physics.js';
import { CombatSystem } from '../js/combat.js';

const originalConfig=JSON.parse(await readFile('config/meshy-motions.json','utf8'));
const baseBytes=await readFile('assets/models/hero_animated.glb');
async function workspace(t){
  const root=await mkdtemp(path.join(tmpdir(),'hoshi-meshy-'));t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(path.join(root,'assets/models'),{recursive:true});
  for(const name of ['hero.glb','hero_animated.glb','manifest.json'])await cp(`assets/models/${name}`,path.join(root,'assets/models',name));
  return root;
}
function fixtureConfig(){
  const config=structuredClone(originalConfig);
  // Existing Idle is a deterministic pipeline fixture, not a generated dodge.
  for(const name of MOTION_STATES)Object.assign(config.motions[name],{clip:'Idle_03',range:[0,name==='land'?.3:.5]});
  return config;
}
function fakeClient({rigBytes=baseBytes,failPost=false,failPoll=false}={}){
  const calls=[];let serial=0;
  return {calls,
    async request(endpoint,body){calls.push({endpoint,body});if(!body)return {status:'SUCCEEDED',result:{rigged_character_glb_url:'https://assets.meshy.ai/rig.glb'}};if(failPost)throw new Error('ambiguous network failure');return {result:`task-${++serial}`};},
    async poll(endpoint,id){calls.push({poll:endpoint,id});if(failPoll)throw new Error('poll timed out');return {id,status:'SUCCEEDED',consumed_credits:3,result:{animation_glb_url:'https://assets.meshy.ai/animation.glb'}};},
    async download(url){calls.push({download:true});return url.endsWith('/rig.glb')?rigBytes:baseBytes;}
  };
}
test('dry-run plans five motions, swift/prime costs and validates targets, durations and caps',()=>{
  assert.equal(planGeneration(originalConfig).estimatedCredits,30);
  assert.equal(planGeneration(originalConfig,{mode:'prime'}).estimatedCredits,65);
  assert.equal(planGeneration(originalConfig,{targets:'roll,land'}).requests.length,4);
  for(const options of [{targets:'bad'},{targets:'roll,roll'},{targets:[]},{maxCredits:-1},{maxCredits:101},{maxCredits:'oops'},{rigTaskId:'../key'}])assert.throws(()=>planGeneration(originalConfig,options));
  const config=structuredClone(originalConfig);config.motions.roll.duration=.36;assert.throws(()=>planGeneration(config));
});
test('dry-run with even a supplied key makes zero network calls and never modifies game assets',async t=>{
  const root=await workspace(t),client=fakeClient(),before=await readFile(path.join(root,'assets/models/manifest.json'));
  const report=await runPipeline({root,config:originalConfig,apiKey:'test-key-not-real',allowPaid:true,client});
  assert.equal(report.networkRequests,0);assert.deepEqual(client.calls,[]);assert.equal(report.dryRun,true);
  assert.deepEqual(await readFile(path.join(root,'assets/models/manifest.json')),before);
  assert.ok(!(await readFile(path.join(root,'work/meshy/plan.json'),'utf8')).includes('test-key-not-real'));
});
test('paid consent, key, rig ID and sufficient budget are required before any network call',async t=>{
  const root=await workspace(t);
  for(const value of [{allowPaid:false,apiKey:'test-key',options:{rigTaskId:'rig',maxCredits:30}},
    {allowPaid:true,apiKey:'',options:{rigTaskId:'rig',maxCredits:30}},
    {allowPaid:true,apiKey:'test-key',options:{maxCredits:30}},
    {allowPaid:true,apiKey:'test-key',options:{rigTaskId:'rig',maxCredits:0}}]){
    const client=fakeClient();await assert.rejects(runPipeline({root,config:originalConfig,...value,options:{execute:true,...value.options},client}));assert.deepEqual(client.calls,[]);
  }
});
test('an incompatible API rig is rejected before any paid POST',async t=>{
  const root=await workspace(t),{json,bin}=readGLB(baseBytes);json.nodes[json.skins[0].joints[0]].translation[0]+=.25;
  const client=fakeClient({rigBytes:writeGLB(json,bin)});
  await assert.rejects(runPipeline({root,config:fixtureConfig(),options:{execute:true,rigTaskId:'rig',maxCredits:30},allowPaid:true,apiKey:'test',client}),/一致/);
  assert.equal(client.calls.filter(c=>c.body).length,0);
});
test('mocked end-to-end generation validates five animation-only GLBs without changing the hero mesh',async t=>{
  const root=await workspace(t),client=fakeClient();
  const report=await runPipeline({root,config:fixtureConfig(),options:{execute:true,rigTaskId:'rig',maxCredits:30},allowPaid:true,apiKey:'test',client});
  assert.equal(client.calls.filter(c=>c.body).length,10);assert.equal(report.consumedCredits,30);assert.equal(report.reservedCredits,30);
  assert.equal(report.validated.length,5);assert.deepEqual(await readFile(path.join(root,'assets/models/hero_animated.glb')),baseBytes);
  const manifest=JSON.parse(await readFile(path.join(root,'assets/models/manifest.json'),'utf8'));
  const profile=await rigProfile(await loadGLB(baseBytes));
  for(const target of MOTION_STATES){
    const entry=manifest.player.motionLibrary[target],bytes=await readFile(path.join(root,'assets/models',entry.url));
    const {json}=readGLB(bytes);assert.equal(json.meshes,undefined);assert.equal(json.images,undefined);assert.ok(bytes.length<baseBytes.length/2);
    const pack=await loadGLB(bytes);assertCompatibleRig(profile,await rigProfile(pack));
    const hero=await loadGLB(baseBytes),clip=prepareMotion(hero.scene,pack.animations,entry,target);assert.equal(clip.name,`Hoshi_${target}`);
  }
  const state=await readFile(path.join(root,'work/meshy/state.json'),'utf8');assert.ok(!state.includes('https://'));assert.ok(!state.includes('Bearer'));
});
test('an ambiguous POST is journaled and resume does not repeat a possibly charged request',async t=>{
  const root=await workspace(t),config=fixtureConfig(),options={execute:true,rigTaskId:'rig',maxCredits:6,targets:'roll'};
  await assert.rejects(runPipeline({root,config,options,allowPaid:true,apiKey:'test',client:fakeClient({failPost:true})}),/ambiguous/);
  const resume=path.join(root,'work/meshy/state.json'),state=JSON.parse(await readFile(resume,'utf8'));
  assert.equal(state.reservedCredits,3);assert.equal(state.tasks['roll:motion'].uncertain,true);
  const client=fakeClient();await assert.rejects(runPipeline({root,config,options,allowPaid:true,apiKey:'test',client,resume}),/uncertain outcome/);
  assert.equal(client.calls.filter(c=>c.body).length,0);
});
test('saved task IDs resume polling and reviewed clip ranges can change without paying twice',async t=>{
  const root=await workspace(t),config=fixtureConfig(),options={execute:true,rigTaskId:'rig',maxCredits:6,targets:'roll'};
  await assert.rejects(runPipeline({root,config,options,allowPaid:true,apiKey:'test',client:fakeClient({failPoll:true})}),/poll timed out/);
  config.motions.roll.range=[.1,.5];
  const client=fakeClient(),resume=path.join(root,'work/meshy/state.json');
  const result=await runPipeline({root,config,options,allowPaid:true,apiKey:'test',client,resume});
  assert.equal(result.consumedCredits,6);assert.equal(client.calls.filter(c=>c.body).length,1);assert.equal(client.calls.find(c=>c.poll).id,'task-1');
});
test('speed/quality failure and unexpected credit usage leave the live manifest unchanged',async t=>{
  const root=await workspace(t),before=await readFile(path.join(root,'assets/models/manifest.json')),client=fakeClient();
  await assert.rejects(runPipeline({root,config:originalConfig,options:{execute:true,rigTaskId:'rig',maxCredits:6,targets:'roll'},allowPaid:true,apiKey:'test',client}),/クリップ/);
  assert.deepEqual(await readFile(path.join(root,'assets/models/manifest.json')),before);
  const charging=fakeClient();charging.poll=async()=>({status:'SUCCEEDED',consumed_credits:4});
  await assert.rejects(runPipeline({root,config:fixtureConfig(),options:{execute:true,rigTaskId:'rig',maxCredits:6,targets:'roll'},allowPaid:true,apiKey:'test',client:charging}),/Actual pricing/);
  assert.equal(charging.calls.filter(c=>c.body).length,1);assert.deepEqual(await readFile(path.join(root,'assets/models/manifest.json')),before);
});
test('client protects keys, rejects asset host changes, bounds polling and never retries POST',async()=>{
  let count=0;
  const client=createClient('do-not-log',{fetchImpl:async()=>{count++;return new Response('do-not-log signed URL',{status:401});}});
  await assert.rejects(client.request('/text-to-motion',{prompt:'test'}),e=>!e.message.includes('do-not-log')&&/401/.test(e.message));assert.equal(count,1);
  await assert.rejects(client.download('https://evil.example/file.glb'),/host/);assert.equal(count,1);
  let auth;
  const downloader=createClient('secret',{fetchImpl:async(url,options)=>{auth=options.headers;return new Response(new Uint8Array([1,2,3]));}});
  assert.deepEqual([...await downloader.download('https://assets.meshy.ai/test.glb?signature=private')],[1,2,3]);assert.equal(auth,undefined);
  const waiting=createClient('secret',{maxPolls:2,sleep:async()=>{},fetchImpl:async()=>Response.json({status:'IN_PROGRESS'})});
  await assert.rejects(waiting.poll('/animations','id'),/timed out/);
});
test('motion preparation rejects mismatched binds, bad tracks and excessive playback speed',async()=>{
  const base=await loadGLB(baseBytes),profile=await rigProfile(base),bad=structuredClone(profile);bad.bones[0].inverse[0]+=.1;assert.throws(()=>assertCompatibleRig(profile,bad),/一致/);
  const spec={clip:'Idle_03',range:[0,.5]},clip=prepareMotion(base.scene,base.animations,spec,'roll');
  assert.equal(clip.name,'Hoshi_roll');assert.equal(clip.duration,.5);
  await assert.rejects(validateMotion(baseBytes,baseBytes,'roll',{clip:'Idle_03'},originalConfig),/playback/);
  assert.throws(()=>animationPack(baseBytes,'absent','test'),/absent/);
  assert.throws(()=>readGLB(Buffer.from('bad')),/header/);
});
test('directional dodges keep facing, travel and resource rules; landing is detected once',()=>{
  assert.equal(selectDodge(0,-1,0,Math.PI),'roll');assert.equal(selectDodge(1,0,0,Math.PI),'dodgeLeft');assert.equal(selectDodge(-1,0,0,Math.PI),'dodgeRight');assert.equal(selectDodge(0,1,0,Math.PI),'dodgeBack');
  assert.equal(selectDodge(0,-1,Math.PI/2,Math.PI),'dodgeRight');
  for(const [x,y,type] of [[0,-1,'roll'],[1,0,'dodgeLeft'],[-1,0,'dodgeRight'],[0,1,'dodgeBack']]){
    const grid=new CollisionGrid(),motor=new PlayerMotor(grid),combat=new CombatSystem(motor,grid,null,[]),start={x:motor.x,z:motor.z};
    combat.step(1/60,{x,y,dodge:true},0);assert.equal(combat.dodgeType,type);assert.ok(Math.abs(motor.angle-Math.PI)<.001);assert.equal(motor.stamina,78);
    for(let i=0;i<21;i++)combat.step(1/60,{x:0,y:0},0);
    assert.ok(Math.abs(Math.hypot(motor.x-start.x,motor.z-start.z)-3.6)<.001);assert.equal(combat.dodging,false);
    combat.dodgeCooldown=0;motor.stamina=100;combat.step(1/60,{x:0,y:0,jump:true},0);
    for(let i=0;i<80;i++)combat.step(1/60,{x:0,y:0},0);
    assert.equal(combat.landingSerial,1);assert.equal(motor.grounded,true);
  }
});
test('the shipped Meshy clip makes one forward roll on the 66-joint hero',async()=>{
  const {player:spec}=JSON.parse(await readFile('assets/models/manifest.json','utf8'));
  const entry=spec.motionLibrary.roll;
  const bytes=await readFile(path.join('assets/models',entry.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'),entry.sha256);
  const {json}=readGLB(bytes);
  assert.equal(json.skins[0].joints.length,66);
  assert.ok(!json.meshes&&!json.images);
  const report=await validateMotion(baseBytes,bytes,'roll',entry,originalConfig);
  assert.ok(Math.abs(report.duration-ROLL_DURATION)<.001);
  assert.ok(report.worstPenetration>-.02);

  const hero=await loadGLB(baseBytes),pack=await loadGLB(bytes);
  const clip=prepareMotion(hero.scene,pack.animations,entry,'roll');
  const {wrapper}=prepareModel(hero,spec),grounding=createFootGrounding(wrapper,spec.footOffset,true);
  attachSword(hero.scene,spec.weapon);
  const sword=hero.scene.getObjectByName('HeroSword'),hips=hero.scene.getObjectByName('mixamorigHips');
  const mixer=new THREE.AnimationMixer(hero.scene);
  const action=mixer.clipAction(clip).setLoop(THREE.LoopOnce,1);
  action.clampWhenFinished=true;action.play();
  const up=new THREE.Vector3(),rotation=new THREE.Quaternion(),swordBounds=new THREE.Box3();
  let pitch=0,previous=null,minUp=1,worstSwordY=Infinity;
  for(let i=0;i<=144;i++){
    mixer.setTime(clip.duration*i/144);grounding.update('roll');
    const angle=Math.atan2(up.set(0,1,0).applyQuaternion(hips.getWorldQuaternion(rotation)).z,up.y);
    if(previous!==null){
      const delta=angle-previous;
      pitch+=Math.atan2(Math.sin(delta),Math.cos(delta));
    }
    previous=angle;minUp=Math.min(minUp,up.y);
    worstSwordY=Math.min(worstSwordY,swordBounds.setFromObject(sword,true).min.y);
  }
  assert.ok(minUp<-.85&&up.y>.95,'hips invert and then return upright');
  assert.ok(pitch>Math.PI*1.85&&pitch<Math.PI*2.15,'hips make one forward revolution');
  assert.ok(worstSwordY>-.03,'the sword clears the floor throughout the roll within 3 cm');
});
test('new one-shot states blend into current locomotion instead of forcing idle',async()=>{
  const gltf=await loadGLB(baseBytes),clips=MOTION_STATES.map(state=>prepareMotion(gltf.scene,gltf.animations,{clip:'Idle_03',range:[0,state==='land'?.3:.5]},state));
  const mapping=Object.fromEntries(MOTION_STATES.map((s,i)=>[s,clips[i].name]));
  const animator=createPlayerAnimator(gltf.scene,[...gltf.animations,...clips],{idle:'Idle_03',walk:'Walking',run:'Running',...mapping});
  const motor={grounded:true,speed:0},combat={dodging:true,dodgeType:'roll',dodgeSerial:1,dodgeDuration:.36,dodgePhase:0};
  for(const state of MOTION_STATES){
    Object.assign(combat,{dodging:state!=='land',dodgeType:state,dodgeSerial:combat.dodgeSerial+1,landingTime:state==='land'?.2:0,landingSerial:1});
    animator.update(.016,motor,combat);assert.equal(animator.state,state);
    for(let i=0;i<10;i++){animator.update(.016,motor,combat);assert.ok(Math.abs(Object.values(animator.getStatus().weights).reduce((a,b)=>a+b,0)-1)<.0001);}
  }
  combat.dodging=true;combat.dodgeType='roll';combat.dodgePhase=.5;
  animator.update(.033,motor,combat);assert.ok(Math.abs(animator.getStatus().time-.25)<.00001);
  combat.dodging=false;
  motor.speed=4.1;combat.landingTime=0;animator.update(.016,motor,combat);assert.equal(animator.state,'walk');
  const paused=animator.getStatus().mixerTime;animator.update(0,motor,combat);assert.equal(animator.getStatus().mixerTime,paused);
});

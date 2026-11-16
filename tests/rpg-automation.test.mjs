import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import test from 'node:test';
import { applyOperations, CONTENT_PATH, emptyCatalog, parseCatalog } from '../js/rpg-content.js';
import { RpgProgress } from '../js/rpg-progress.js';
import { CollisionGrid, PlayerMotor } from '../js/physics.js';
import { CombatSystem, ENEMY_TYPES } from '../js/combat.js';
import { checkCatalogAssets } from '../scripts/rpg/catalog-assets.mjs';
import { additiveCatalog, releaseGate } from '../scripts/rpg/release-gate.mjs';
import { retrieveTask } from '../scripts/meshy/retrieve-task.mjs';
import { approvalReservation } from '../scripts/meshy/approval-lock.mjs';

const demo = JSON.parse(await readFile('docs/requests/watchpost.json','utf8'));
const existing = parseCatalog(await readFile(CONTENT_PATH,'utf8'));
const sample = () => applyOperations(emptyCatalog(),demo);

test('the real catalog decodes the original 66-bone model and forward-roll pack', async () => {
  const report = await checkCatalogAssets(process.cwd(), existing);
  assert.equal(existing.models.hero.bones,66);
  assert.equal(existing.motions['hero-roll'].clip,'Hoshi_roll');
  assert.ok(report.glbModels>=1&&report.packs>=1);
  const invalid=structuredClone(existing);
  invalid.motions['hero-roll'].sha256='f'.repeat(64);
  await assert.rejects(checkCatalogAssets(process.cwd(),invalid),/checksum differs/);
});

test('catalog operations evaluate cross references as one transaction and reject unsafe paths', () => {
  const start=emptyCatalog(), next=applyOperations(start,demo);
  assert.deepEqual(start,emptyCatalog());
  assert.equal(additiveCatalog(start,next),demo.changes.length);
  assert.throws(()=>applyOperations(next,{version:1,summary:'remove model',changes:[{op:'remove',type:'models',id:'mina-scout'}]}),/role or model/);
  const replaced=applyOperations(next,{version:1,summary:'change item',changes:[{op:'replace',type:'items',id:'watchpost-dagger',value:{name:'森番の短剣',kind:'weapon',attackBonus:4}}]});
  assert.throws(()=>additiveCatalog(next,replaced),/Existing catalog entries/);
  const bad=structuredClone(demo);
  bad.changes[0].value={...bad.changes[0].value,type:'glb',file:'models/../private.glb',sha256:'a'.repeat(64),bones:0};
  assert.throws(()=>applyOperations(start,bad),/local GLB/);
  bad.changes[0].id='constructor';
  assert.throws(()=>applyOperations(start,bad),/invalid operation/);
});

test('quest rewards are awarded once, equip and recruit persist, and old saves start clean', () => {
  const catalog=sample(), progress=new RpgProgress(catalog,undefined);
  assert.equal(progress.state('watchpost-round'),'available');
  assert.ok(!progress.record('visit','watchpost'));
  assert.ok(progress.offer('watchpost-round'));
  assert.ok(progress.record('visit','watchpost'));
  assert.equal(progress.state('watchpost-round'),'ready');
  assert.ok(progress.complete('watchpost-round'));
  assert.ok(!progress.complete('watchpost-round'));
  assert.ok(progress.equip('watchpost-dagger'));
  assert.ok(progress.recruit('mina'));
  const restored=new RpgProgress(catalog,progress.toJSON());
  assert.equal(restored.items['watchpost-dagger'],1);
  assert.equal(restored.attackBonus,3);
  assert.equal(restored.skills[0][0],'watchpost-triple');
  assert.deepEqual(restored.companions,['mina']);
});

test('a registered combat skill deals three separate hits and pays stamina once', () => {
  const grid=new CollisionGrid(),motor=new PlayerMotor(grid);
  motor.reset(20,0);
  const config={...ENEMY_TYPES.slime,hp:200,xp:0};
  const combat=new CombatSystem(motor,grid,null,[{type:'rpg-test',x:20,z:-1.15,config,contentActor:'test'}]);
  const enemy=combat.enemies[0];
  const skill=sample().skills['watchpost-triple'];
  combat.attackBonus=3;
  combat.step(1/60,{x:0,y:0,skill},0);
  assert.equal(motor.stamina,76);
  for(let i=0;i<57;i++)combat.step(1/60,{x:0,y:0},0);
  const hits=combat.drainEvents().filter(event=>event.type==='hit');
  assert.equal(hits.length,3);
  assert.equal(enemy.hp,200-3*Math.round(21*skill.power));
  assert.equal(enemy.contentActor,'test');
});

const repo='Noaaaaa05/hoshi-rpg-3d', head='b'.repeat(40), base='a'.repeat(40);
function fakeGate({red=false,wrongBase=false,extraFile=false}={}) {
  const branch='codex/rpg-content-quest';
  const catalog=value=>({path:CONTENT_PATH,type:'file',encoding:'base64',content:Buffer.from(JSON.stringify(value)).toString('base64')});
  const link={number:90,base:{ref:'main',sha:base},head:{sha:head}};
  const answers=new Map([
    ['/pulls/90',{number:90,user:{login:'Noaaaaa05'},state:'open',draft:false,mergeable:true,mergeable_state:'clean',
      changed_files:extraFile?2:1,base:{ref:'main',sha:base,repo:{full_name:repo}},head:{ref:branch,sha:head,repo:{full_name:repo}}}],
    ['/branches/main',{commit:{sha:base}}],
    ['/pulls/90/files?per_page=10',[{filename:CONTENT_PATH,status:'modified'}]],
    ['/actions/workflows/check.yml',{id:123,state:'active',path:'.github/workflows/check.yml'}],
    ['/commits/'+head+'/status',{statuses:[]}],
    ['/contents/'+CONTENT_PATH+'?ref='+base,catalog(emptyCatalog())],
    ['/contents/'+CONTENT_PATH+'?ref='+head,catalog(sample())],
    ['/compare/'+base+'...'+head+'?per_page=1',{status:wrongBase?'diverged':'ahead',behind_by:wrongBase?1:0,merge_base_commit:{sha:base}}],
    ['/actions/workflows/123/runs?event=pull_request&head_sha='+head+'&per_page=10',{workflow_runs:[{
      id:456,workflow_id:123,event:'pull_request',path:'.github/workflows/check.yml',head_branch:branch,head_sha:head,head_repository:{full_name:repo},
      status:'completed',conclusion:red?'failure':'success',pull_requests:[link]
    }]}],
    ['/actions/runs/456/jobs?per_page=30',{jobs:[{name:'game',conclusion:'success',
      steps:['Run npm run check','Validate RPG catalog','Run npm test','Run npm run test:browser'].map(name=>({name,conclusion:'success'}))}]}],
    ['/commits/'+head+'/check-runs?filter=latest&per_page=100',{total_count:1,check_runs:[{status:'completed',conclusion:'success'}]}],
  ]);
  return {repo,owner:'Noaaaaa05',number:90,expectedHead:head,get:async path=>{assert.ok(answers.has(path),path);return answers.get(path);}};
}

test('release gate refuses failed, stale, and mixed-file PRs', async () => {
  assert.equal((await releaseGate(fakeGate())).additions,demo.changes.length);
  await assert.rejects(releaseGate(fakeGate({red:true})),/must succeed/);
  await assert.rejects(releaseGate(fakeGate({wrongBase:true})),/latest main commit/);
  await assert.rejects(releaseGate(fakeGate({extraFile:true})),/catalog file only/);
  await assert.rejects(releaseGate({...fakeGate(),expectedHead:'c'.repeat(40)}),/reviewed head/);
});

test('Meshy retrieval has only GETs, with authentication on the task and none on the download', async () => {
  const calls=[], id='01a1e4b0-d14f-73d6-ab4e-9ff7c372edf1';
  const signed='https://assets.meshy.ai/clip.bvh?signature=fixture-opaque';
  const fetchImpl=async(url,options)=>{
    calls.push({url,options});
    if(url.startsWith('https://api.meshy.ai'))return Response.json({id,status:'SUCCEEDED',progress:100,result:{motion_format:'bvh',motion_url:signed}});
    return new Response('HIERARCHY\nROOT Root\n{\n}\nMOTION\n');
  };
  const {report,bytes}=await retrieveTask({kind:'motion',id,apiKey:'fixture-private',download:true,fetchImpl});
  assert.equal(bytes.length,report.size);
  assert.ok(!JSON.stringify(report).includes('fixture'));
  assert.ok(calls.every(call=>call.options.method==='GET'&&call.options.redirect==='error'));
  assert.equal(calls[0].options.headers.Authorization,'Bearer fixture-private');
  assert.equal(calls[1].options.headers,undefined);
  await assert.rejects(retrieveTask({kind:'motion',id,apiKey:'fixture-private',download:true,
    fetchImpl:async()=>Response.json({status:'SUCCEEDED',result:{motion_format:'bvh',motion_url:'https://example.invalid/fixture'}})}),/Unexpected Meshy download host/);
});

test('paid approval ref is reserved once and a runner retry never starts a reservation', async () => {
  const env={ GITHUB_ACTIONS:'true', GITHUB_REPOSITORY:repo, GITHUB_SHA:head, GITHUB_REF:'refs/heads/main',
    GITHUB_ACTOR:'Noaaaaa05', GITHUB_REPOSITORY_OWNER:'Noaaaaa05', GITHUB_RUN_ATTEMPT:'1',
    GITHUB_TOKEN:'fixture-token', MESHY_APPROVAL_ID:'approved-1234' };
  assert.throws(()=>approvalReservation({...env,GITHUB_RUN_ATTEMPT:'2'}),/fresh/);
  let attempts=0;
  const reserve=approvalReservation(env,async(url,options)=>{
    assert.equal(url,'https://api.github.com/repos/'+repo+'/git/refs');
    assert.equal(JSON.parse(options.body).ref,'refs/tags/meshy-approval-approved-1234');
    attempts++;
    return new Response(null,{status:attempts===1?201:422});
  });
  await reserve();
  await assert.rejects(reserve(),/No new paid task/);
});

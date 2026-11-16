import { test,expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { animationPack,readGLB,writeGLB } from '../../scripts/meshy/glb.mjs';
import { MOTION_STATES } from '../../js/motion-state.js';

const bytes=await readFile('assets/models/hero_animated.glb');
const manifest=JSON.parse(await readFile('assets/models/manifest.json','utf8'));
const checksum=b=>createHash('sha256').update(b).digest('hex');
async function fixtureLibrary(page){
  const configured=structuredClone(manifest);configured.player.motionLibrary={};
  for(const state of MOTION_STATES){
    // Test transport/state wiring with an existing real clip. These are not
    // Meshy-generated dodges and are never written to production assets.
    const body=animationPack(bytes,'Idle_03',`Hoshi_${state}`);
    configured.player.motionLibrary[state]={url:`./motions/fixture-${state}.glb`,clip:`Hoshi_${state}`,range:[0,state==='land'?.3:.5],sha256:checksum(body)};
    await page.route(`**/motions/fixture-${state}.glb`,route=>route.fulfill({contentType:'model/gltf-binary',body}));
  }
  await page.route('**/assets/models/manifest.json*',route=>route.fulfill({json:configured}));
}
async function start(page){
  await page.addInitScript(()=>localStorage.setItem('hoshi-rpg-3d:v0.1',JSON.stringify({version:2,position:{x:0,z:12},quality:'low'})));
  await page.goto('/hoshi-rpg-3d/?debug=1');await expect(page.locator('#start-button')).toBeEnabled({timeout:20000});await page.locator('#start-button').click();
  await page.evaluate(()=>{
    window.__MOTION_TRACE__=[];
    const observe=()=>{
      const s=window.__HOSHI_DEBUG__,animation=s.playerModel.animation;
      window.__MOTION_TRACE__.push({state:animation?.state,clip:animation?.clip,time:animation?.time,weights:animation?.weights});
      if(window.__MOTION_TRACE__.length>600)window.__MOTION_TRACE__.shift();
      requestAnimationFrame(observe);
    };observe();
  });
}
test('the published forward roll plays once and returns to idle',async({page},info)=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await start(page);
  const getState=()=>page.evaluate(()=>window.__HOSHI_DEBUG__);
  const initial=await getState();
  expect(initial.playerModel.motionStates).toContain('roll');
  expect(initial.playerModel.rejectedMotions).toEqual([]);
  if(info.project.name==='chromium-desktop')await page.keyboard.press('k');
  else await page.locator('#dodge-button').tap();
  await expect.poll(async()=>(await getState()).combat.dodgeSerial,{timeout:15000}).toBe(1);
  await expect.poll(async()=>(await getState()).combat.dodging,{timeout:15000}).toBe(false);
  const end=await getState();
  expect(end.combat.dodgeType).toBe('roll');
  expect(initial.player.z-end.player.z).toBeCloseTo(3.6,1);
  expect(end.playerModel.animation.state).toBe('idle');
  const samples=await page.evaluate(()=>window.__MOTION_TRACE__.filter(sample=>sample.state==='roll'));
  expect(samples.length).toBeGreaterThan(3);
  expect(samples.every(sample=>sample.clip==='Hoshi_roll')).toBe(true);
  expect(samples.at(-1).time-samples[0].time).toBeGreaterThan(.35);
  expect(errors).toEqual([]);
});

test('local motion packs select directional dodges, preserve facing and land without forcing idle',async({page},info)=>{
  test.skip(info.project.name==='chromium-desktop','Mobile/WebKit coverage for the optional motion pipeline.');
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await fixtureLibrary(page);await start(page);
  const model=await page.evaluate(()=>window.__HOSHI_DEBUG__.playerModel);
  expect(model.motionStates.sort()).toEqual([...MOTION_STATES].sort());expect(model.rejectedMotions).toEqual([]);
  for(const [code,type] of [['KeyW','roll'],['KeyD','dodgeLeft'],['KeyA','dodgeRight'],['KeyS','dodgeBack']]){
    await page.locator('#pause-button').click();await page.locator('#home-button').click();
    await page.evaluate(code=>{
      window.__MOTION_TRACE__=[];
      for(const key of [code,'KeyK'])window.dispatchEvent(new KeyboardEvent('keydown',{code:key,bubbles:true}));
      requestAnimationFrame(()=>requestAnimationFrame(()=>{for(const key of [code,'KeyK'])window.dispatchEvent(new KeyboardEvent('keyup',{code:key,bubbles:true}));}));
    },code);
    await expect.poll(()=>page.evaluate(()=>window.__HOSHI_DEBUG__.combat.dodgeType)).toBe(type);
    await expect.poll(()=>page.evaluate(()=>window.__MOTION_TRACE__.map(s=>s.state))).toContain(type);
    await page.evaluate(code=>{for(const key of [code,'KeyK'])window.dispatchEvent(new KeyboardEvent('keyup',{code:key,bubbles:true}));},code);
    await expect.poll(()=>page.evaluate(()=>window.__HOSHI_DEBUG__.combat.dodging)).toBe(false);
    if(type!=='roll')expect((await page.evaluate(()=>window.__HOSHI_DEBUG__.player)).angle).toBeCloseTo(Math.PI,3);
    await expect.poll(()=>page.evaluate(()=>window.__HOSHI_DEBUG__.playerModel.animation.state)).toBe('idle');
  }
  await page.evaluate(()=>{window.__MOTION_TRACE__=[];window.dispatchEvent(new KeyboardEvent('keydown',{code:'Space',bubbles:true}));window.dispatchEvent(new KeyboardEvent('keyup',{code:'Space',bubbles:true}));});
  await expect.poll(()=>page.evaluate(()=>window.__HOSHI_DEBUG__.combat.landingSerial),{timeout:15000}).toBeGreaterThan(0);
  await expect.poll(()=>page.evaluate(()=>window.__MOTION_TRACE__.map(s=>s.state))).toContain('land');
  expect(await page.evaluate(()=>window.__MOTION_TRACE__.every(s=>Math.abs(Object.values(s.weights).reduce((a,b)=>a+b,0)-1)<.0001))).toBe(true);
  await page.locator('#pause-button').click();const time=await page.evaluate(()=>window.__HOSHI_DEBUG__.playerModel.animation.mixerTime);await page.waitForTimeout(200);
  expect(await page.evaluate(()=>window.__HOSHI_DEBUG__.playerModel.animation.mixerTime)).toBe(time);expect(errors).toEqual([]);
});

test('corrupt, missing and incompatible optional motion packs keep the animated hero playable',async({page},info)=>{
  test.skip(info.project.name!=='webkit-iphone-landscape','One WebKit run checks the optional-motion rejection path.');
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  const configured=structuredClone(manifest),{json,bin}=readGLB(animationPack(bytes,'Idle_03','Hoshi_dodgeRight'));
  json.nodes[json.skins[0].joints[0]].translation[0]+=.25;const wrong=writeGLB(json,bin),corrupt=Buffer.from('broken GLB');
  configured.player.motionLibrary={roll:{url:'./motions/corrupt.glb',sha256:checksum(corrupt)},dodgeLeft:{url:'./motions/missing.glb',sha256:'0'.repeat(64)},dodgeRight:{url:'./motions/wrong.glb',sha256:checksum(wrong)}};
  await page.route('**/assets/models/manifest.json*',route=>route.fulfill({json:configured}));
  await page.route('**/motions/corrupt.glb',route=>route.fulfill({body:corrupt}));await page.route('**/motions/missing.glb',route=>route.fulfill({status:404,body:'Missing'}));await page.route('**/motions/wrong.glb',route=>route.fulfill({body:wrong}));
  await start(page);const model=await page.evaluate(()=>window.__HOSHI_DEBUG__.playerModel);
  expect(model.loaded).toBe(true);expect(model.mode).toBe('animated');expect(model.motionStates).toEqual([]);expect(model.rejectedMotions.sort()).toEqual(['dodgeLeft','dodgeRight','roll']);
  await page.keyboard.down('j');await expect.poll(()=>page.evaluate(()=>window.__HOSHI_DEBUG__.playerModel.animation.clip)).toBe('Attack');await page.keyboard.up('j');
  const z=await page.evaluate(()=>window.__HOSHI_DEBUG__.player.z);await page.keyboard.down('w');await expect.poll(()=>page.evaluate(()=>window.__HOSHI_DEBUG__.player.z)).toBeLessThan(z-1);await page.keyboard.up('w');
  expect(errors).toEqual([]);
});

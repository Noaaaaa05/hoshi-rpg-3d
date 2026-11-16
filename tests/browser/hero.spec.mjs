import { test, expect } from '@playwright/test';

test('rigged hero is correctly grounded and faces away from the following camera',async({page},testInfo)=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/hoshi-rpg-3d/?debug=1');await expect(page.locator('#start-button')).toBeEnabled({timeout:15000});
  await page.locator('#start-button').click();
  const state=await page.evaluate(()=>window.__HOSHI_DEBUG__),model=state.playerModel;
  expect(model.loaded).toBe(true);expect(model.mode).toBe('animated');expect(model.proceduralVisible).toBe(false);expect(model.modelVisible).toBe(true);
  expect(model.bones).toBe(66);expect(model.skinnedMeshes).toBe(1);expect(model.clips.sort()).toEqual(['Attack','Idle_03','Running','Walking']);
  expect(model.states).toEqual({idle:'Idle_03',walk:'Walking',run:'Running',attack:'Attack'});expect(model.weapon.attached).toBe(true);
  expect(model.height).toBeCloseTo(1.9,5);expect(model.minY).toBeCloseTo(0,5);expect(model.worldFootY).toBeCloseTo(state.player.y,5);
  expect(model.triangles).toBeLessThanOrEqual(15000);expect(model.meshes).toBe(1);expect(model.rotationY).toBe(0);
  const towardCamera={x:state.camera.x-state.player.x,z:state.camera.z-state.player.z};
  expect(towardCamera.x*Math.sin(state.player.angle)+towardCamera.z*Math.cos(state.player.angle)).toBeLessThan(0);
  await page.screenshot({path:testInfo.outputPath('meshy-hero-back.png')});
  // Half a turn through the actual camera controls shows the authored front.
  const zone=await page.locator('#camera-zone').boundingBox();
  for(let i=0;i<2;i++){
    await page.mouse.move(zone.x+zone.width*.25,zone.y+50);await page.mouse.down();
    await page.mouse.move(zone.x+zone.width*.25+314,zone.y+50,{steps:12});await page.mouse.up();
  }
  await expect.poll(()=>page.evaluate(()=>window.__HOSHI_DEBUG__.camera.yaw)).toBeLessThan(-3);
  await page.screenshot({path:testInfo.outputPath('meshy-hero-front.png')});
  const after=await page.evaluate(()=>window.__HOSHI_DEBUG__.playerModel);
  expect(after.height).toBe(model.height);expect(after.worldFootY).toBeCloseTo(model.worldFootY,5);expect(after.mode).toBe('animated');
  expect(errors).toEqual([]);
});

test('failed hero download restores the procedural hero and leaves combat, dodge and save working',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/hero_animated.glb',route=>route.fulfill({status:404,body:'Missing hero'}));
  await page.addInitScript(()=>{if(!localStorage.getItem('hoshi-rpg-3d:v0.1'))localStorage.setItem('hoshi-rpg-3d:v0.1',JSON.stringify({version:2,position:{x:0,z:-4.7},quality:'low',progression:{level:1,xp:30,kills:0}}));});
  await page.goto('/?debug=1');await expect(page.locator('#start-button')).toBeEnabled({timeout:15000});await page.locator('#start-button').click();
  const model=await page.evaluate(()=>window.__HOSHI_DEBUG__.playerModel);
  expect(model.loaded).toBe(false);expect(model.proceduralVisible).toBe(true);expect(model.modelVisible).toBe(false);
  await page.keyboard.down('j');await expect.poll(()=>page.evaluate(()=>window.__HOSHI_DEBUG__.combat.kills),{timeout:25000}).toBe(1);await page.keyboard.up('j');
  expect((await page.evaluate(()=>window.__HOSHI_DEBUG__.player)).level).toBe(2);
  const start=await page.evaluate(()=>window.__HOSHI_DEBUG__.player.z);
  await page.locator('#dodge-button').click();await expect.poll(()=>page.evaluate(()=>window.__HOSHI_DEBUG__.player.z),{timeout:10000}).toBeLessThan(start-1);
  await page.locator('#pause-button').click();await page.reload();await expect(page.locator('#start-button')).toBeEnabled();await page.locator('#start-button').click();
  expect((await page.evaluate(()=>window.__HOSHI_DEBUG__.player)).level).toBe(2);
  expect((await page.evaluate(()=>window.__HOSHI_DEBUG__.playerModel)).proceduralVisible).toBe(true);
  expect(errors).toEqual([]);
});

test('invalid hero binary falls back in WebKit without breaking movement',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='webkit-iphone-landscape','WebKit validates the parse-error fallback.');
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/hero_animated.glb',route=>route.fulfill({contentType:'model/gltf-binary',body:Buffer.from('invalid GLB')}));
  await page.goto('/?debug=1');await expect(page.locator('#start-button')).toBeEnabled({timeout:15000});await page.locator('#start-button').click();
  expect((await page.evaluate(()=>window.__HOSHI_DEBUG__.playerModel)).loaded).toBe(false);
  await page.keyboard.down('w');await expect.poll(()=>page.evaluate(()=>window.__HOSHI_DEBUG__.player.z),{timeout:15000}).toBeLessThan(10);await page.keyboard.up('w');
  expect(errors).toEqual([]);
});

test('Idle, Walk, Run and sword Attack switch smoothly and stop while paused',async({page},testInfo)=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/?debug=1');await expect(page.locator('#start-button')).toBeEnabled({timeout:15000});await page.locator('#start-button').click();
  const model=()=>page.evaluate(()=>window.__HOSHI_DEBUG__.playerModel);
  const initial=await model();
  await expect.poll(async()=>(await model()).animation.clip).toBe('Idle_03');
  await expect.poll(async()=>(await model()).animation.mixerTime).toBeGreaterThan(initial.animation.mixerTime+.1);
  const pose=await model();expect(pose.boneQuaternion).not.toEqual(initial.boneQuaternion);
  const start=await page.evaluate(()=>window.__HOSHI_DEBUG__.player.z);
  await page.keyboard.down('w');await expect.poll(async()=>(await model()).animation.clip).toBe('Walking');
  await expect.poll(()=>page.evaluate(()=>window.__HOSHI_DEBUG__.player.z),{timeout:15000}).toBeLessThan(start-1);
  await page.keyboard.down('Shift');await expect.poll(async()=>(await model()).animation.clip).toBe('Running');
  await page.screenshot({path:testInfo.outputPath('hero-running.png')});await page.keyboard.up('Shift');await page.keyboard.up('w');
  await expect.poll(async()=>(await model()).animation.clip).toBe('Idle_03');
  await page.keyboard.down('j');await expect.poll(async()=>(await model()).animation.clip).toBe('Attack');
  await expect.poll(async()=>(await model()).animation.weights.attack).toBeGreaterThan(.7);
  const attacking=await model();expect(attacking.animation.durations.attack).toBeCloseTo(.52,3);expect(attacking.grounding.minFootY).toBeCloseTo(0,4);
  await page.screenshot({path:testInfo.outputPath('hero-sword-attack.png')});await page.keyboard.up('j');
  await expect.poll(async()=>(await model()).animation.clip).toBe('Idle_03');
  await page.locator('#pause-button').click();const paused=(await model()).animation.mixerTime;await page.waitForTimeout(250);expect((await model()).animation.mixerTime).toBe(paused);
  expect(errors).toEqual([]);
});

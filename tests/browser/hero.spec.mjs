import { test, expect } from '@playwright/test';

test('Meshy hero is static, correctly grounded, facing away from the following camera',async({page},testInfo)=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/hoshi-rpg-3d/?debug=1');await expect(page.locator('#start-button')).toBeEnabled({timeout:15000});
  await page.locator('#start-button').click();
  const state=await page.evaluate(()=>window.__HOSHI_DEBUG__),model=state.playerModel;
  expect(model.loaded).toBe(true);expect(model.mode).toBe('static');expect(model.proceduralVisible).toBe(false);expect(model.modelVisible).toBe(true);
  expect(model.bones).toBe(0);expect(model.skinnedMeshes).toBe(0);expect(model.clips).toEqual([]);expect(model.states).toEqual({});
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
  expect(after.height).toBe(model.height);expect(after.worldFootY).toBeCloseTo(model.worldFootY,5);expect(after.mode).toBe('static');
  expect(errors).toEqual([]);
});

test('failed hero download restores the procedural hero and leaves combat, dodge and save working',async({page})=>{
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/hero-mobile.glb',route=>route.fulfill({status:404,body:'Missing hero'}));
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
  await page.route('**/hero-mobile.glb',route=>route.fulfill({contentType:'model/gltf-binary',body:Buffer.from('invalid GLB')}));
  await page.goto('/?debug=1');await expect(page.locator('#start-button')).toBeEnabled({timeout:15000});await page.locator('#start-button').click();
  expect((await page.evaluate(()=>window.__HOSHI_DEBUG__.playerModel)).loaded).toBe(false);
  await page.keyboard.down('w');await expect.poll(()=>page.evaluate(()=>window.__HOSHI_DEBUG__.player.z),{timeout:15000}).toBeLessThan(10);await page.keyboard.up('w');
  expect(errors).toEqual([]);
});

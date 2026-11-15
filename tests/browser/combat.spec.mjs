import { test, expect } from '@playwright/test';

async function seed(page,position={x:0,z:-4.7},extra={}) {
  await page.addInitScript(({position,extra})=>{
    if(!localStorage.getItem('hoshi-rpg-3d:v0.1'))localStorage.setItem('hoshi-rpg-3d:v0.1',JSON.stringify({version:1,position,stars:[0,2],landmarks:['gate'],quality:'low',sensitivity:1,progression:{level:1,xp:30,kills:0},...extra}));
  },{position,extra});
  await page.goto('/hoshi-rpg-3d/?debug=1');await expect(page.locator('#start-button')).toBeEnabled({timeout:15000});await page.locator('#start-button').click();
}
test('fights a slime, levels up, pauses combat, dodges and preserves progression on reload',async({page},testInfo)=>{
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await seed(page);
  await expect.poll(()=>page.evaluate(()=>window.__HOSHI_DEBUG__.enemies[0].state),{timeout:20000}).toMatch(/chase|windup|recover/);
  // Allow an actual enemy attack to verify player HP and telegraph behaviour.
  await expect.poll(()=>page.evaluate(()=>window.__HOSHI_DEBUG__.player.hp),{timeout:20000}).toBeLessThan(100);
  await expect(page.locator('#enemy-target')).toBeVisible();
  await page.keyboard.down('j');
  await expect.poll(()=>page.evaluate(()=>window.__HOSHI_DEBUG__.combat.kills),{timeout:25000}).toBe(1);
  await page.keyboard.up('j');
  const result=await page.evaluate(()=>window.__HOSHI_DEBUG__);
  expect(result.enemies[0].hp).toBe(0);expect(result.enemies[0].state).toBe('dead');
  expect(result.player.level).toBe(2);expect(result.player.maxHP).toBe(120);expect(result.player.attack).toBe(22);expect(result.player.xp).toBe(8);
  await expect(page.locator('#player-level')).toHaveText('Lv. 02');
  await page.screenshot({path:testInfo.outputPath('combat-level-up.png')});
  await page.locator('#pause-button').click();const paused=await page.evaluate(()=>window.__HOSHI_DEBUG__);
  await page.waitForTimeout(300);expect((await page.evaluate(()=>window.__HOSHI_DEBUG__)).combat.time).toBe(paused.combat.time);
  expect((await page.evaluate(()=>window.__HOSHI_DEBUG__)).enemies).toEqual(paused.enemies);
  await page.locator('#resume-button').click();
  const start=await page.evaluate(()=>window.__HOSHI_DEBUG__.player);
  await page.locator('#dodge-button').click();
  await expect.poll(()=>page.evaluate(()=>window.__HOSHI_DEBUG__.combat.dodgeCooldown),{intervals:[10,20,40]}).toBeGreaterThan(0);
  await expect.poll(()=>page.evaluate(()=>window.__HOSHI_DEBUG__.player.z),{timeout:10000}).toBeLessThan(start.z-1);
  await page.locator('#pause-button').click();await page.reload();await expect(page.locator('#start-button')).toBeEnabled();await page.locator('#start-button').click();
  const restored=await page.evaluate(()=>window.__HOSHI_DEBUG__);
  expect(restored.player.level).toBe(2);expect(restored.player.xp).toBe(8);expect(restored.combat.kills).toBe(1);expect(restored.stars).toEqual([0,2]);expect(restored.landmarks).toEqual(['gate']);
  expect(errors).toEqual([]);
});

test('goblin combat, four touch inputs and compact controls work on mobile',async({page,context},testInfo)=>{
  test.skip(testInfo.project.name!=='chromium-touch','CDP touch dispatch is Chromium-only.');
  await seed(page,{x:16,z:-25.8},{progression:{level:1,xp:0,kills:0}});
  await page.keyboard.down('j');
  await expect.poll(()=>page.evaluate(()=>window.__HOSHI_DEBUG__.enemies[3].hp),{timeout:30000}).toBe(0);
  await page.keyboard.up('j');expect((await page.evaluate(()=>window.__HOSHI_DEBUG__)).combat.kills).toBe(1);
  await page.locator('#pause-button').click();await page.locator('#home-button').click();
  const client=await context.newCDPSession(page);
  const box=async id=>page.locator(id).boundingBox();
  const stick=await box('#joystick'),zone=await box('#camera-zone'),attack=await box('#attack-button'),dodge=await box('#dodge-button');
  const touches=[{x:stick.x+stick.width/2,y:stick.y+stick.height*.2,id:1},{x:zone.x+zone.width*.4,y:zone.y+40,id:2},{x:attack.x+attack.width/2,y:attack.y+attack.height/2,id:3},{x:dodge.x+dodge.width/2,y:dodge.y+dodge.height/2,id:4}];
  const start=await page.evaluate(()=>window.__HOSHI_DEBUG__);
  await client.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:touches});
  touches[1].x+=70;await client.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:touches});
  await expect.poll(()=>page.evaluate(()=>window.__HOSHI_DEBUG__.player.z),{timeout:15000}).toBeLessThan(start.player.z-1);
  const active=await page.evaluate(()=>window.__HOSHI_DEBUG__);
  expect(active.combatPointers.attackId).not.toBeNull();expect(active.combatPointers.dodgeId).not.toBeNull();expect(active.input.joyId).not.toBeNull();expect(active.input.cameraId).not.toBeNull();
  expect(active.camera.yaw).toBeLessThan(start.camera.yaw-.1);
  await expect.poll(()=>page.evaluate(()=>window.__HOSHI_DEBUG__.combat.attacking)).toBe(true);
  await client.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await expect.poll(()=>page.evaluate(()=>window.__HOSHI_DEBUG__.combatPointers)).toEqual({attackId:null,dodgeId:null});
  for(const viewport of [{width:844,height:390},{width:568,height:320}]){
    await page.setViewportSize(viewport);
    const buttons=await page.locator('#attack-button,#dodge-button,#jump-button,#dash-button,#joystick').evaluateAll(els=>els.map(el=>{const r=el.getBoundingClientRect();return {id:el.id,x:r.x,y:r.y,right:r.right,bottom:r.bottom};}));
    for(const b of buttons){expect(b.x).toBeGreaterThanOrEqual(0);expect(b.y).toBeGreaterThanOrEqual(0);expect(b.right).toBeLessThanOrEqual(viewport.width);expect(b.bottom).toBeLessThanOrEqual(viewport.height);}
    for(let i=0;i<buttons.length;i++)for(let j=i+1;j<buttons.length;j++){const a=buttons[i],b=buttons[j];expect(a.right<=b.x||b.right<=a.x||a.bottom<=b.y||b.bottom<=a.y,`${a.id} and ${b.id}`).toBe(true);}
  }
  await page.screenshot({path:testInfo.outputPath('compact-controls.png')});
});

function triangleGLB() {
  const positions=Buffer.from(new Float32Array([-.4,0,0,.4,0,0,0,1,0]).buffer);
  const document={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{mesh:0}],meshes:[{primitives:[{attributes:{POSITION:0},material:0}]}],materials:[{doubleSided:true}],buffers:[{byteLength:positions.length}],bufferViews:[{buffer:0,byteOffset:0,byteLength:positions.length,target:34962}],accessors:[{bufferView:0,componentType:5126,count:3,type:'VEC3',min:[-.4,0,0],max:[.4,1,0]}]};
  let json=Buffer.from(JSON.stringify(document));json=Buffer.concat([json,Buffer.alloc((4-json.length%4)%4,32)]);
  const header=Buffer.alloc(12);header.writeUInt32LE(0x46546c67,0);header.writeUInt32LE(2,4);header.writeUInt32LE(12+8+json.length+8+positions.length,8);
  const jsonHeader=Buffer.alloc(8);jsonHeader.writeUInt32LE(json.length,0);jsonHeader.writeUInt32LE(0x4e4f534a,4);
  const binHeader=Buffer.alloc(8);binHeader.writeUInt32LE(positions.length,0);binHeader.writeUInt32LE(0x004e4942,4);
  return Buffer.concat([header,jsonHeader,json,binHeader,positions]);
}
test('GLB monster replacement and failed-load fallback keep combat available in WebKit',async({page},testInfo)=>{
  test.skip(testInfo.project.name!=='webkit-iphone-landscape','One WebKit run validates the shared GLB loader.');
  const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/assets/models/manifest.json',route=>route.fulfill({json:{player:null,objects:[],monsters:{slime:{url:'./test.glb',height:1.1},goblin:{url:'./missing.glb',height:1.6}}}}));
  await page.route('**/test.glb',route=>route.fulfill({contentType:'model/gltf-binary',body:triangleGLB()}));
  await page.route('**/missing.glb',route=>route.fulfill({status:404,body:'Not found'}));
  await seed(page);
  const enemies=await page.evaluate(()=>window.__HOSHI_DEBUG__.enemies);
  expect(enemies.filter(e=>e.type==='slime').every(e=>e.modelLoaded)).toBe(true);expect(enemies.filter(e=>e.type==='goblin').every(e=>!e.modelLoaded)).toBe(true);
  await page.keyboard.down('j');await expect.poll(()=>page.evaluate(()=>window.__HOSHI_DEBUG__.combat.kills),{timeout:20000}).toBeGreaterThan(0);await page.keyboard.up('j');
  expect(errors).toEqual([]);
});

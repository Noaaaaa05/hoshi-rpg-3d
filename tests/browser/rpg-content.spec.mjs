import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { applyOperations, emptyCatalog } from '../../js/rpg-content.js';
const authored = JSON.parse(await readFile('docs/requests/watchpost.json','utf8'));
const catalog = applyOperations(emptyCatalog(), authored);

test('a catalog quest can be played, rewarded, and restored from a landscape touch session',async({page},info)=>{
  test.skip(info.project.name==='chromium-desktop','Chromium touch and mobile WebKit cover this interaction');
  const errors=[];
  page.on('pageerror', error=>errors.push(error.message));
  await page.route('**/assets/rpg/catalog.json', route=>route.fulfill({json:catalog}));
  await page.addInitScript(()=>{
    const key='hoshi-rpg-3d:v0.1';
    if(!localStorage.getItem(key))localStorage.setItem(key, JSON.stringify({version:2,position:{x:0,z:12},quality:'low'}));
  });
  const debug=()=>page.evaluate(()=>window.__HOSHI_DEBUG__);
  const tap=async name=>page.getByRole('button',{name,exact:true}).tap();
  const walk=async (key,condition)=>{
    await page.keyboard.down(key);
    try { await expect.poll(condition,{timeout:18000}).toBe(true); }
    finally { await page.keyboard.up(key); }
  };
  const npc=page.getByRole('button',{name:'見張り番ミナと話す'});
  await page.goto('/hoshi-rpg-3d/?debug=1');
  await expect(page.locator('#start-button')).toBeEnabled({timeout:20000});
  await page.locator('#start-button').tap();
  await npc.tap();
  await tap('見回りを引き受ける');
  await expect.poll(async()=>(await debug()).rpg.quests['watchpost-round']?.state).toBe('active');
  await page.locator('#rpg-dialog button').last().tap();
  await walk('d',async()=>(await debug()).player.x>3.7);
  await walk('w',async()=>(await debug()).rpg.quests['watchpost-round']?.state==='ready');
  await walk('s',async()=>(await debug()).player.z>9.8);
  await npc.tap();
  await tap('見回りを報告する');
  await tap('ミナを仲間にする');
  await page.locator('#rpg-dialog button').last().tap();
  await page.locator('#inventory-button').tap();
  await expect(page.locator('#rpg-inventory')).toContainText('森番の短剣 ×1');
  await tap('森番の短剣を装備');
  await expect.poll(async()=>(await debug()).player.attack).toBe(21);
  await tap('小径の三連撃（ST 24）');
  await expect.poll(async()=>(await debug()).player.stamina).toBeLessThan(78);
  await page.locator('#pause-button').tap();
  await page.reload();
  await expect(page.locator('#start-button')).toBeEnabled({timeout:20000});
  await page.locator('#start-button').tap();
  await expect.poll(async()=>(await debug()).rpg.companions).toEqual(['mina']);
  const saved=(await debug()).rpg;
  expect(saved.quests['watchpost-round'].state).toBe('complete');
  expect(saved.items['watchpost-dagger']).toBe(1);
  expect(saved.weapon).toBe('watchpost-dagger');
  expect(errors).toEqual([]);
});

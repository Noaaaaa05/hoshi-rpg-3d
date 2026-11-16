import { test, expect } from '@playwright/test';

// Wall footprints: a village house (js/village.js) and the watchpost hut (assets/rpg/catalog.json).
const house = {x: -33, z: 31, halfX: 2.5, halfZ: 2}, hut = {x: 6.5, z: 6.2, halfX: 1.61, halfZ: 1.19};
const inside = (point, box, margin) => Math.abs(point.x - box.x) < box.halfX + margin && Math.abs(point.z - box.z) < box.halfZ + margin;

for (const [name, start, keys, box] of [
  ['a village house', {x: -33, z: 26}, ['KeyS'], house],
  ['the watchpost hut', {x: 4.2, z: 4.2}, ['KeyS', 'KeyD'], hut],
]) test(`the hero stops at the walls of ${name} and the camera stays outside them`, async ({page}) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(position => {
    localStorage.setItem('hoshi-rpg-3d:v0.1', JSON.stringify({version: 2, position, quality: 'low'}));
  }, start);
  const view = () => page.evaluate(() => { const {player, camera} = window.__HOSHI_DEBUG__; return {player, camera}; });
  await page.goto('/hoshi-rpg-3d/?debug=1');
  await expect(page.locator('#start-button')).toBeEnabled({timeout: 20000});
  await page.locator('#start-button').click();
  // The camera starts on the far side of the building, so its view line crosses the walls as the hero walks up.
  for (const key of keys) await page.keyboard.down(key);
  await expect.poll(async () => inside((await view()).player, box, .6), {timeout: 20000}).toBe(true);
  await page.waitForTimeout(700);
  for (const key of keys) await page.keyboard.up(key);
  await expect.poll(async () => (await view()).player.speed, {timeout: 10000}).toBeLessThan(.05);
  expect(inside((await view()).player, box, .37)).toBe(false);
  await expect.poll(async () => inside((await view()).camera, box, .1), {timeout: 10000}).toBe(false);
  expect(errors).toEqual([]);
});

import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { CONTENT_PATH, parseCatalog, validateCatalog } from '../../js/rpg-content.js';

// The registered catalog has no exit yet. Give the watchpost one, so the route is exercised before content uses it.
const catalog = parseCatalog(await readFile(CONTENT_PATH, 'utf8'));
catalog.zones.watchpost.exit = 'trail-rest';
validateCatalog(catalog);
const destination = catalog.zones['trail-rest'];

test('a zone exit stays usable while a recruited companion follows within talk range', async ({page}, info) => {
  test.skip(info.project.name === 'chromium-desktop', 'Chromium touch and mobile WebKit cover this interaction');
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/assets/rpg/catalog.json', route => route.fulfill({json: catalog}));
  await page.addInitScript(() => {
    const key = 'hoshi-rpg-3d:v0.1';
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({version: 2, position: {x: 4.2, z: 5.3}, quality: 'low',
      rpg: {quests: {'watchpost-round': {state: 'complete', count: 1}}, items: {'watchpost-dagger': 1}, companions: ['mina']}}));
  });
  const state = () => page.evaluate(() => {
    const {player, rpg} = window.__HOSHI_DEBUG__;
    const mina = rpg.placements.find(placement => placement.id === 'mina-trail');
    return {x: player.x, z: player.z, companion: Math.hypot(mina.x - player.x, mina.z - player.z)};
  });
  await page.goto('/hoshi-rpg-3d/?debug=1');
  await expect(page.locator('#start-button')).toBeEnabled({timeout: 20000});
  await page.locator('#start-button').tap();
  // Step toward the camera. Mina then walks past the player to stand behind, well inside talk range.
  const end = await page.evaluate(() => new Promise(resolve => {
    const deadline = performance.now() + 15000;
    const signal = type => window.dispatchEvent(new KeyboardEvent(type, {code: 'KeyS', bubbles: true}));
    const frame = () => {
      const {z} = window.__HOSHI_DEBUG__.player;
      if (z >= 5.6 || performance.now() >= deadline) { signal('keyup'); resolve(z); } else requestAnimationFrame(frame);
    };
    signal('keydown');
    requestAnimationFrame(frame);
  }));
  expect(end).toBeGreaterThanOrEqual(5.6);
  await expect.poll(async () => (await state()).companion, {timeout: 15000}).toBeLessThan(2.4);
  const exit = page.getByRole('button', {name: destination.name + 'へ移動', exact: true});
  await expect(exit).toBeVisible();
  await exit.tap();
  await expect.poll(async () => { const {x, z} = await state(); return Math.hypot(x - destination.x, z - destination.z); }).toBeLessThan(1);
  // Away from an exit, the same companion is offered for conversation again.
  await expect(page.getByRole('button', {name: '見張り番ミナと話す', exact: true})).toBeVisible({timeout: 15000});
  expect(errors).toEqual([]);
});

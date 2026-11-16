import { test,expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';
test('private review paginates, filters, edits and exports provenance without any external request',async({page})=>{
  const errors=[],external=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(!r.url().startsWith('http://127.0.0.1:5174/'))external.push(r.url());});
  await page.goto('/');await expect(page.locator('#summary')).toContainText('切り抜き 72件');await expect(page.locator('.card')).toHaveCount(48);
  await page.locator('#next').click();await expect(page.locator('.card')).toHaveCount(24);
  await page.locator('#category').selectOption('character');await expect(page.locator('.card')).toHaveCount(36);
  await page.locator('.card').first().click();await expect(page.locator('#editor')).toBeVisible();
  await page.locator('#edit-name').fill('Reviewed test character');await page.locator('#edit-quality').selectOption('approved');await page.locator('#edit-rights').selectOption('cleared');await page.locator('#edit-evidence').fill('Synthetic test shapes created by this test suite');await page.locator('#edit-reviewer').fill('test reviewer');await page.locator('#edit-derivatives').check();await page.locator('#save-review').click();
  await expect(page.locator('#edit-message')).toContainText('保存しました');await page.locator('.close').click();
  const download=page.waitForEvent('download');await page.locator('#export').click();const file=await (await download).path();const data=JSON.parse(await readFile(file,'utf8'));
  expect(data.version).toBe(1);expect(Object.values(data.assets)[0].rights.allow_3d).toBe(true);expect(Object.values(data.assets)[0].rights.allow_publication).toBe(false);
  await page.reload();await expect(page.getByText('Reviewed test character',{exact:true})).toBeVisible();
  expect(external).toEqual([]);expect(errors).toEqual([]);
});

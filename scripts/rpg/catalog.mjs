import { closeSync, openSync, unlinkSync } from 'node:fs';
import { readFile, rename, stat, writeFile, mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { CONTENT_PATH, MAX_CATALOG_BYTES, applyOperations, parseCatalog } from '../../js/rpg-content.js';
import { checkCatalogAssets, sha256 } from './catalog-assets.mjs';

const [mode, source, option] = process.argv.slice(2);
if (process.argv.length < 3 || process.argv.length > 5 ||
    (mode === 'check' ? source !== undefined : mode !== 'apply' || !source || ![undefined, '--write'].includes(option))) {
  throw new Error('Usage: npm run rpg:check or npm run rpg:apply -- <request.json> [--write]');
}
const root = process.cwd(), file = path.join(root, CONTENT_PATH);
let lease;
try {
  if (option === '--write') lease = openSync(file + '.lock', 'wx');
  const current = await readFile(file, 'utf8');
  let catalog = parseCatalog(current);
  if (mode === 'apply') {
    if ((await stat(source)).size > MAX_CATALOG_BYTES) throw new Error('Request exceeds size limit');
    catalog = applyOperations(catalog, JSON.parse(await readFile(source, 'utf8')));
  }
  const serialized = JSON.stringify(catalog, null, 2) + '\n';
  parseCatalog(serialized);
  const report = await checkCatalogAssets(root, catalog);
  if (option === '--write') {
    const staging = await mkdtemp(path.join(path.dirname(file), '.rpg-catalog-'));
    try {
      await writeFile(path.join(staging, 'catalog.json'), serialized, { flag: 'wx' });
      if (await readFile(file, 'utf8') !== current) throw new Error('Catalog moved while validating. Review its latest version.');
      await rename(path.join(staging, 'catalog.json'), file);
    } finally { await rm(staging, { recursive: true, force: true }); }
  }
  console.log(JSON.stringify({ mode, written: option === '--write', catalogSHA256: sha256(serialized), ...report }, null, 2));
} finally {
  if (lease !== undefined) {
    closeSync(lease);
    unlinkSync(file + '.lock');
  }
}

// Confirms that the public site serves the files of this checkout: GET requests and SHA-256 only.
import { createHash } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const PUBLIC_URL = 'https://noaaaaa05.github.io/hoshi-rpg-3d/';
const MAX_BYTES = 8 * 1024 * 1024;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

async function tree(root, directory) {
  const entries = await readdir(path.join(root, directory), { withFileTypes: true });
  const files = await Promise.all(entries.map(entry => {
    const name = directory + '/' + entry.name;
    return entry.isDirectory() ? tree(root, name) : entry.isFile() ? [name] : [];
  }));
  return files.flat();
}

// Every file the running game requests: the page, its modules, the catalog, the manifest and the GLBs they name.
export async function publishedFiles(root) {
  const files = new Set(['index.html', 'style.css', 'assets/icon.svg', 'assets/rpg/catalog.json', 'assets/models/manifest.json',
    ...await tree(root, 'js'), ...await tree(root, 'vendor/three')]);
  const catalog = JSON.parse(await readFile(path.join(root, 'assets/rpg/catalog.json'), 'utf8'));
  for (const spec of [...Object.values(catalog.models ?? {}), ...Object.values(catalog.motions ?? {})]) {
    if (typeof spec?.file === 'string') files.add(path.posix.join('assets', spec.file));
  }
  const manifest = JSON.parse(await readFile(path.join(root, 'assets/models/manifest.json'), 'utf8'));
  const linked = [manifest.player, ...Object.values(manifest.player?.motionLibrary ?? {}),
    ...Object.values(manifest.monsters ?? {}), ...(Array.isArray(manifest.objects) ? manifest.objects : [])];
  for (const spec of linked) {
    if (typeof spec?.url === 'string') files.add(path.posix.join('assets/models', spec.url));
  }
  return [...files].filter(file => !file.startsWith('..')).sort();
}

export async function verifyPages({ root = process.cwd(), base = PUBLIC_URL, fetchImpl = fetch, stamp = Date.now() } = {}) {
  const origin = new URL(base);
  const local = ['localhost', '127.0.0.1'].includes(origin.hostname);
  if (!base.endsWith('/') || origin.search || origin.hash || origin.username || origin.password ||
      (origin.protocol !== 'https:' && !(local && origin.protocol === 'http:'))) {
    throw new Error('Expected an https site URL that ends with /');
  }
  const files = await publishedFiles(root);
  const different = [], unavailable = [];
  await Promise.all(files.map(async file => {
    const expected = sha256(await readFile(path.join(root, file)));
    try {
      // A unique query keeps a CDN from answering with the previous deployment.
      const url = new URL(file.split('/').map(encodeURIComponent).join('/') + '?verify=' + stamp, origin);
      const response = await fetchImpl(url.href, { method: 'GET', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > MAX_BYTES) throw new Error('Too large');
      if (sha256(bytes) !== expected) different.push(file);
    } catch { unavailable.push(file); }
  }));
  return { base, files: files.length, different: different.sort(), unavailable: unavailable.sort(),
    published: !different.length && !unavailable.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const wait = args.indexOf('--wait');
  const seconds = wait < 0 ? 0 : Number(args.splice(wait, 2)[1]);
  if (args.length > 1 || !Number.isInteger(seconds) || seconds < 0 || seconds > 3600) {
    throw new Error('Usage: npm run rpg:verify-pages -- [site URL] [--wait <seconds>]');
  }
  const deadline = Date.now() + seconds * 1000;
  let report;
  for (;;) {
    report = await verifyPages({ base: args[0] ?? PUBLIC_URL });
    if (report.published || Date.now() >= deadline) break;
    await new Promise(resolve => setTimeout(resolve, 15000));
  }
  console.log(JSON.stringify(report, null, 2));
  if (!report.published) process.exitCode = 1;
}

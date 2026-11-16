// Measures a GLB against the catalog budgets and prints the request entries that register it.
// Reads local files only. It never contacts Meshy or any other service.
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as THREE from '../../vendor/three/three.module.js';
import { CONTENT_PATH, MAX_MODEL_BYTES, MAX_PACK_BYTES, applyOperations, parseCatalog } from '../../js/rpg-content.js';
import { assertCompatibleRig, rigProfile } from '../../js/motion-library.js';
import { loadGLB, readGLB } from '../meshy/glb.mjs';
import { budgetModel, checkCatalogAssets, sha256 } from './catalog-assets.mjs';

const round = value => Math.round(value * 1000) / 1000;
const slug = text => text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

export async function inspectAsset({ root = process.cwd(), file, id, model }) {
  const assetRoot = await realpath(path.join(root, 'assets'));
  const relative = path.relative(assetRoot, await realpath(path.resolve(root, file))).split(path.sep).join('/');
  if (relative.startsWith('..')) throw new Error('The GLB must be inside assets/models/');
  id ??= slug(path.basename(relative, '.glb'));
  const bytes = await readFile(path.join(assetRoot, relative));
  const { json, bin } = readGLB(bytes);
  const pack = !json.meshes?.length;
  const problems = [];
  const attempt = async (check) => { try { return await check(); } catch (error) { problems.push(error.message); } };
  const decoded = await loadGLB(bytes);
  const clips = decoded.animations.map(clip => ({ name: clip.name, duration: round(clip.duration) }));
  const bones = json.skins?.[0]?.joints.length ?? 0;
  const report = { file: relative, kind: pack ? 'motion-pack' : 'model', bytes: bytes.length, sha256: sha256(bytes), bones, clips };
  const catalog = parseCatalog(await readFile(path.join(root, CONTENT_PATH), 'utf8'));
  const changes = [];
  const used = new Set();
  const motion = (target, clip, extra) => {
    let name = (id + '-' + slug(clip)).slice(0, 48).replace(/-+$/, '');
    while (used.has(name)) name = name.slice(0, 45) + '-' + used.size;
    used.add(name);
    changes.push({ op: 'add', type: 'motions', id: name,
      value: { model: target, clip, loop: /idle|walk|run/i.test(clip), speed: 1, blend: .16, ...extra } });
  };

  if (pack) {
    if (bytes.length > MAX_PACK_BYTES) problems.push('Animation pack exceeds 2 MiB');
    if (json.images?.length) problems.push('Expected an animation-only GLB');
    if (!clips.length) problems.push('The file has no meshes and no animation clips');
    const base = catalog.models[model];
    if (base?.type !== 'glb' || !base.bones) problems.push('Name the rigged catalog model these clips belong to: --model <id>');
    else await attempt(async () => assertCompatibleRig(
      await rigProfile(await loadGLB(await readFile(path.join(assetRoot, base.file)))), await rigProfile(decoded)));
    for (const clip of clips) motion(model, clip.name, { file: relative, sha256: report.sha256 });
  } else {
    if (bytes.length > MAX_MODEL_BYTES) problems.push('Model exceeds 5 MiB');
    if ((json.skins?.length ?? 0) > 1) problems.push('Expected at most one skin');
    report.triangles = await attempt(() => budgetModel(json, bin));
    report.textures = json.images?.length ?? 0;
    // The game scales a model to its catalog height from this same bounding box (prepareModel in js/model-utils.js).
    decoded.scene.updateMatrixWorld(true);
    report.nativeHeight = round(new THREE.Box3().setFromObject(decoded.scene).getSize(new THREE.Vector3()).y);
    changes.push({ op: 'add', type: 'models', id, value: { type: 'glb', preset: 'scout', file: relative, sha256: report.sha256,
      height: Math.min(12, Math.max(.25, Math.round(report.nativeHeight * 100) / 100)), color: '#b8c0b0', bones } });
    if (bones) for (const clip of clips) motion(id, clip.name);
  }

  // The entries pass exactly what `npm run rpg:apply` and Game checks will run.
  report.request = { version: 1, summary: 'Register ' + relative, changes };
  if (!problems.length) await attempt(async () => checkCatalogAssets(root, applyOperations(catalog, report.request)));
  return { ...report, problems };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [file, ...rest] = process.argv.slice(2);
  const options = {};
  for (let i = 0; i < rest.length; i += 2) {
    if (!['--id', '--model'].includes(rest[i]) || !rest[i + 1]) options.invalid = true;
    else options[rest[i].slice(2)] = rest[i + 1];
  }
  if (!file || options.invalid) throw new Error('Usage: npm run rpg:asset -- <assets/models/file.glb> [--id <id>] [--model <rigged model id>]');
  const report = await inspectAsset({ file, ...options });
  console.log(JSON.stringify(report, null, 2));
  if (report.problems.length) process.exitCode = 1;
}

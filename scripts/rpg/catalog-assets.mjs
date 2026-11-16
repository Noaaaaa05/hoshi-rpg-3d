import { readFile, realpath, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { MAX_MODEL_BYTES, MAX_PACK_BYTES, validateCatalog } from '../../js/rpg-content.js';
import { assertCompatibleRig, rigProfile } from '../../js/motion-library.js';
import { loadGLB, readGLB } from '../meshy/glb.mjs';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function budgetModel(json, bytes) {
  let triangles = 0;
  if (!json.meshes?.length || json.meshes.length > 8) throw new Error('Expected 1–8 meshes');
  for (const mesh of json.meshes) for (const primitive of mesh.primitives) {
    const vertices = json.accessors?.[primitive.indices ?? primitive.attributes.POSITION]?.count;
    if ((primitive.mode ?? 4) !== 4 || !Number.isInteger(vertices) || vertices < 3 || vertices % 3) {
      throw new Error('Triangle primitives with usable geometry required');
    }
    triangles += vertices / 3;
  }
  if (triangles > 15000) throw new Error('Model exceeds 15,000 triangles');
  if ((json.images?.length ?? 0) > 4) throw new Error('Model exceeds four embedded textures');
  for (const image of json.images ?? []) {
    const view = json.bufferViews?.[image.bufferView];
    if (image.uri || !view || view.buffer !== 0 || !['image/png', 'image/jpeg'].includes(image.mimeType)) {
      throw new Error('Embed PNG or JPEG textures in the GLB');
    }
    const start = view.byteOffset ?? 0;
    const end = start + view.byteLength;
    if (start < 0 || start >= end || end > bytes.length) throw new Error('Invalid embedded texture bounds');
    const [width, height] = textureDimensions(bytes.subarray(start, end), image.mimeType);
    if (!(width > 0 && height > 0 && width <= 2048 && height <= 2048)) throw new Error('Invalid texture or texture exceeds 2048 px');
  }
  return triangles;
}

function textureDimensions(bytes, mime) {
  if (mime === 'image/png' && bytes.length >= 24 &&
      bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) && bytes.toString('ascii', 12, 16) === 'IHDR') {
    return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
  }
  if (mime === 'image/jpeg' && bytes.length >= 12 && bytes.readUInt16BE(0) === 0xffd8) {
    let offset = 2;
    while (offset + 9 <= bytes.length && bytes[offset] === 0xff) {
      const marker = bytes[offset + 1], length = bytes.readUInt16BE(offset + 2);
      if (length < 2 || offset + 2 + length > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2].includes(marker) && length >= 8) return [bytes.readUInt16BE(offset + 7), bytes.readUInt16BE(offset + 5)];
      if (marker === 0xda || marker === 0xd9) break;
      offset += 2 + length;
    }
  }
  return [0, 0];
}

export async function checkCatalogAssets(root, catalog) {
  validateCatalog(catalog);
  const assetRoot = await realpath(path.join(root, 'assets'));
  const models = new Map(), packs = new Map();
  async function asset(spec, max) {
    const name = await realpath(path.join(assetRoot, spec.file));
    if (!name.startsWith(assetRoot + path.sep)) throw new Error('Asset resolves outside the game asset directory');
    const info = await stat(name);
    if (!info.isFile() || info.size > max) throw new Error('Asset exceeds its size limit: ' + spec.file);
    const bytes = await readFile(name);
    if (bytes.length > max || sha256(bytes) !== spec.sha256) throw new Error('Asset checksum differs: ' + spec.file);
    const data = readGLB(bytes);
    return { ...data, decoded: await loadGLB(bytes) };
  }
  for (const [id, spec] of Object.entries(catalog.models)) {
    if (spec.type === 'procedural') continue;
    const { json, bin, decoded } = await asset(spec, MAX_MODEL_BYTES);
    const bones = json.skins?.[0]?.joints.length ?? 0;
    if (bones !== spec.bones || (json.skins?.length ?? 0) !== (bones ? 1 : 0)) throw new Error(id + ': unexpected skeleton');
    const triangles = budgetModel(json, bin);
    models.set(id, { decoded, triangles, bytes:json.buffers[0].byteLength, profile: bones ? await rigProfile(decoded) : null });
  }
  for (const [id, spec] of Object.entries(catalog.motions)) {
    const model = models.get(spec.model);
    let decoded = model.decoded;
    if (spec.file) {
      const key = spec.file + ':' + spec.sha256;
      if (!packs.has(key)) {
        const pack = await asset(spec, MAX_PACK_BYTES);
        if (pack.json.meshes?.length || pack.json.images?.length) throw new Error(id + ': expected an animation-only GLB');
        packs.set(key, { decoded: pack.decoded, profile: await rigProfile(pack.decoded) });
      }
      const pack = packs.get(key);
      assertCompatibleRig(model.profile, pack.profile);
      decoded = pack.decoded;
    }
    const clip = decoded.animations.find(animation => animation.name === spec.clip);
    if (!clip || !Number.isFinite(clip.duration) || clip.duration <= 0 || clip.duration > 30 ||
        (spec.range && spec.range[1] > clip.duration + .000001) ||
        !clip.tracks.length || clip.tracks.some(track =>
          !Array.from(track.times).every(Number.isFinite) || !Array.from(track.values).every(Number.isFinite))) {
      throw new Error(id + ': unknown clip, invalid tracks or playback range outside the clip');
    }
  }
  // Limit the additional dynamic geometry even when actors share a GLB.
  let sceneTriangles = 0;
  const usedModels = new Set();
  for (const placement of Object.values(catalog.placements)) {
    const model = placement.model ?? catalog.actors[placement.actor].model;
    usedModels.add(model);
    sceneTriangles += models.get(model)?.triangles ?? 600;
  }
  const modelBytes = [...usedModels].reduce((total, model) => total + (models.get(model)?.bytes ?? 0), 0);
  if (modelBytes > 12 * 1024 * 1024) throw new Error('Placements exceed the loaded model byte budget');
  if (sceneTriangles > 120000) throw new Error('Placements exceed the additional scene triangle budget');
  return { glbModels: models.size, packs: packs.size, sceneTriangles };
}

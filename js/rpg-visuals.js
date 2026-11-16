import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';
import { CONTENT_PATH, MAX_CATALOG_BYTES, MAX_MODEL_BYTES, MAX_PACK_BYTES, parseCatalog } from './rpg-content.js';
import { prepareModel, trimClip } from './model-utils.js?v=0.2.6';
import { assertCompatibleRig, rigProfile } from './motion-library.js?v=0.2.6';

const base = new URL('../assets/', import.meta.url);

async function boundedFile(url, size, check) {
  const abort = new AbortController(), timeout = setTimeout(() => abort.abort(), 9000);
  try {
    const response = await fetch(url, { signal: abort.signal, cache: 'no-cache', redirect: 'error' });
    if (!response.ok || !response.body || Number(response.headers.get('content-length')) > size) throw new Error('Asset unavailable or too large');
    const reader = response.body.getReader(), parts = [];
    let length = 0;
    try {
      for (;;) {
        const {value, done} = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > size) throw new Error('Asset exceeds its size limit');
        parts.push(value);
      }
    } finally { await reader.cancel().catch(() => {}); }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) { bytes.set(part, offset); offset += part.byteLength; }
    if (check) {
      const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
      if (Array.from(digest, value => value.toString(16).padStart(2, '0')).join('') !== check) throw new Error('Asset checksum changed');
    }
    return bytes;
  } finally { clearTimeout(timeout); }
}

export async function loadRpgCatalog(onWarning = console.warn) {
  try {
    const path = new URL('../' + CONTENT_PATH, import.meta.url);
    return parseCatalog(new TextDecoder().decode(await boundedFile(path, MAX_CATALOG_BYTES)));
  } catch {
    onWarning('追加コンテンツを読み込めませんでした。');
    return null;
  }
}

export function createRpgVisuals(catalog, warn = console.warn) {
  const loader = new GLTFLoader(), models = new Map(), packs = new Map();
  const palette = new Map();
  const cube = new THREE.BoxGeometry(1, 1, 1);
  const sphere = new THREE.IcosahedronGeometry(1, 1);
  const spike = new THREE.ConeGeometry(1, 1, 4);
  const wood = new THREE.MeshStandardMaterial({ color:'#746052', flatShading:true, roughness:1 });
  const skin = new THREE.MeshStandardMaterial({ color:'#dfb89e', flatShading:true, roughness:1 });

  function procedural(spec) {
    const group = new THREE.Group();
    if (!palette.has(spec.color)) palette.set(spec.color, new THREE.MeshStandardMaterial({color:spec.color, flatShading:true, roughness:.85}));
    const color = palette.get(spec.color);
    const part = (geometry, material, x, y, z, sx, sy, sz) => {
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(x, y, z);
      mesh.scale.set(sx, sy, sz);
      group.add(mesh);
      return mesh;
    };
    if (spec.preset === 'cottage') {
      part(cube, wood, 0,.38,0,1.15,.76,.85);
      part(spike, color, 0,.80,0,.87,.40,.87).rotation.y = Math.PI / 4;
    } else if (spec.preset === 'beacon') {
      part(cube, wood, 0,.06,0,.52,.12,.52);
      part(cube, wood, 0,.44,0,.18,.76,.18);
      part(sphere, color, 0,.84,0,.25,.15,.25);
    } else if (spec.preset === 'slime') {
      part(sphere, color, 0,.45,0,.62,.45,.55);
      for (const x of [-.18,.18]) part(sphere, wood, x,.54,.49,.055,.07,.04);
    } else {
      part(cube, color, 0,.48,0,.31,.53,.19);
      part(sphere, spec.preset === 'goblin' ? color : skin, 0,.78,0,.19,.19,.19);
      part(spike, color, 0,.90,0,.21,.18,.21).rotation.y = Math.PI / 4;
      for (const x of [-.11,.11]) part(cube, wood, x,.12,0,.12,.24,.14);
    }
    group.scale.setScalar(spec.height);
    return group;
  }

  async function parseModel(spec, isPack) {
    const bytes = await boundedFile(new URL(spec.file, base), isPack ? MAX_PACK_BYTES : MAX_MODEL_BYTES, spec.sha256);
    const view = new DataView(bytes.buffer);
    if (bytes.length < 28 || view.getUint32(0,true) !== 0x46546c67 || view.getUint32(4,true) !== 2 ||
        view.getUint32(8,true) !== bytes.length || view.getUint32(16,true) !== 0x4e4f534a ||
        view.getUint32(12,true) + 20 > bytes.length) throw new Error('Expected GLB version 2');
    const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + view.getUint32(12,true))));
    if (json.buffers?.some(buffer => buffer.uri) || json.images?.some(image => image.uri) || json.extensionsRequired?.length ||
        (isPack && (json.meshes?.length || json.images?.length))) throw new Error('Expected a self-contained GLB');
    return loader.parseAsync(bytes.buffer, '');
  }

  async function model(id) {
    const spec = catalog.models[id];
    if (spec.type === 'procedural') return { group: procedural(spec), gltf: null };
    try {
      if (!models.has(id)) models.set(id, (async () => {
        const gltf = await parseModel(spec, false);
        const profile = spec.bones ? await rigProfile(gltf) : null;
        if ((profile?.bones.length ?? 0) !== spec.bones) throw new Error('Skeleton count changed');
        const {wrapper} = prepareModel(gltf, {height:spec.height, fallbackColor:spec.color});
        return {gltf, profile, wrapper};
      })());
      const loaded = await models.get(id);
      return { ...loaded, group: cloneSkeleton(loaded.wrapper) };
    } catch {
      warn('追加モデルの代替表示を使用しました。');
      return { group: procedural(spec), gltf:null };
    }
  }

  async function create(id, states = {}) {
    const visual = await model(id);
    const root = new THREE.Group();
    visual.group.rotation.y = catalog.models[id].rotationY ?? 0;
    root.add(visual.group);
    if (!visual.gltf || !Object.keys(states).length) return { group:root, animate() {} };
    const mixer = new THREE.AnimationMixer(visual.group);
    const actions = {};
    await Promise.all(Object.entries(states).map(async ([state, motion]) => {
      try {
        const spec = catalog.motions[motion];
        let gltf = visual.gltf;
        if (spec.file) {
          const key = spec.file + ':' + spec.sha256;
          if (!packs.has(key)) packs.set(key, parseModel(spec, true));
          gltf = await packs.get(key);
          assertCompatibleRig(visual.profile, await rigProfile(gltf));
        }
        const clip = gltf.animations.find(value => value.name === spec.clip);
        if (!clip || (spec.range && spec.range[1] > clip.duration + .000001)) throw new Error('Motion clip unavailable');
        const action = mixer.clipAction(trimClip(clip, spec.range));
        if (!spec.loop) { action.setLoop(THREE.LoopOnce, 1); action.clampWhenFinished = true; }
        action.setEffectiveTimeScale(spec.speed);
        actions[state] = {action, blend:spec.blend};
      } catch { warn('追加モーションを読み込めませんでした。'); }
    }));
    let active;
    return {
      group: root,
      animate(state, dt) {
        const next = actions[state] ?? actions.idle;
        if (next !== active) {
          active?.action.fadeOut(next?.blend ?? active.blend);
          if (next) next.action.reset().fadeIn(next.blend).play();
          active = next;
        }
        mixer.update(dt);
      }
    };
  }

  return {create};
}

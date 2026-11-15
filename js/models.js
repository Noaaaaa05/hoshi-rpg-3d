import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { heightAt } from './physics.js';

// Keep URLs relative to this manifest, so GitHub Pages project paths work.
export async function loadModels(scene, player, grid, onWarning = console.warn, monsters = null) {
  const manifestURL = new URL('../assets/models/manifest.json', import.meta.url);
  const response = await fetch(manifestURL);
  if (!response.ok) throw new Error(`Model manifest: HTTP ${response.status}`);
  const manifest = await response.json();
  const loader = new GLTFLoader();
  const mixers = [];
  async function load(spec) {
    if (!spec || typeof spec.url !== 'string') throw new Error('モデルの url を指定してください');
    const gltf = await loader.loadAsync(new URL(spec.url, manifestURL).href);
    const root = gltf.scene;
    root.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(root), size = bounds.getSize(new THREE.Vector3());
    const scale = Number.isFinite(spec.height) && spec.height > 0 ? spec.height / Math.max(.001, size.y) : 1;
    const center = bounds.getCenter(new THREE.Vector3());
    root.scale.multiplyScalar(scale);
    root.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale);
    const wrapper = new THREE.Group(); wrapper.add(root);
    wrapper.rotation.y = Number.isFinite(spec.rotationY) ? spec.rotationY : 0;
    return { gltf, wrapper };
  }
  if (manifest.player) {
    try {
      const { gltf, wrapper } = await load(manifest.player);
      player.replaceVisual(wrapper);
      const mixer = new THREE.AnimationMixer(gltf.scene);
      const animationMap = manifest.player.animations || {};
      const actions = {};
      for (const state of ['idle', 'walk', 'run', 'jump', 'attack', 'dodge']) {
        const clip = THREE.AnimationClip.findByName(gltf.animations, animationMap[state] || state);
        if (clip) actions[state] = mixer.clipAction(clip);
      }
      let active = null;
      player.animateModel = (dt, motor, combat) => {
        const next = combat?.dodging ? actions.dodge || actions.run || actions.walk : combat?.attacking ? actions.attack || actions.idle : !motor.grounded ? actions.jump : motor.speed > .2 ? (motor.dashing ? actions.run || actions.walk : actions.walk) : actions.idle;
        if (next !== active) { active?.fadeOut(.18); next?.reset().fadeIn(.18).play(); active = next; }
        mixer.update(dt);
      };
    } catch (error) { onWarning('主人公GLBの読み込みに失敗。簡易モデルを使用します。', error); }
  }
  for (const type of ['slime', 'goblin']) {
    const spec = manifest.monsters?.[type];
    if (!spec || !monsters) continue;
    try {
      const { gltf, wrapper } = await load(spec);
      monsters.replaceVisual(type, wrapper, gltf.animations, spec.animations);
    } catch (error) { onWarning(`${type} のGLBを読み込めず、簡易モンスターを使用します。`, error); }
  }
  for (const spec of Array.isArray(manifest.objects) ? manifest.objects : []) {
    try {
      if (!Number.isFinite(spec.x) || !Number.isFinite(spec.z)) throw new Error('x, z は数値で指定してください');
      const { gltf, wrapper } = await load(spec);
      wrapper.position.set(spec.x, heightAt(spec.x, spec.z) + (Number.isFinite(spec.yOffset) ? spec.yOffset : 0), spec.z);
      scene.add(wrapper);
      if (Number.isFinite(spec.colliderRadius) && spec.colliderRadius > 0) grid.add({ x: spec.x, z: spec.z, radius: spec.colliderRadius, height: spec.height || 5 });
      if (gltf.animations.length) { const mixer = new THREE.AnimationMixer(gltf.scene); mixer.clipAction(gltf.animations[0]).play(); mixers.push(mixer); }
    } catch (error) { onWarning('追加GLBの読み込みに失敗。該当モデルをスキップします。', error); }
  }
  return dt => { for (const mixer of mixers) mixer.update(dt); };
}

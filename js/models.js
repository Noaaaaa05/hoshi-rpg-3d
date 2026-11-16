import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { heightAt } from './physics.js';
import { prepareModel, createPlayerAnimator, createFootGrounding, attachSword } from './model-utils.js?v=0.2.6';
import { loadMotionLibrary } from './motion-library.js?v=0.2.3';

// Keep URLs relative to this manifest, so GitHub Pages project paths work.
export async function loadModels(scene, player, grid, onWarning = console.warn, monsters = null) {
  const manifestURL = new URL('../assets/models/manifest.json?v=0.2.6', import.meta.url);
  const response = await fetch(manifestURL);
  if (!response.ok) throw new Error(`Model manifest: HTTP ${response.status}`);
  const manifest = await response.json();
  const loader = new GLTFLoader();
  const mixers = [];
  async function load(spec) {
    if (!spec || typeof spec.url !== 'string') throw new Error('モデルの url を指定してください');
    const url = new URL(spec.url, manifestURL), controller = new AbortController();
    let timeout;
    try {
      const gltf = await Promise.race([
        (async()=>{
          const response=await fetch(url,{signal:controller.signal});
          if(!response.ok)throw new Error(`GLB: HTTP ${response.status}`);
          return loader.parseAsync(await response.arrayBuffer(),new URL('.',url).href);
        })(),
        new Promise((_,reject)=>{timeout=setTimeout(()=>{controller.abort();reject(new Error('GLBの読み込みが時間切れになりました'));},12000);})
      ]);
      return {gltf,...prepareModel(gltf,spec)};
    } finally { clearTimeout(timeout); }
  }
  if (manifest.player) {
    try {
      const { gltf, wrapper, info } = await load(manifest.player);
      const library=await loadMotionLibrary(gltf,manifest.player.motionLibrary,loader,manifestURL,onWarning);
      const animator = createPlayerAnimator(gltf.scene,[...gltf.animations,...library.clips],{...manifest.player.animations,...library.mapping},manifest.player.animationOptions);
      const grounding = manifest.player.animationOptions?.grounding ? createFootGrounding(wrapper,manifest.player.footOffset||0,!!library.mapping.roll) : null;
      const weapon = attachSword(gltf.scene,manifest.player.weapon);
      // Install only after transforms/materials/animations have all been validated.
      player.replaceVisual(wrapper,{...info,mode:animator?'animated':'static',states:animator?.clips || {},weapon,motionStates:Object.keys(library.mapping),rejectedMotions:library.rejected,
        missingStates:['idle','walk','run','attack','jump','dodge'].filter(state=>!animator?.clips[state])});
      let poseReady=false;
      player.animateModel = animator ? (dt,motor,combat)=>{
        if(dt===0&&poseReady)return;
        animator.update(dt,motor,combat);if(!combat?.dodging)grounding?.update(animator.state);poseReady=true;
      } : null;
      const poseBone=weapon?gltf.scene.getObjectByName(weapon.bone):null;
      player.animationStatus = ()=>({animation:animator?.getStatus()||null,grounding:grounding?.getStatus()||null,boneQuaternion:poseBone?.quaternion.toArray()||null});
    } catch (error) { player.restoreVisual(); onWarning('主人公GLBの読み込みに失敗。簡易モデルを使用します。', error); }
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

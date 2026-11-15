// This relative import also makes model transforms/animation testable in Node.
import * as THREE from '../vendor/three/three.module.js';

export const PLAYER_STATES = ['idle', 'walk', 'run', 'attack', 'jump', 'dodge'];
const ALIASES = {idle:['idle'],walk:['walk','walking'],run:['run','running'],attack:['attack'],jump:['jump'],dodge:['dodge']};
const key = name => String(name).split(/[|:]/).pop().replace(/[ _-]/g,'').toLowerCase();

export function prepareModel(gltf, spec = {}) {
  if (!gltf?.scene?.isObject3D) throw new Error('GLBに表示可能なシーンがありません');
  const rotationY = Number.isFinite(spec.rotationY) ? spec.rotationY : 0;
  const orientation = new THREE.Group(); orientation.rotation.y = rotationY; orientation.add(gltf.scene);
  orientation.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(orientation), size = bounds.getSize(new THREE.Vector3());
  if (bounds.isEmpty() || ![...bounds.min,...bounds.max].every(Number.isFinite) || size.y < .00001) {
    throw new Error('GLBの大きさを計測できません');
  }
  const height = Number.isFinite(spec.height) && spec.height > 0 ? spec.height : size.y;
  const scale = height / size.y, center = bounds.getCenter(new THREE.Vector3());
  const footOffset = Number.isFinite(spec.footOffset) ? spec.footOffset : 0;
  // Translate a parent, preserving the GLB's own node transforms and animation bindings.
  const fit = new THREE.Group(); fit.add(orientation); fit.scale.setScalar(scale);
  fit.position.set(-center.x*scale,-bounds.min.y*scale+footOffset,-center.z*scale);
  const wrapper = new THREE.Group(); wrapper.add(fit); wrapper.updateMatrixWorld(true);
  const fitted = new THREE.Box3().setFromObject(wrapper), fittedSize = fitted.getSize(new THREE.Vector3());
  let meshes=0,skinnedMeshes=0,bones=0,triangles=0,morphTargets=0;
  let neutralMaterial = null;
  if (spec.fallbackColor && gltf.parser?.json && !gltf.parser.json.materials?.length) {
    if (!/^#[\da-f]{6}$/i.test(spec.fallbackColor)) throw new Error('fallbackColorは#RRGGBBで指定してください');
    neutralMaterial = new THREE.MeshStandardMaterial({color:spec.fallbackColor,metalness:0,roughness:.95});
  }
  gltf.scene.traverse(object => {
    if (object.isBone) bones++;
    if (!object.isMesh) return;
    meshes++; if (object.isSkinnedMesh) skinnedMeshes++;
    const geometry=object.geometry;
    triangles+=Math.floor((geometry.index?.count || geometry.attributes.position?.count || 0)/3);
    morphTargets+=geometry.morphAttributes.position?.length || 0;
    if (neutralMaterial) object.material=neutralMaterial;
    object.castShadow=false; object.receiveShadow=false;
  });
  return {wrapper, info:{loaded:true,type:'glb',url:spec.url,source:spec.source||spec.url,
    meshes,skinnedMeshes,bones,triangles,morphTargets,height:fittedSize.y,width:fittedSize.x,depth:fittedSize.z,
    minY:fitted.min.y,rotationY,scale,clips:(gltf.animations||[]).map(clip=>clip.name)}};
}

export function createPlayerAnimator(root, clips = [], mapping = {}) {
  mapping = mapping && typeof mapping === 'object' ? mapping : {};
  const resolved = {};
  for (const state of PLAYER_STATES) {
    const names = typeof mapping[state] === 'string' ? [mapping[state]] : ALIASES[state];
    const clip = clips.find(clip=>names.some(name=>key(clip.name)===key(name)));
    if (clip) resolved[state]=clip;
  }
  // A static Meshy model has no mixer, no synthetic bone motion and no deformation.
  if (!Object.keys(resolved).length) return null;
  const mixer=new THREE.AnimationMixer(root),actions={};
  for (const [state,clip] of Object.entries(resolved)) {
    actions[state]=mixer.clipAction(clip);
    if (['attack','jump','dodge'].includes(state)) {actions[state].setLoop(THREE.LoopOnce,1);actions[state].clampWhenFinished=true;}
  }
  let active=null,state=null,previousAttackPhase=0;
  return {
    get state() { return state; },
    clips:Object.fromEntries(Object.entries(resolved).map(([state,clip])=>[state,clip.name])),
    update(dt,motor,combat) {
      const movement=motor.speed>.2?(motor.dashing?'run':'walk'):'idle';
      state=combat?.dodging?'dodge':combat?.attacking?'attack':!motor.grounded?'jump':movement;
      const action=actions[state] || (state==='run'?actions.walk:null) || actions.idle || null;
      const repeatAttack=state==='attack' && action===actions.attack && combat.attackPhase<previousAttackPhase;
      if (action!==active || repeatAttack) {
        if (active && action!==active) active.fadeOut(.12);
        action?.reset().fadeIn(.12).play(); active=action;
        if (state==='attack' && action===actions.attack) action.setEffectiveTimeScale(resolved.attack.duration/(combat.attackDuration || .52));
      }
      previousAttackPhase=state==='attack'?combat.attackPhase:0;
      mixer.update(Math.max(0,dt));
    }
  };
}

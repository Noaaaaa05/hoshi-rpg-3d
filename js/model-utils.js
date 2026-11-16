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

function trimClip(clip,range) {
  if(!Array.isArray(range)||range.length!==2)return clip.clone().optimize();
  const start=Math.max(0,range[0]),end=Math.min(clip.duration,range[1]);
  if(!Number.isFinite(start)||!Number.isFinite(end)||end<=start)throw new Error('アニメーション範囲が不正です');
  const tracks=clip.tracks.map(track=>{
    const size=track.getValueSize(),interpolant=track.createInterpolant(),times=[0],values=Array.from(interpolant.evaluate(start));
    for(let i=0;i<track.times.length;i++)if(track.times[i]>start&&track.times[i]<end){times.push(track.times[i]-start);for(let j=0;j<size;j++)values.push(track.values[i*size+j]);}
    times.push(end-start);values.push(...interpolant.evaluate(end));
    return new track.constructor(track.name,times,values,track.getInterpolation());
  });
  return new THREE.AnimationClip(clip.name,end-start,tracks).optimize();
}

export function createPlayerAnimator(root, clips = [], mapping = {}, options = {}) {
  mapping = mapping && typeof mapping === 'object' ? mapping : {};
  const resolved = {};
  for (const state of PLAYER_STATES) {
    const names = typeof mapping[state] === 'string' ? [mapping[state]] : ALIASES[state];
    const clip = clips.find(clip=>names.some(name=>key(clip.name)===key(name)));
    if (clip) resolved[state]=trimClip(clip,state==='attack'?options.attackRange:null);
  }
  // A static Meshy model has no mixer, no synthetic bone motion and no deformation.
  if (!Object.keys(resolved).length) return null;
  const mixer=new THREE.AnimationMixer(root),actions={};
  for (const [state,clip] of Object.entries(resolved)) {
    actions[state]=mixer.clipAction(clip);
    actions[state].setEffectiveWeight(0);
    if (['attack','jump','dodge'].includes(state)) {actions[state].setLoop(THREE.LoopOnce,1);actions[state].clampWhenFinished=true;}
  }
  const slots={...actions};
  if(resolved.attack){
    const alternate=mixer.clipAction(resolved.attack.clone());alternate.setEffectiveWeight(0).setLoop(THREE.LoopOnce,1);alternate.clampWhenFinished=true;
    slots.attackAlternate=alternate;
  }
  const attackSlots=[actions.attack,slots.attackAlternate].filter(Boolean);
  const fade=Number.isFinite(options.fadeDuration)?Math.max(.01,options.fadeDuration):.16;
  let active=null,state=null,previousAttackPhase=0,fadeTime=fade,fadeLength=fade,startWeights={};
  return {
    get state() { return state; },
    clips:Object.fromEntries(Object.entries(resolved).map(([state,clip])=>[state,clip.name])),
    getStatus() { return {state,clip:active?.getClip().name||null,time:active?.time||0,mixerTime:mixer.time,
      weights:Object.fromEntries(Object.entries(actions).map(([key,action])=>[key,action.getEffectiveWeight()+(key==='attack'?(slots.attackAlternate?.getEffectiveWeight()||0):0)])),
      durations:Object.fromEntries(Object.entries(resolved).map(([key,clip])=>[key,clip.duration]))}; },
    update(dt,motor,combat) {
      const movement=motor.speed>.2?(motor.dashing?'run':'walk'):'idle';
      state=combat?.dodging?'dodge':combat?.attacking?'attack':!motor.grounded?'jump':movement;
      let action=actions[state] || (state==='run'?actions.walk:null) || actions.idle || null;
      const repeatAttack=state==='attack' && actions.attack && attackSlots.includes(active) && combat.attackPhase<previousAttackPhase;
      if(state==='attack'&&actions.attack&&attackSlots.includes(active))action=repeatAttack?attackSlots.find(a=>a!==active):active;
      if (action!==active || repeatAttack) {
        const initial=!active;
        if(action!==active){
          startWeights=Object.fromEntries(Object.entries(slots).map(([key,a])=>[key,a.getEffectiveWeight()]));
          fadeLength=repeatAttack?Math.min(.08,fade):fade;fadeTime=initial?fadeLength:0;
        }
        if(action && (repeatAttack || !action.isRunning() || action.getEffectiveWeight()<.001))action.reset().play();
        active=action;
        if (state==='attack' && attackSlots.includes(action)) action.setEffectiveTimeScale(resolved.attack.duration/(combat.attackDuration || .52));
      }
      fadeTime=Math.min(fadeLength,fadeTime+Math.max(0,dt));
      const blend=fadeTime/fadeLength;
      for(const [key,a] of Object.entries(slots)){
        a.setEffectiveWeight((startWeights[key]||0)*(1-blend)+(a===active?blend:0));
        if(blend===1&&a!==active&&a.isRunning())a.stop();
      }
      if(action===actions.walk)action.setEffectiveTimeScale(THREE.MathUtils.clamp(motor.speed/(options.walkReferenceSpeed||4.1),.55,1.35));
      if(action===actions.run)action.setEffectiveTimeScale(THREE.MathUtils.clamp(motor.speed/(options.runReferenceSpeed||8),.55,1.35));
      previousAttackPhase=state==='attack'?combat.attackPhase:0;
      mixer.update(Math.max(0,dt));
    }
  };
}

// Sample only a few sole vertices, not the whole animated mesh each frame.
// Correcting the parent height preserves the authored bone motion and leaves
// world movement, jump height and the gameplay collider under the motor's control.
export function createFootGrounding(wrapper,footOffset=0) {
  wrapper.updateMatrixWorld(true);
  const inverse=new THREE.Matrix4().copy(wrapper.matrixWorld).invert(),relative=new THREE.Matrix4(),point=new THREE.Vector3();
  const meshes=[];
  wrapper.traverse(mesh=>{
    if(!mesh.isSkinnedMesh)return;
    const positions=mesh.geometry.attributes.position,skin=mesh.geometry.attributes.skinIndex,weights=mesh.geometry.attributes.skinWeight;
    const candidates=[];let minY=Infinity,maxY=-Infinity;
    relative.multiplyMatrices(inverse,mesh.matrixWorld);
    for(let i=0;i<positions.count;i++){
      mesh.getVertexPosition(i,point).applyMatrix4(relative);minY=Math.min(minY,point.y);maxY=Math.max(maxY,point.y);
      const footWeight=[0,1,2,3].reduce((sum,k)=>sum+(/foot|toebase/i.test(mesh.skeleton.bones[skin.getComponent(i,k)]?.name||'')?weights.getComponent(i,k):0),0);
      if(footWeight>.35)candidates.push({index:i,x:point.x,y:point.y,z:point.z});
    }
    const band=candidates.filter(v=>v.y<minY+(maxY-minY)*.035),samples=new Set();
    // The uploaded mesh has about 220 sole vertices: evaluate them exactly.
    // Bound work on future, denser rigs to at most 128 samples per foot.
    for(const side of [-1,1]){
      const foot=band.filter(v=>v.x*side>=0);if(!foot.length)continue;
      const selected=new Set();
      for(const axis of ['x','y','z'])for(const sign of [-1,1])selected.add(foot.reduce((a,b)=>a[axis]*sign<b[axis]*sign?a:b).index);
      for(let i=0;i<Math.min(128,foot.length)&&selected.size<128;i++)selected.add(foot[Math.floor(i*foot.length/Math.min(128,foot.length))].index);
      for(const index of selected)samples.add(index);
    }
    if(samples.size)meshes.push({mesh,indices:[...samples]});
  });
  if(!meshes.length)return null;
  const fit=wrapper.children[0];let minFootY=0,lastCorrection=0;
  return {
    getStatus(){return {minFootY,lastCorrection,samples:meshes.reduce((n,m)=>n+m.indices.length,0)};},
    update(){
      wrapper.parent?.updateWorldMatrix(true,false);
      // SkinnedMesh.updateMatrixWorld refreshes its bindMatrixInverse; calling
      // only Object3D.updateWorldMatrix would count the actor translation twice.
      wrapper.updateMatrixWorld(true);inverse.copy(wrapper.matrixWorld).invert();minFootY=Infinity;
      for(const {mesh,indices} of meshes){
        relative.multiplyMatrices(inverse,mesh.matrixWorld);
        for(const index of indices){mesh.getVertexPosition(index,point).applyMatrix4(relative);minFootY=Math.min(minFootY,point.y);}
      }
      if(!Number.isFinite(minFootY))return;
      lastCorrection=footOffset-minFootY;fit.position.y+=lastCorrection;minFootY+=lastCorrection;
      wrapper.updateMatrixWorld(true);
    }
  };
}

export function attachSword(root,spec) {
  if(!spec)return null;
  const wanted=String(spec.bone||'mixamorigRightHand').replace(/[^a-z0-9]/gi,'').toLowerCase();let bone=null;
  root.traverse(node=>{if(node.isBone&&node.name.replace(/[^a-z0-9]/gi,'').toLowerCase()===wanted)bone=node;});
  if(!bone)throw new Error('剣を取り付ける手のボーンがありません');
  const sword=new THREE.Group();sword.name='HeroSword';
  sword.position.fromArray(spec.position||[0,.06,0]);
  const direction=new THREE.Vector3().fromArray(spec.direction||[1,0,0]).normalize();
  sword.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),direction);
  const metal=new THREE.MeshStandardMaterial({color:'#d9e2d8',metalness:.35,roughness:.55});
  const grip=new THREE.MeshStandardMaterial({color:'#776346',roughness:1});
  function add(geometry,material,y){const mesh=new THREE.Mesh(geometry,material);mesh.position.y=y;sword.add(mesh);}
  const length=spec.length||.78;
  add(new THREE.BoxGeometry(.055,length-.12,.025),metal,(length-.12)/2+.08);
  add(new THREE.ConeGeometry(.039,.12,4).rotateY(Math.PI/4),metal,length+.02);
  add(new THREE.BoxGeometry(.22,.045,.065),grip,.055);
  add(new THREE.CylinderGeometry(.026,.026,.18,6),grip,-.055);
  bone.add(sword);return {bone:bone.name,meshes:4,attached:true};
}

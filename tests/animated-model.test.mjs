import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from '../vendor/three/three.module.js';
import { GLTFLoader } from '../vendor/three/addons/loaders/GLTFLoader.js';
import { prepareModel,createPlayerAnimator,createFootGrounding,attachSword } from '../js/model-utils.js';

async function character(){
  const bytes=await readFile('assets/models/hero_animated.glb'),gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  const {player:spec}=JSON.parse(await readFile('assets/models/manifest.json','utf8'));
  const prepared=prepareModel(gltf,spec),grounding=createFootGrounding(prepared.wrapper),animator=createPlayerAnimator(gltf.scene,gltf.animations,spec.animations,spec.animationOptions);
  return {gltf,spec,...prepared,grounding,animator};
}
test('uploaded animated character has the four requested clips, a rig and a small mesh',async()=>{
  const {gltf,info}=await character();
  assert.deepEqual(gltf.animations.map(c=>c.name).sort(),['Attack','Idle_03','Running','Walking']);
  assert.equal(info.bones,66);assert.equal(info.skinnedMeshes,1);assert.equal(info.triangles,10112);assert.ok(Math.abs(info.height-1.9)<1e-5);
  assert.deepEqual(await readFile('assets/models/hero_animated.glb'),await readFile('assets/models/アニメモーション.glb'));
});
test('real clips deform the bones and keep both soles at the gameplay ground across transitions',async()=>{
  const {gltf,wrapper,grounding,animator}=await character();
  const actor=new THREE.Group();actor.position.set(11,3,-22);actor.rotation.y=.7;actor.add(wrapper);
  let mesh;gltf.scene.traverse(n=>{if(n.isSkinnedMesh)mesh=n;});
  const soles=[];for(let i=0;i<mesh.geometry.attributes.position.count;i++)if(mesh.geometry.attributes.position.getY(i)<.035)soles.push(i);
  const point=new THREE.Vector3(),inverse=new THREE.Matrix4(),matrix=new THREE.Matrix4(),motor={speed:0,dashing:false,grounded:true},combat={attacking:false,dodging:false,attackPhase:0,attackDuration:.52};
  const hand=gltf.scene.getObjectByName('mixamorigRightHand');let changed=false,previous=hand.quaternion.clone();
  for(const state of ['idle','walk','run','idle','attack','walk']){
    motor.speed=state==='walk'?4.1:state==='run'?8:0;motor.dashing=state==='run';combat.attacking=state==='attack';
    for(let i=0;i<90;i++){
      combat.attackPhase=state==='attack'?(i%31)/31:0;
      animator.update(1/60,motor,combat);grounding.update();
      inverse.copy(wrapper.matrixWorld).invert();matrix.multiplyMatrices(inverse,mesh.matrixWorld);
      let min=Infinity;for(const index of soles){mesh.getVertexPosition(index,point).applyMatrix4(matrix);min=Math.min(min,point.y);}
      assert.ok(min>=-.015&&min<.025,`${state} frame ${i}: sole ${min}`);
      if(hand.quaternion.angleTo(previous)>.001)changed=true;previous.copy(hand.quaternion);
      assert.ok(Object.values(animator.getStatus().weights).every(Number.isFinite));
      assert.ok(Math.abs(Object.values(animator.getStatus().weights).reduce((a,b)=>a+b,0)-1)<1e-5);
    }
    assert.equal(animator.state,state);
  }
  assert.equal(changed,true);assert.deepEqual(actor.position.toArray(),[11,3,-22]);assert.ok(grounding.getStatus().samples<=256);
});
test('authored sword strike stays at natural speed and the weapon follows the hand bone',async()=>{
  const {gltf,spec,animator,grounding}=await character();const weapon=attachSword(gltf.scene,spec.weapon);
  assert.equal(weapon.attached,true);assert.equal(weapon.bone,'mixamorigRightHand');
  const sword=gltf.scene.getObjectByName('HeroSword'),motor={speed:0,dashing:false,grounded:true},combat={attacking:true,attackDuration:.52,attackPhase:0};
  const start=new THREE.Vector3(),end=new THREE.Vector3();
  animator.update(0,motor,combat);grounding.update();sword.getWorldPosition(start);
  for(let i=0;i<20;i++){
    combat.attackPhase=i/31;animator.update(1/60,motor,combat);grounding.update();
    assert.ok(sword.localToWorld(new THREE.Vector3(0,.86,0)).y>-.08,'blade should swing above the ground');
  }
  sword.getWorldPosition(end);assert.ok(start.distanceTo(end)>.2);
  assert.ok(Math.abs(animator.getStatus().durations.attack-.52)<.0001);
  assert.ok(Math.abs(gltf.animations.find(c=>c.name==='Attack').duration-2.8)<.001);
  const before=animator.getStatus().time;animator.update(0,motor,combat);grounding.update();assert.equal(animator.getStatus().time,before);
});
test('rapid input changes and held attacks retain normalized blend weights',async()=>{
  const {gltf,animator,grounding}=await character(),motor={speed:0,dashing:false,grounded:true},combat={attacking:false,dodging:false,attackDuration:.52,attackPhase:0};
  for(let i=0;i<40;i++){
    motor.speed=i%3?4.1:0;motor.dashing=i%3===2;
    animator.update(1/60,motor,combat);grounding.update();
    assert.ok(Math.abs(Object.values(animator.getStatus().weights).reduce((a,b)=>a+b,0)-1)<1e-5);
  }
  combat.attacking=true;motor.speed=0;motor.dashing=false;
  const hand=gltf.scene.getObjectByName('mixamorigRightHand');
  for(let i=0;i<31;i++){combat.attackPhase=i/31;animator.update(1/60,motor,combat);grounding.update();}
  const before=hand.quaternion.clone();combat.attackPhase=0;
  animator.update(1/60,motor,combat);grounding.update();
  assert.ok(before.angleTo(hand.quaternion)<.8,'a repeated strike should blend rather than snap back');
});

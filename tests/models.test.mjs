import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as THREE from '../vendor/three/three.module.js';
import { prepareModel, createPlayerAnimator, PLAYER_STATES } from '../js/model-utils.js';

test('model fitting preserves authored transforms, centers rotated bounds and puts feet on the ground',()=>{
  const scene=new THREE.Group(),mesh=new THREE.Mesh(new THREE.BoxGeometry(2,4,1));
  scene.position.set(6,-3,2);scene.scale.set(2,1.5,.5);scene.add(mesh);mesh.position.set(2,1,0);
  const position=scene.position.clone(),scale=scene.scale.clone();
  const {wrapper,info}=prepareModel({scene,animations:[]},{height:1.9,rotationY:Math.PI/2});
  const bounds=new THREE.Box3().setFromObject(wrapper),center=bounds.getCenter(new THREE.Vector3());
  assert.ok(Math.abs(info.height-1.9)<1e-6);assert.ok(Math.abs(bounds.min.y)<1e-6);
  assert.ok(Math.abs(center.x)<1e-6&&Math.abs(center.z)<1e-6);
  assert.deepEqual(scene.position,position);assert.deepEqual(scene.scale,scale);
  assert.equal(info.bones,0);assert.equal(info.skinnedMeshes,0);assert.equal(info.triangles,12);
});
test('static models get no mixer or procedural deformation; invalid geometry is rejected',()=>{
  const scene=new THREE.Group(),mesh=new THREE.Mesh(new THREE.BoxGeometry(1,2,1));scene.add(mesh);
  const before=Array.from(mesh.geometry.attributes.position.array);
  assert.equal(createPlayerAnimator(scene,[],null),null);
  prepareModel({scene,animations:[]},{height:1.9});assert.deepEqual(Array.from(mesh.geometry.attributes.position.array),before);
  assert.throws(()=>prepareModel({scene:new THREE.Group()}),/計測/);
  assert.throws(()=>prepareModel({}),/シーン/);
});
test('six future animation states select authored clips and freeze at zero delta',()=>{
  const root=new THREE.Group();root.name='Hero';
  const clips=PLAYER_STATES.map((state,index)=>new THREE.AnimationClip(state[0].toUpperCase()+state.slice(1),1,[new THREE.NumberKeyframeTrack('.position[x]',[0,1],[0,index+1])]));
  const animator=createPlayerAnimator(root,clips),motor={speed:0,dashing:false,grounded:true},combat={attacking:false,dodging:false,attackPhase:.1,attackDuration:.52};
  for(const state of PLAYER_STATES){
    Object.assign(motor,{speed:['walk','run'].includes(state)?4:0,dashing:state==='run',grounded:state!=='jump'});
    Object.assign(combat,{attacking:state==='attack',dodging:state==='dodge'});
    animator.update(.2,motor,combat);assert.equal(animator.state,state);
  }
  const before=root.position.x;animator.update(0,motor,combat);assert.equal(root.position.x,before);
  assert.equal(Object.keys(animator.clips).length,6);
});
test('looping idle and repeated attacks restart the correct animation without inventing clips',()=>{
  const root=new THREE.Group(),clip=new THREE.AnimationClip('Sword_Slash',1,[new THREE.NumberKeyframeTrack('.position[x]',[0,1],[0,1])]);
  const animator=createPlayerAnimator(root,[clip],{attack:'Sword_Slash'}),motor={speed:0,grounded:true,dashing:false},combat={attacking:true,attackPhase:.2,attackDuration:.52};
  animator.update(.05,motor,combat);combat.attackPhase=.8;animator.update(.2,motor,combat);const late=root.position.x;
  combat.attackPhase=.05;animator.update(.01,motor,combat);assert.ok(root.position.x<late);
  assert.equal(createPlayerAnimator(new THREE.Group(),[clip],{attack:'Missing'}),null);
});

function readGLB(buffer) {
  assert.equal(buffer.readUInt32LE(0),0x46546c67);assert.equal(buffer.readUInt32LE(4),2);assert.equal(buffer.readUInt32LE(8),buffer.length);
  return JSON.parse(buffer.subarray(20,20+buffer.readUInt32LE(12)).toString('utf8'));
}
test('the uploaded hero and mobile derivative remain static, with a small render budget',async()=>{
  const sourceBytes=await readFile('assets/models/hero.glb'),mobileBytes=await readFile('assets/models/hero-mobile.glb');
  const source=readGLB(sourceBytes),mobile=readGLB(mobileBytes);
  for(const document of [source,mobile]){assert.equal(document.skins?.length||0,0);assert.equal(document.animations?.length||0,0);assert.equal(document.extensionsRequired?.length||0,0);}
  const triangles=document=>document.meshes.reduce((count,m)=>count+m.primitives.reduce((n,p)=>n+document.accessors[p.indices].count/3,0),0);
  assert.ok(triangles(mobile)<=15000);assert.ok(triangles(mobile)<triangles(source)*.15);assert.ok(mobileBytes.length<350000);
  const manifest=JSON.parse(await readFile('assets/models/manifest.json','utf8'));
  assert.equal(manifest.player.url,'./hero-mobile.glb');assert.equal(manifest.player.source,'./hero.glb');assert.equal(manifest.player.rotationY,0);
});

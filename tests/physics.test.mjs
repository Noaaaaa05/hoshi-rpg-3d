import test from 'node:test';
import assert from 'node:assert/strict';
import { CollisionGrid, PlayerMotor, cameraMovement, heightAt, WORLD_RADIUS } from '../js/physics.js';
import { loadSave, writeSave } from '../js/storage.js';
const input=(extra={})=>({x:0,y:0,dash:false,jump:false,...extra});
test('camera-relative movement supports every direction without diagonal speed gain',()=>{
  for(let a=0;a<Math.PI*2;a+=.1){const m=cameraMovement(Math.cos(a),Math.sin(a),.7);assert.ok(Math.abs(Math.hypot(m.x,m.z)-1)<1e-10);}
  const forward=cameraMovement(0,-1,Math.PI/2);assert.ok(forward.x<-.99&&Math.abs(forward.z)<.001);
  assert.equal(cameraMovement(.1,0,0).magnitude,.1);const diagonal=cameraMovement(1,1,0);assert.ok(Math.abs(Math.hypot(diagonal.x,diagonal.z)-1)<1e-10);
});
test('spatial grid finds colliders across cells and resolves exact-center overlap',()=>{
  const grid=new CollisionGrid();grid.add({x:7.9,z:0,radius:1});assert.equal(grid.query(8.3,0).size,1);
  const p=grid.resolve(7.9,0);assert.ok(Math.hypot(p.x-7.9,p.z)>=1.3799);
});
test('walking and dashing cannot tunnel through a tree; movement slides along it',()=>{
  const grid=new CollisionGrid();grid.add({x:0,z:0,radius:.7});const motor=new PlayerMotor(grid);motor.reset(0,3);
  for(let i=0;i<180;i++)motor.step(1/30,input({y:-1,dash:true}),0);
  assert.ok(motor.z>=1.0799);
  for(let i=0;i<90;i++)motor.step(1/60,input({x:1,y:-1}),0);
  assert.ok(motor.x>2);assert.ok(motor.z<1.08);
});
test('jump launches, consumes stamina once and lands on terrain',()=>{
  const motor=new PlayerMotor(new CollisionGrid());motor.step(1/60,input({jump:true}),0);
  assert.equal(motor.grounded,false);assert.equal(motor.stamina,88);let peak=motor.y;
  for(let i=0;i<100;i++){motor.step(1/60,input(),0);peak=Math.max(peak,motor.y);}
  assert.ok(peak>heightAt(motor.x,motor.z)+1);assert.equal(motor.grounded,true);assert.equal(motor.hp,100);
});
test('dash exhausts stamina, blocks repeat dashing and recovers',()=>{
  const motor=new PlayerMotor(new CollisionGrid());
  for(let i=0;i<235;i++)motor.step(1/60,input({y:-1,dash:true}),0);
  assert.equal(motor.exhausted,true);assert.equal(motor.dashing,false);assert.ok(motor.stamina>=0);
  for(let i=0;i<190;i++)motor.step(1/60,input(),0);
  assert.equal(motor.exhausted,false);assert.ok(motor.stamina>25);
});
test('movement respects circular boundary and caps long frame delta',()=>{
  const motor=new PlayerMotor(new CollisionGrid());motor.reset(WORLD_RADIUS-1,0);
  for(let i=0;i<200;i++)motor.step(1,input({x:1,dash:true}),0);
  assert.ok(Math.hypot(motor.x,motor.z)<=WORLD_RADIUS+.0001);
});
test('save validation removes corrupt positions and progress; denied storage remains playable',()=>{
  let value=null;globalThis.localStorage={getItem:()=>value,setItem:(_k,v)=>value=v};
  assert.equal(loadSave(),null);writeSave({position:{x:0,z:12},stars:[0,0,90],landmarks:['gate','invalid'],sensitivity:9,quality:'broken'});
  const saved=loadSave();assert.deepEqual(saved.stars,[0]);assert.deepEqual(saved.landmarks,['gate']);assert.equal(saved.sensitivity,1.8);assert.equal(saved.quality,'auto');
  value='{"version":1,"position":{"x":9999,"z":0}}';assert.equal(loadSave().position,null);
  globalThis.localStorage={getItem:()=>{throw Error('denied');},setItem:()=>{throw Error('denied');}};
  assert.equal(loadSave(),null);assert.equal(writeSave({}),false);delete globalThis.localStorage;
});

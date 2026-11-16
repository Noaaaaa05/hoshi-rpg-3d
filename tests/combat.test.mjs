import test from 'node:test';
import assert from 'node:assert/strict';
import { CollisionGrid, PlayerMotor } from '../js/physics.js';
import { CombatSystem, Progression, ENEMY_TYPES, xpForLevel } from '../js/combat.js';
import { loadSave, writeSave } from '../js/storage.js';
import { ROLL_DURATION } from '../js/motion-state.js';
const controls=(extra={})=>({x:0,y:0,dash:false,jump:false,attack:false,attackHeld:false,dodge:false,...extra});
function arena(spawns=[{type:'slime',x:20,z:-1.5}],saved) {
  const grid=new CollisionGrid(),motor=new PlayerMotor(grid);motor.reset(20,0);
  return {grid,motor,combat:new CombatSystem(motor,grid,saved,spawns)};
}
function advance(combat,seconds,input={}) { for(let i=0;i<Math.round(seconds*60);i++)combat.step(1/60,controls({...input,attack:input.attack&&i===0,dodge:input.dodge&&i===0}),0); }
test('combat wrapper preserves v0.1 walking, dash, jump and camera-relative motion exactly',()=>{
  const grid=new CollisionGrid();grid.add({x:0,z:0,radius:1});
  const original=new PlayerMotor(grid),wrapped=new PlayerMotor(grid),combat=new CombatSystem(wrapped,grid,undefined,[]);
  for(let i=0;i<1200;i++){
    const input=controls({x:Math.sin(i*.013),y:Math.cos(i*.017),dash:i%180<65,jump:i%120===0}),yaw=Math.sin(i*.003);
    original.step(1/60,input,yaw);combat.step(1/60,input,yaw);
    for(const property of ['x','y','z','vx','vz','vy','angle','stamina','grounded','dashing'])assert.equal(wrapped[property],original[property],`${property} at ${i}`);
  }
});
test('one swing hits each enemy once, and kills grant XP once with level-up HP/attack growth',()=>{
  const {combat,motor}=arena(undefined,{level:1,xp:30,kills:0});
  advance(combat,.7,{attack:true});assert.equal(combat.enemies[0].hp,16);assert.equal(combat.progression.kills,0);
  advance(combat,.7,{attack:true});assert.equal(combat.enemies[0].hp,0);assert.equal(combat.enemies[0].state,'dead');
  assert.equal(combat.progression.level,2);assert.equal(combat.progression.xp,8);assert.equal(combat.progression.maxHP,120);assert.equal(combat.progression.attack,22);assert.equal(motor.hp,120);
  advance(combat,2,{attackHeld:true});assert.equal(combat.progression.kills,1);assert.equal(combat.progression.xp,8);
});
test('attacks reject enemies behind, too far, or behind a tree',()=>{
  for(const spawn of [{type:'slime',x:20,z:2},{type:'slime',x:20,z:-12}]){
    const {combat}=arena([spawn]);advance(combat,.32,{attack:true});assert.equal(combat.enemies[0].hp,34);
  }
  const {combat,grid}=arena([{type:'slime',x:20,z:-2.2}]);grid.add({x:20,z:-1.1,radius:.4});
  advance(combat,.32,{attack:true});assert.equal(combat.enemies[0].hp,34);
});
test('goblin has distinct health, damage and XP and can be defeated',()=>{
  const {combat}=arena([{type:'goblin',x:20,z:-1.5}]);
  assert.equal(ENEMY_TYPES.goblin.damage,12);
  for(let i=0;i<4;i++)advance(combat,.7,{attack:true});
  assert.equal(combat.enemies[0].hp,0);assert.equal(combat.progression.kills,1);assert.equal(combat.progression.xp,30);
});
test('enemies roam, chase, telegraph attacks and return when the player leaves',()=>{
  const {combat,motor}=arena([{type:'goblin',x:20,z:-6}]);motor.reset(0,12);
  advance(combat,1);const e=combat.enemies[0];assert.ok(Math.hypot(e.x-20,e.z+6)>.05);assert.equal(e.state,'wander');
  motor.reset(20,0);advance(combat,.2);assert.equal(e.state,'chase');
  advance(combat,3);assert.ok(motor.hp<100);assert.ok(['windup','recover'].includes(e.state));
  motor.reset(70,60);advance(combat,.2);assert.equal(e.state,'recover'); // far-away AI sleeps, preserving work
  motor.reset(20,25);advance(combat,.1);assert.equal(e.state,'return');
});
test('simultaneous enemy strikes respect player damage invulnerability',()=>{
  const {combat,motor}=arena([{type:'slime',x:20,z:-1.5},{type:'slime',x:20.1,z:-1.5}]);
  advance(combat,.85);assert.equal(motor.hp,92);
});
test('leashed enemies return home instead of oscillating at the chase boundary',()=>{
  const {combat,motor}=arena();const e=combat.enemies[0];e.z=-19;e.state='chase';motor.reset(20,-21);
  advance(combat,.8);assert.equal(e.state,'return');assert.ok(e.z>-18);
});
test('dodge evades a telegraphed strike, costs stamina and cannot bypass obstacles or cooldown',()=>{
  const {combat,motor,grid}=arena();advance(combat,.45);assert.equal(combat.enemies[0].state,'windup');
  grid.add({x:21.2,z:0,radius:.35});
  advance(combat,.36,{x:1,dodge:true});assert.equal(motor.hp,100);assert.ok(motor.stamina<80);assert.ok(motor.x<20.48);
  const stamina=motor.stamina;combat.step(1/60,controls({dodge:true}),0);assert.ok(motor.stamina>=stamina);assert.equal(combat.dodging,false);
  motor.stamina=10;advance(combat,1);combat.step(1/60,controls({dodge:true}),0); // recovery can refill; explicit low stamina below
  combat.dodgeTime=0;combat.dodgeCooldown=0;motor.stamina=10;combat.step(1/60,controls({dodge:true}),0);assert.equal(combat.dodging,false);
});
test('the animated forward roll tracks a 3.6 m dodge and still resolves obstacles',()=>{
  const {combat,motor}=arena([]);
  combat.rollMotionAvailable=true;
  const start=motor.z;
  advance(combat,.1,{dodge:true});
  assert.equal(combat.dodgeDuration,ROLL_DURATION);
  assert.equal(combat.dodgeType,'roll');assert.equal(motor.stamina,78);
  assert.ok(start-motor.z>.18&&start-motor.z<.25,'the crouch begins with a small movement');
  assert.ok(combat.invulnerable>0);
  advance(combat,.5);
  assert.ok(Math.abs(start-motor.z-3.6)<.001);
  assert.equal(combat.invulnerable,0);assert.equal(combat.dodging,true);
  advance(combat,.15);
  assert.equal(combat.dodging,false);
  assert.ok(Math.abs(start-motor.z-3.6)<.001);
  advance(combat,1/60,{dodge:true});
  assert.equal(combat.dodgeSerial,1);

  const blocked=arena([]);
  blocked.combat.rollMotionAvailable=true;
  blocked.grid.add({x:blocked.motor.x,z:blocked.motor.z-1.3,radius:.45});
  advance(blocked.combat,.75,{dodge:true});
  assert.ok(blocked.motor.z>-.85,'the roll stops at a collider');
  assert.equal(blocked.combat.dodging,false);
});
test('the starting clearing is safe, death recovery clears actions, and enemies respawn only out of view',()=>{
  const {combat,motor}=arena([{type:'slime',x:3,z:-7}]);motor.reset();advance(combat,12);assert.equal(motor.hp,100);assert.equal(combat.enemies[0].state,'wander');
  const e=combat.enemies[0];e.hp=0;e.state='dead';e.deathTime=30;motor.reset(e.x,e.z);advance(combat,1);assert.equal(e.hp,0);
  motor.reset(60,60);advance(combat,.1);assert.equal(e.hp,34);
  combat.attackTime=.2;combat.dodgeTime=.2;combat.resetPlayer();assert.equal(combat.attacking,false);assert.equal(combat.dodging,false);assert.equal(combat.invulnerable,2);
});
test('progression safely handles multiple level-ups, corrupt values and max level',()=>{
  const p=new Progression({level:-8,xp:-9,kills:'invalid'});assert.equal(p.level,1);assert.equal(p.xp,0);assert.equal(p.kills,0);
  assert.equal(p.gain(40+65+5),2);assert.equal(p.level,3);assert.equal(p.xp,5);assert.equal(p.maxHP,140);
  const capped=new Progression({level:50,xp:0});capped.gain(100000);assert.equal(capped.level,50);assert.ok(capped.xp<xpForLevel(50));
});
test('v0.1 saves migrate in place; v0.2 keeps XP, HP and exploration across reloads',()=>{
  let value=JSON.stringify({version:1,position:{x:2,z:4},stars:[0,2],landmarks:['gate'],quality:'low',sensitivity:1.2});
  globalThis.localStorage={getItem:key=>{assert.equal(key,'hoshi-rpg-3d:v0.1');return value;},setItem:(_k,v)=>value=v};
  const old=loadSave();assert.deepEqual(old.position,{x:2,z:4});assert.deepEqual(old.stars,[0,2]);assert.equal(old.progression.level,1);assert.equal(old.hp,100);
  writeSave({...old,progression:{level:3,xp:17,kills:6},hp:88});assert.equal(JSON.parse(value).version,2);
  const restored=loadSave();assert.equal(restored.progression.level,3);assert.equal(restored.progression.xp,17);assert.equal(restored.hp,88);assert.deepEqual(restored.landmarks,['gate']);
  delete globalThis.localStorage;
});
test('a building blocks an attack through its walls but not one that passes its corner',()=>{
  const grid=new CollisionGrid(),motor=new PlayerMotor(grid);
  grid.add({x:0,z:0,radius:3.3,shape:'box',halfX:2.5,halfZ:2,height:5.5});
  const combat=new CombatSystem(motor,grid,null,[]);
  assert.equal(combat.lineClear(-3,0,3,0),false);
  // This line stays outside the walls, inside the circle that bounds them.
  assert.equal(combat.lineClear(2.9,.2,2.9,1.4),true);
});

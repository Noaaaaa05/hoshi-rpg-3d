// Combat is independent of Three.js. The v0.1 movement solver remains unchanged.
import { cameraMovement, clamp, heightAt, SPAWN } from './physics.js';
import { selectDodge, DODGE_DURATION, LAND_DURATION } from './motion-state.js';

export const ENEMY_TYPES = Object.freeze({
  slime: { name:'森のスライム', hp:34, damage:8, xp:18, speed:1.65, radius:.55, range:1.55, windup:.65, recovery:1.05 },
  goblin: { name:'小枝のゴブリン', hp:64, damage:12, xp:30, speed:2.3, radius:.43, range:1.75, windup:.55, recovery:1.1 }
});
export const ENEMY_SPAWNS = Object.freeze([
  {type:'slime',x:0,z:-7},{type:'slime',x:-17,z:18},{type:'slime',x:18,z:18},
  {type:'goblin',x:16,z:-28},{type:'goblin',x:-25,z:-17},
  {type:'slime',x:37,z:-41},{type:'goblin',x:-48,z:34},{type:'slime',x:-56,z:-48}
]);
export const xpForLevel = level => 40 + (level - 1) * 25;
export const maxHPForLevel = level => 100 + (level - 1) * 20;
export const attackForLevel = level => 18 + (level - 1) * 4;
export function normalizeProgression(value = {}) {
  const level = Number.isInteger(value?.level) ? clamp(value.level,1,50) : 1;
  return { level, xp:Number.isInteger(value?.xp)?clamp(value.xp,0,xpForLevel(level)-1):0,
    kills:Number.isInteger(value?.kills)?clamp(value.kills,0,1000000):0 };
}
export class Progression {
  constructor(saved) { Object.assign(this,normalizeProgression(saved)); }
  get maxHP() { return maxHPForLevel(this.level); }
  get attack() { return attackForLevel(this.level); }
  get neededXP() { return xpForLevel(this.level); }
  gain(amount) {
    if(!Number.isFinite(amount)||amount<=0)return 0;
    this.xp+=Math.floor(amount);let levels=0;
    while(this.level<50&&this.xp>=this.neededXP){this.xp-=this.neededXP;this.level++;levels++;}
    if(this.level===50)this.xp=Math.min(this.xp,this.neededXP-1);
    return levels;
  }
  toJSON() { return {level:this.level,xp:this.xp,kills:this.kills}; }
}
export class CombatSystem {
  constructor(motor,grid,saved,spawns=ENEMY_SPAWNS) {
    this.motor=motor;this.grid=grid;this.progression=new Progression(saved);
    motor.hp=this.progression.maxHP;
    this.events=[];this.attackTime=0;this.attackDuration=.52;this.attackHits=new Set();
    this.dodgeTime=0;this.dodgeCooldown=0;this.invulnerable=0;this.hurtTime=0;this.aiTime=0;this.time=0;this.targetId=null;
    this.dodgeDuration=DODGE_DURATION;this.dodgeType='roll';this.dodgeSerial=0;this.landingTime=0;this.landingSerial=0;
    this.enemies=spawns.map((spawn,id)=>{
      const config=ENEMY_TYPES[spawn.type],p=grid.resolve(spawn.x,spawn.z,config.radius);
      return {id,type:spawn.type,...p,y:heightAt(p.x,p.z),homeX:p.x,homeZ:p.z,angle:Math.PI,
        hp:config.hp,maxHP:config.hp,state:'wander',stateTime:0,goalX:p.x,goalZ:p.z,
        wanderTime:id*.29,hurt:0,seed:173+id*97,moving:false,deathTime:0,modelLoaded:false};
    });
  }
  get attacking() { return this.attackTime>0; }
  get dodging() { return this.dodgeTime>0; }
  get attackPhase() { return this.attacking?1-this.attackTime/this.attackDuration:0; }
  get dodgePhase() { return this.dodging?1-this.dodgeTime/this.dodgeDuration:0; }
  safe(x,z) { return Math.hypot(x-SPAWN.x,z-SPAWN.z)<8; }
  resetPlayer() {
    this.attackTime=this.dodgeTime=this.dodgeCooldown=this.hurtTime=this.landingTime=0;this.invulnerable=2;this.attackHits.clear();
    this.motor.vx=this.motor.vz=0;
    for(const e of this.enemies)if(e.hp>0){e.state='return';e.stateTime=0;}
  }
  step(dt,input,yaw) {
    dt=clamp(dt,0,1/30);this.time+=dt;
    this.invulnerable=Math.max(0,this.invulnerable-dt);this.hurtTime=Math.max(0,this.hurtTime-dt);
    this.dodgeCooldown=Math.max(0,this.dodgeCooldown-dt);
    this.landingTime=Math.max(0,this.landingTime-dt);
    const m=this.motor;
    if(input.dodge&&!this.dodging&&this.dodgeCooldown<=0&&m.grounded&&m.stamina>=22&&m.hp>0){
      const direction=cameraMovement(input.x,input.y,yaw);
      this.dodgeType=selectDodge(input.x,input.y,yaw,m.angle);this.dodgeFacing=m.angle;this.dodgeSerial++;
      this.dodgeX=direction.magnitude>.1?direction.x/direction.magnitude:Math.sin(m.angle);
      this.dodgeZ=direction.magnitude>.1?direction.z/direction.magnitude:Math.cos(m.angle);
      this.dodgeTime=this.dodgeDuration;this.dodgeCooldown=.8;this.invulnerable=Math.max(this.invulnerable,.34);
      this.attackTime=0;m.stamina-=22;m.regenDelay=.7;this.events.push({type:'dodge'});
    }
    const dodging=this.dodging;
    const wasGrounded=m.grounded;
    // Normal movement, camera-relative acceleration, jump and dash all use v0.1 rules.
    m.step(dt,dodging?{x:0,y:0,dash:false,jump:false}:input,yaw);
    if(!wasGrounded&&m.grounded){this.landingTime=LAND_DURATION;this.landingSerial++;}
    if(dodging){
      const travel=10*Math.min(dt,this.dodgeTime),steps=Math.max(1,Math.ceil(travel/.15));
      for(let i=0;i<steps;i++){const p=this.grid.resolve(m.x+this.dodgeX*travel/steps,m.z+this.dodgeZ*travel/steps);m.x=p.x;m.z=p.z;}
      m.y=heightAt(m.x,m.z);m.angle=this.dodgeType==='roll'?Math.atan2(this.dodgeX,this.dodgeZ):this.dodgeFacing;m.speed=10;m.vx=m.vz=0;m.regenDelay=.7;
      this.dodgeTime=Math.max(0,this.dodgeTime-dt);
    }
    if((input.attack||input.attackHeld)&&!this.attacking&&!dodging&&m.hp>0){
      if(Math.hypot(input.x,input.y)<.1){
        let nearest=null,best=2.8;
        for(const e of this.enemies){const dx=e.x-m.x,dz=e.z-m.z,d=Math.hypot(dx,dz);if(e.hp>0&&d<best&&(dx*Math.sin(m.angle)+dz*Math.cos(m.angle))/(d||1)>.1){nearest=e;best=d;}}
        if(nearest)m.angle=Math.atan2(nearest.x-m.x,nearest.z-m.z);
      }
      this.attackTime=this.attackDuration;this.attackHits.clear();this.events.push({type:'swing'});
    }
    if(this.attacking){
      const previous=this.attackPhase;
      this.attackTime=Math.max(0,this.attackTime-dt);
      const phase=1-this.attackTime/this.attackDuration;
      if(phase>=.24&&previous<=.57)for(const e of this.enemies){
        if(e.hp<=0||this.attackHits.has(e.id))continue;
        const dx=e.x-m.x,dz=e.z-m.z,d=Math.hypot(dx,dz),facing=(dx*Math.sin(m.angle)+dz*Math.cos(m.angle))/(d||1);
        if(d<2.1+ENEMY_TYPES[e.type].radius&&facing>Math.cos(1.15)&&Math.abs(e.y-m.y)<1.65&&this.lineClear(m.x,m.z,e.x,e.z)){
          this.attackHits.add(e.id);this.targetId=e.id;e.hp=Math.max(0,e.hp-this.progression.attack);e.hurt=.24;
          this.events.push({type:'hit',id:e.id,damage:this.progression.attack});
          if(e.hp===0){
            e.state='dead';e.stateTime=0;e.deathTime=0;e.moving=false;this.progression.kills++;
            const xp=ENEMY_TYPES[e.type].xp,levels=this.progression.gain(xp);
            this.events.push({type:'kill',id:e.id,xp});
            if(levels){m.hp=this.progression.maxHP;this.events.push({type:'levelup',level:this.progression.level});}
          }else{e.state='recover';e.stateTime=.33;}
        }
      }
    }
    this.aiTime+=dt;
    if(this.aiTime>=.05){const aiDt=this.aiTime;this.aiTime=0;for(const e of this.enemies)this.updateEnemy(e,aiDt);}
  }
  lineClear(ax,az,bx,bz) {
    const distance=Math.hypot(bx-ax,bz-az),steps=Math.max(1,Math.ceil(distance/.3));
    for(let i=1;i<steps;i++){
      const x=ax+(bx-ax)*i/steps,z=az+(bz-az)*i/steps;
      for(const c of this.grid.query(x,z,.05))if(Math.hypot(x-c.x,z-c.z)<c.radius)return false;
    }
    return true;
  }
  random(e) { e.seed=(e.seed*1664525+1013904223)>>>0;return e.seed/4294967296; }
  moveEnemy(e,tx,tz,speed,dt) {
    const config=ENEMY_TYPES[e.type],dx=tx-e.x,dz=tz-e.z,d=Math.hypot(dx,dz);if(d<.18){e.moving=false;return;}
    const step=Math.min(speed*dt,d),angle=Math.atan2(dx,dz),oldX=e.x,oldZ=e.z;
    let p=this.grid.resolve(e.x+Math.sin(angle)*step,e.z+Math.cos(angle)*step,config.radius);
    if(Math.hypot(p.x-e.x,p.z-e.z)<step*.3){
      const side=e.id%2?1:-1;p=this.grid.resolve(e.x+Math.sin(angle+side*1.1)*step,e.z+Math.cos(angle+side*1.1)*step,config.radius);
    }
    // A small protected starting clearing lets returning players orient themselves.
    if(this.safe(p.x,p.z)){e.moving=false;return;}
    e.x=p.x;e.z=p.z;e.y=heightAt(e.x,e.z);e.moving=Math.hypot(e.x-oldX,e.z-oldZ)>.005;
    if(e.moving)e.angle=Math.atan2(e.x-oldX,e.z-oldZ);
  }
  updateEnemy(e,dt) {
    const m=this.motor,c=ENEMY_TYPES[e.type];e.hurt=Math.max(0,e.hurt-dt);
    if(e.state==='dead'){
      e.deathTime+=dt;
      if(e.deathTime>30&&Math.hypot(m.x-e.homeX,m.z-e.homeZ)>12){e.hp=e.maxHP;e.x=e.homeX;e.z=e.homeZ;e.y=heightAt(e.x,e.z);e.state='wander';e.stateTime=0;e.wanderTime=0;}
      return;
    }
    const distance=Math.hypot(e.x-m.x,e.z-m.z);
    if(distance>55){e.moving=false;return;}
    const homeDistance=Math.hypot(e.x-e.homeX,e.z-e.homeZ);
    const canChase=!this.safe(m.x,m.z)&&m.hp>0&&distance<12&&homeDistance<17;
    if((!canChase&&e.state!=='wander'&&e.state!=='return')||homeDistance>17){e.state='return';e.stateTime=0;}
    if(e.state==='windup'){
      e.moving=false;e.stateTime-=dt;
      if(e.stateTime<=0){
        const dx=m.x-e.x,dz=m.z-e.z,d=Math.hypot(dx,dz),facing=(dx*Math.sin(e.angle)+dz*Math.cos(e.angle))/(d||1);
        if(d<c.range+.25&&facing>.35&&Math.abs(m.y-e.y)<.95&&this.invulnerable<=0&&this.lineClear(e.x,e.z,m.x,m.z)){
          m.hp=Math.max(0,m.hp-c.damage);this.invulnerable=.6;this.hurtTime=.22;this.events.push({type:'hurt',damage:c.damage,id:e.id});
        }
        e.state='recover';e.stateTime=c.recovery;
      }
      return;
    }
    if(e.state==='recover'){e.moving=false;e.stateTime-=dt;if(e.stateTime<=0)e.state=canChase?'chase':'return';return;}
    if(e.state==='return'&&homeDistance>1.5){this.moveEnemy(e,e.homeX,e.homeZ,c.speed,dt);return;}
    if(canChase&&(distance<8.5||e.state==='chase')){
      e.state='chase';
      if(distance<=c.range){e.state='windup';e.stateTime=c.windup;e.angle=Math.atan2(m.x-e.x,m.z-e.z);e.moving=false;}
      else this.moveEnemy(e,m.x,m.z,c.speed,dt);
      return;
    }
    if(e.state==='chase')e.state='return';
    if(e.state==='return'){
      this.moveEnemy(e,e.homeX,e.homeZ,c.speed,dt);
      if(Math.hypot(e.x-e.homeX,e.z-e.homeZ)<.6){e.state='wander';e.wanderTime=0;}
      return;
    }
    e.wanderTime-=dt;
    if(e.wanderTime<=0){const angle=this.random(e)*Math.PI*2,r=1+this.random(e)*2.6;e.goalX=e.homeX+Math.sin(angle)*r;e.goalZ=e.homeZ+Math.cos(angle)*r;e.wanderTime=3+this.random(e)*3;}
    this.moveEnemy(e,e.goalX,e.goalZ,c.speed*.35,dt);
  }
  getTarget() {
    let best=null,distance=12;
    for(const e of this.enemies){if(e.hp<=0)continue;const d=Math.hypot(e.x-this.motor.x,e.z-this.motor.z);if(d<distance){best=e;distance=d;}}
    return best;
  }
  drainEvents() { const events=this.events;this.events=[];return events; }
}

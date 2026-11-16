import * as THREE from 'three';
import { createWorld, LANDMARKS } from './world.js';
import { createVillage } from './village.js';
import { createPlayer } from './player.js?v=0.2.3';
import { PlayerMotor, heightAt, clamp } from './physics.js';
import { Input } from './input.js?v=0.2.0';
import { createMap } from './map.js';
import { loadModels } from './models.js?v=0.2.3';
import { loadSave, writeSave } from './storage.js?v=0.2.0';
import { CombatSystem, ENEMY_TYPES } from './combat.js?v=0.2.3';
import { createMonsters } from './monsters.js?v=0.2.0';

const $=selector=>document.querySelector(selector);
let renderer;
function showError(message) { $('#error-message').textContent=message;$('#error').classList.remove('hidden'); }
try {
  renderer=new THREE.WebGLRenderer({canvas:$('#scene'),antialias:false,alpha:false,powerPreference:'high-performance'});
} catch {
  showError('3D表示を開始できませんでした。iOS 16.4以降のSafariで開き、ほかのタブを閉じて再読み込みしてください。');
}
if(renderer) init().catch(error=>{console.error(error);showError('ゲームの読み込みに失敗しました。再読み込みしてください。'+error.message);});

async function init() {
  renderer.outputColorSpace=THREE.SRGBColorSpace;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05;
  const scene=new THREE.Scene();scene.background=new THREE.Color('#648a88');scene.fog=new THREE.FogExp2('#648a88',.013);
  scene.add(new THREE.HemisphereLight('#c3dcd5','#30483f',1.7));
  const sun=new THREE.DirectionalLight('#fce0b2',1.8);sun.position.set(-35,65,20);scene.add(sun);
  const camera=new THREE.PerspectiveCamera(57,1,.15,280);
  const world=createWorld(scene), motor=new PlayerMotor(world.grid), player=createPlayer(scene), input=new Input();
  const drawMap=createMap($('#minimap'),world);
  const village=createVillage(scene,world.grid);
  const saved=loadSave(), collected=new Set(saved?.stars || []), discovered=new Set(saved?.landmarks || []);
  const combat=new CombatSystem(motor,world.grid,saved?.progression),monsters=createMonsters(scene,combat);
  if(saved)motor.hp=saved.hp;
  let quality=saved?.quality || 'auto';input.sensitivity=saved?.sensitivity || 1;
  $('#quality').value=quality;$('#sensitivity').value=String(input.sensitivity);
  for(const star of world.stars)star.group.visible=!collected.has(star.id);
  let updateModels=()=>{},modelWarning=false;
  try { updateModels=await loadModels(scene,player,world.grid,(...args)=>{console.warn(...args);modelWarning=true;},monsters); }
  catch(error){console.warn('GLB設定を読み込めません。簡易モデルで続行します。',error);modelWarning=true;}
  if(saved?.position)motor.reset(saved.position.x,saved.position.z);
  let yaw=0,pitch=.31,started=false,paused=true,elapsed=0,last=performance.now(),saveTimer=0,hudTimer=0;
  let toastTimer,discoveryTimer,ready=false,wasComplete=collected.size===8&&discovered.size===3;
  let pixelRatio=1,qualityTimer=0,frameSum=0,frameCount=0;
  const target=new THREE.Vector3(),desired=new THREE.Vector3(),lookAt=new THREE.Vector3(motor.x,motor.y+1.2,motor.z);
  camera.position.set(motor.x,motor.y+3.7,motor.z+8);
  const isPortrait=()=>matchMedia('(orientation:portrait) and (pointer:coarse)').matches;
  function toast(message) {clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').classList.add('visible');toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),3500);}
  function save() {
    return writeSave({position:{x:motor.x,z:motor.z},stars:[...collected],landmarks:[...discovered],quality,sensitivity:input.sensitivity,progression:combat.progression.toJSON(),hp:motor.hp});
  }
  function applyQuality() {
    const mobile=matchMedia('(pointer:coarse)').matches;
    const cap=quality==='low'?1:quality==='high'?1.8:mobile?1.3:1.5;
    pixelRatio=Math.min(window.devicePixelRatio || 1,cap);
    renderer.setPixelRatio(pixelRatio);renderer.setSize(innerWidth,innerHeight,false);
    world.grass.visible=quality!=='low';world.flies.visible=quality!=='low';
    qualityTimer=frameSum=frameCount=0;
  }
  function resize() {
    camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight,false);
    if(started&&isPortrait())pause();
  }
  function pause() {
    if(!started)return;
    paused=true;input.enabled=false;input.reset();$('#menu').classList.remove('hidden');save();
  }
  function resume() {
    if(isPortrait())return;
    paused=false;input.enabled=true;input.reset();$('#menu').classList.add('hidden');last=performance.now();
  }
  $('#start-button').addEventListener('click',()=>{
    started=true;document.body.classList.remove('intro-active');$('#intro').classList.add('hidden');resume();
    if(!save())toast('このブラウザでは保存できません。探索中はそのまま遊べます。');
    else if(modelWarning)toast('一部の追加モデルを読み込めず、簡易モデルで開始しました');
    else toast(saved?'おかえりなさい、星の旅人。':'小径の星灯りを追いかけてみよう。');
  });
  $('#pause-button').addEventListener('click',pause);$('#resume-button').addEventListener('click',resume);
  $('#home-button').addEventListener('click',()=>{motor.reset();motor.hp=combat.progression.maxHP;motor.stamina=100;motor.exhausted=false;combat.resetPlayer();yaw=0;pitch=.31;lookAt.set(motor.x,motor.y+1.2,motor.z);camera.position.set(motor.x,motor.y+3.7,motor.z+8);save();resume();toast('はじまりの小径に戻りました');});
  $('#quality').addEventListener('change',e=>{quality=e.target.value;applyQuality();save();});
  $('#sensitivity').addEventListener('input',e=>{input.sensitivity=Number(e.target.value);save();});
  window.addEventListener('resize',resize);
  window.visualViewport?.addEventListener('resize',resize);
  window.addEventListener('keydown',e=>{if(e.code==='Escape'&&started){paused?resume():pause();}});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){input.reset();pause();}});
  window.addEventListener('pagehide',()=>{if(started)save();});
  $('#scene').addEventListener('webglcontextlost',e=>{e.preventDefault();pause();showError('3D表示が中断されました。旅の記録を保存しました。ページを再読み込みしてください。');});
  function updateCamera(dt,snap=false) {
    target.set(motor.x,motor.y+1.25,motor.z);
    const distance=8.2, horizontal=Math.cos(pitch)*distance;
    desired.set(target.x+Math.sin(yaw)*horizontal,target.y+Math.sin(pitch)*distance,target.z+Math.cos(yaw)*horizontal);
    // Test the view segment against nearby trunk/rock columns to avoid looking through them.
    for(let t=.12;t<=1;t+=.055) {
      const x=THREE.MathUtils.lerp(target.x,desired.x,t),z=THREE.MathUtils.lerp(target.z,desired.z,t),y=THREE.MathUtils.lerp(target.y,desired.y,t);
      let blocked=false;
      for(const c of world.grid.query(x,z,4)){
        const base=heightAt(c.x,c.z),radius=c.cameraRadius&&y>base+c.canopyBottom?c.cameraRadius:c.radius;
        if(Math.hypot(x-c.x,z-c.z)<radius+.28&&y<base+c.height+.3){blocked=true;break;}
      }
      if(blocked){desired.lerpVectors(target,desired,Math.max(.15,t-.09));break;}
    }
    desired.y=Math.max(desired.y,heightAt(desired.x,desired.z)+.65);
    const follow=snap?1:1-Math.exp(-9*dt);camera.position.lerp(desired,follow);lookAt.lerp(target,snap?1:1-Math.exp(-12*dt));
    camera.position.y=Math.max(camera.position.y,heightAt(camera.position.x,camera.position.z)+.5);camera.lookAt(lookAt);
  }
  function updateHUD() {
    const hp=Math.round(motor.hp),st=Math.round(motor.stamina);
    const stats=combat.progression;
    $('#hp-fill').style.transform=`scaleX(${hp/stats.maxHP})`;$('#st-fill').style.transform=`scaleX(${st/100})`;
    $('#hp-value').textContent=`${hp} / ${stats.maxHP}`;$('#st-value').textContent=`${st} / 100`;
    $('#hp-meter').setAttribute('aria-valuemax',stats.maxHP);
    $('#hp-meter').setAttribute('aria-valuenow',hp);$('#st-meter').setAttribute('aria-valuenow',st);
    $('#player-level').textContent=`Lv. ${String(stats.level).padStart(2,'0')}`;
    $('#xp-fill').style.transform=`scaleX(${stats.xp/stats.neededXP})`;
    $('#xp-value').textContent=stats.level===50?'MAX':`${stats.xp} / ${stats.neededXP}`;
    $('#xp-meter').setAttribute('aria-valuenow',stats.xp);$('#xp-meter').setAttribute('aria-valuemax',stats.neededXP);
    $('#attack-stat').textContent=stats.attack;$('#level-stat').textContent=stats.level;$('#kills-stat').textContent=stats.kills;
    $('#dodge-button').classList.toggle('exhausted',motor.stamina<22||combat.dodgeCooldown>0);
    $('#attack-button').classList.toggle('swinging',combat.attacking);
    $('#damage-flash').classList.toggle('visible',combat.hurtTime>0);
    const enemy=combat.getTarget();$('#enemy-target').classList.toggle('hidden',!enemy);
    if(enemy){$('#enemy-name').textContent=ENEMY_TYPES[enemy.type].name;$('#enemy-health').textContent=`${enemy.hp} / ${enemy.maxHP}`;$('#enemy-fill').style.transform=`scaleX(${enemy.hp/enemy.maxHP})`;$('#enemy-threat').textContent=enemy.state==='windup'?'攻撃の構え':'';}
    $('#star-count').textContent=collected.size;$('#landmark-count').textContent=`${discovered.size} / 3 風景を発見`;
    $('#dash-button').classList.toggle('exhausted',motor.exhausted);
    const headings=['N','NW','W','SW','S','SE','E','NE'];$('#heading').textContent=headings[((Math.round(yaw/(Math.PI/4))%8)+8)%8];
    let nearest=null,nearestDistance=Infinity;
    for(const l of LANDMARKS){const d=Math.hypot(motor.x-l.x,motor.z-l.z);if(d<nearestDistance){nearest=l;nearestDistance=d;}}
    $('#area-name').textContent=nearestDistance<16?nearest.name:'木漏れ日の小径';
    drawMap(motor,yaw,discovered);
  }
  function explore(dt) {
    for(const star of world.stars)if(!collected.has(star.id)&&Math.hypot(motor.x-star.x,motor.z-star.z)<1.25&&Math.abs(motor.y+1-star.group.position.y)<2){
      collected.add(star.id);star.group.visible=false;motor.stamina=Math.min(100,motor.stamina+22);toast(`✧ 星灯りを見つけた　${collected.size} / 8`);save();
    }
    for(const landmark of LANDMARKS)if(!discovered.has(landmark.id)&&Math.hypot(motor.x-landmark.x,motor.z-landmark.z)<landmark.radius){
      discovered.add(landmark.id);$('#discovery-name').textContent=landmark.name;$('#discovery').classList.add('visible');clearTimeout(discoveryTimer);discoveryTimer=setTimeout(()=>$('#discovery').classList.remove('visible'),4200);save();
    }
    if(Math.hypot(motor.x+42,motor.z-25)<6)motor.hp=Math.min(combat.progression.maxHP,motor.hp+12*dt);
    if(!wasComplete&&collected.size===8&&discovered.size===3){wasComplete=true;setTimeout(()=>toast('森の記憶がそろいました。旅は、まだつづきます。'),4300);}
    if(motor.hp<=0){motor.reset();motor.hp=combat.progression.maxHP;motor.stamina=100;motor.exhausted=false;combat.resetPlayer();toast('星灯りに導かれて、小径へ戻りました。育成の記録はそのままです');save();}
  }
  function combatEvents() {
    for(const event of combat.drainEvents()){
      const enemy=event.id!==undefined?combat.enemies[event.id]:null;
      if(event.type==='hit')monsters.damage(enemy.x,enemy.y+1,enemy.z,event.damage);
      if(event.type==='hurt')monsters.damage(motor.x,motor.y+1.7,motor.z,`−${event.damage}`,true);
      if(event.type==='kill'){toast(`${ENEMY_TYPES[enemy.type].name}を倒した　EXP +${event.xp}`);save();}
      if(event.type==='levelup'){toast(`LEVEL UP　Lv. ${event.level}　HP ${combat.progression.maxHP} / 攻撃力 ${combat.progression.attack}`);save();}
    }
  }
  function frame(now) {
    requestAnimationFrame(frame);
    const rawDt=(now-last)/1000;last=now;const dt=clamp(rawDt,0,.1);
    if(document.hidden)return;
    elapsed+=dt;
    if(started&&!paused&&!isPortrait()) {
      const state=input.read();yaw-=state.lookX;pitch=clamp(pitch+state.lookY,.07,.96);
      const substeps=Math.max(1,Math.ceil(dt/(1/60)));
      for(let i=0;i<substeps;i++)combat.step(dt/substeps,{...state,jump:state.jump&&i===0,attack:state.attack&&i===0,dodge:state.dodge&&i===0},yaw);
      combatEvents();explore(dt);saveTimer+=dt;
      if(saveTimer>5){saveTimer=0;save();}
      if(quality==='auto') {
        qualityTimer+=Math.min(rawDt,.5);frameSum+=Math.min(rawDt,.5);frameCount++;
        if(qualityTimer>5){
          if(frameSum/frameCount>.026&&pixelRatio>1){pixelRatio=1;renderer.setPixelRatio(1);renderer.setSize(innerWidth,innerHeight,false);world.grass.visible=false;}
          qualityTimer=frameSum=frameCount=0;
        }
      }
    }
    world.update(elapsed);village.update(dt,motor.x,motor.z,started&&!paused&&!isPortrait(),elapsed);player.update(started&&!paused&&!isPortrait()?dt:0,motor,heightAt(motor.x,motor.z),combat);updateModels(dt);
    updateCamera(dt);monsters.update(started&&!paused&&!isPortrait()?dt:0,combat.time,camera);hudTimer+=dt;if(hudTimer>.1){hudTimer=0;updateHUD();}
    renderer.render(scene,camera);
    if(!ready){ready=true;$('#start-button').textContent=saved?'旅のつづきへ　 →':'森を歩きはじめる　 →';$('#start-button').disabled=false;}
  }
  applyQuality();resize();updateCamera(0,true);updateHUD();player.update(0,motor,heightAt(motor.x,motor.z));
  if(new URLSearchParams(location.search).has('debug'))Object.defineProperty(window,'__HOSHI_DEBUG__',{get:()=>({
    player:{x:motor.x,y:motor.y,z:motor.z,angle:motor.angle,speed:motor.speed,stamina:motor.stamina,hp:motor.hp,grounded:motor.grounded,dashing:motor.dashing,maxHP:combat.progression.maxHP,attack:combat.progression.attack,level:combat.progression.level,xp:combat.progression.xp},
    playerModel:player.getModelStatus(),
    camera:{yaw,pitch,x:camera.position.x,y:camera.position.y,z:camera.position.z},started,paused,
    stars:[...collected],landmarks:[...discovered],input:{joyId:input.joyId,cameraId:input.cameraId,dashId:input.dashId},
    combat:{attacking:combat.attacking,attackPhase:combat.attackPhase,dodging:combat.dodging,dodgeCooldown:combat.dodgeCooldown,dodgeType:combat.dodgeType,dodgePhase:combat.dodgePhase,dodgeSerial:combat.dodgeSerial,landingTime:combat.landingTime,landingSerial:combat.landingSerial,kills:combat.progression.kills,time:combat.time},
    combatPointers:{attackId:input.attackId,dodgeId:input.dodgeId},
    enemies:combat.enemies.map(e=>({id:e.id,type:e.type,x:e.x,y:e.y,z:e.z,hp:e.hp,maxHP:e.maxHP,state:e.state,stateTime:e.stateTime,modelLoaded:e.modelLoaded})),
    drawCalls:renderer.info.render.calls,triangles:renderer.info.render.triangles,pixelRatio,colliders:world.grid.items.length,villageInventory:village.getInventory()
  })});
  requestAnimationFrame(frame);
}

import * as THREE from 'three';
import { clone as cloneSkeleton } from 'three/addons/utils/SkeletonUtils.js';

// Eight enemies share geometry/materials. Default monsters add a fixed 12 draw calls.
export function createMonsters(scene,combat) {
  const enemies=combat.enemies,slimes=enemies.filter(e=>e.variant==='slime'),goblins=enemies.filter(e=>e.variant==='goblin');
  const root=new THREE.Object3D(),part=new THREE.Object3D(),matrix=new THREE.Matrix4(),white=new THREE.Color(2,1.5,1.3),normal=new THREE.Color(1,1,1);
  const mat=color=>new THREE.MeshStandardMaterial({color,roughness:1,flatShading:true});
  const batches=[];
  function batch(geometry,material,count) {
    const mesh=new THREE.InstancedMesh(geometry,material,count);mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    // All batches have only a handful of instances; avoid recomputing animated bounds.
    mesh.frustumCulled=false;scene.add(mesh);batches.push(mesh);return mesh;
  }
  const sphere=new THREE.SphereGeometry(1,10,7),box=new THREE.BoxGeometry(1,1,1);
  const slimeBody=batch(sphere,mat('#77aa88'),slimes.length);
  const slimeEyes=batch(sphere,mat('#eee5c6'),slimes.length*2),slimePupils=batch(sphere,mat('#233f36'),slimes.length*2);
  const goblinBody=batch(box,mat('#65724e'),goblins.length),goblinHead=batch(new THREE.IcosahedronGeometry(1,0),mat('#8ba66b'),goblins.length);
  const goblinLimbs=batch(box,mat('#829c62'),goblins.length*4),goblinEars=batch(new THREE.ConeGeometry(1,1,3),mat('#8ba66b'),goblins.length*2);
  const goblinEyes=batch(box,mat('#202e28'),goblins.length*2),clubs=batch(new THREE.CylinderGeometry(.10,.16,1,5),mat('#8d7550'),goblins.length);
  const barGeo=new THREE.PlaneGeometry(1,1),barMaterial=new THREE.MeshBasicMaterial({color:'#142d2b',depthWrite:false});
  const bars=batch(barGeo,barMaterial,enemies.length),fills=batch(barGeo,new THREE.MeshBasicMaterial({color:'#d2c084',depthWrite:false}),enemies.length);
  const warnings=batch(new THREE.RingGeometry(.65,.72,20).rotateX(-Math.PI/2),new THREE.MeshBasicMaterial({color:'#e8a076',transparent:true,opacity:.8,side:THREE.DoubleSide,depthWrite:false}),enemies.length);
  const slashGeo=new THREE.BufferGeometry(),vertices=[];
  for(let i=0;i<16;i++){
    const a=-1.1+i/16*2.2,b=-1.1+(i+1)/16*2.2;
    for(const [angle,r] of [[a,1.1],[a,2.15],[b,2.15],[a,1.1],[b,2.15],[b,1.1]])vertices.push(Math.sin(angle)*r,.9,Math.cos(angle)*r);
  }
  slashGeo.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
  const slash=new THREE.Mesh(slashGeo,new THREE.MeshBasicMaterial({color:'#ffe4a4',transparent:true,opacity:.65,side:THREE.DoubleSide,depthWrite:false}));scene.add(slash);
  const custom=new Map();
  function put(mesh,index,x,y,z,sx,sy,sz,rx=0,ry=0,rz=0,visible=true) {
    part.position.set(x,y,z);part.rotation.set(rx,ry,rz);part.scale.set(visible?sx:0,visible?sy:0,visible?sz:0);part.updateMatrix();
    matrix.multiplyMatrices(root.matrix,part.matrix);mesh.setMatrixAt(index,matrix);
  }
  function prepare(e,time) {
    const dying=e.hp<=0,fade=dying?Math.max(0,1-e.deathTime/.9):1;
    const bob=e.moving?Math.sin(time*(e.variant==='slime'?8:10)+e.id)*.06:0;
    root.position.set(e.x,e.y+(dying?0:bob),e.z);root.rotation.set(0,e.angle,dying&&e.variant==='goblin'?Math.min(1.5,e.deathTime*3):0);
    root.scale.setScalar(fade);root.updateMatrix();return !e.modelLoaded&&fade>0&&Math.hypot(e.x-combat.motor.x,e.z-combat.motor.z)<55;
  }
  function animateCustom(e,entry,dt) {
    const {group,mixer,actions}=entry;group.visible=e.hp>0||e.deathTime<1.5;
    group.position.set(e.x,e.y,e.z);group.rotation.y=e.angle;
    const state=e.hp<=0?'death':e.state==='windup'?'attack':e.moving?'walk':'idle';
    const next=actions[state]||actions.idle;
    if(next!==entry.active){entry.active?.fadeOut(.12);next?.reset().fadeIn(.12).play();entry.active=next;}
    if(e.hp<=0&&!actions.death){group.rotation.z=Math.min(1.5,e.deathTime*3);group.scale.setScalar(Math.max(0,1-e.deathTime/1.2));}
    else{group.rotation.z=0;group.scale.setScalar(1);}
    mixer.update(dt);
  }
  const damageRoot=document.querySelector('#damage-numbers'),projected=new THREE.Vector3();
  const numbers=Array.from({length:8},()=>{const el=document.createElement('span');el.className='damage-number';damageRoot.append(el);return {el,life:0};});
  const api={
    replaceVisual(type,template,clips,animationMap={}) {
      for(const e of enemies.filter(e=>e.type===type)){
        const group=cloneSkeleton(template);scene.add(group);e.modelLoaded=true;
        const mixer=new THREE.AnimationMixer(group),actions={};
        for(const state of ['idle','walk','attack','death']){
          const clip=THREE.AnimationClip.findByName(clips,animationMap[state]||state);
          if(clip){actions[state]=mixer.clipAction(clip);if(state==='death'){actions[state].setLoop(THREE.LoopOnce,1);actions[state].clampWhenFinished=true;}}
        }
        custom.set(e.id,{group,mixer,actions,active:null});
      }
    },
    damage(x,y,z,value,hurt=false) {
      const entry=numbers.find(n=>n.life<=0)||numbers[0];Object.assign(entry,{x,y,z,life:.8});entry.el.textContent=String(value);entry.el.classList.toggle('hurt',hurt);
    },
    update(dt,time,camera) {
      for(let i=0;i<slimes.length;i++){
        const e=slimes[i],visible=prepare(e,time),squash=e.state==='windup'?.7:1;
        put(slimeBody,i,0,.48,0,.65,.48*squash,.6,0,0,0,visible);
        for(let side=0;side<2;side++){
          const x=(side?1:-1)*.21;put(slimeEyes,i*2+side,x,.6,.49,.105,.14,.06,0,0,0,visible);
          put(slimePupils,i*2+side,x,.6,.54,.05,.085,.025,0,0,0,visible);
        }
        slimeBody.setColorAt(i,e.hurt>0?white:normal);
      }
      for(let i=0;i<goblins.length;i++){
        const e=goblins[i],visible=prepare(e,time),swing=e.moving?Math.sin(time*10+e.id)*.4:0,attack=e.state==='windup'?-1.8:0;
        put(goblinBody,i,0,.9,0,.48,.56,.3,0,0,0,visible);put(goblinHead,i,0,1.42,.01,.32,.31,.28,0,0,0,visible);
        for(let side=0;side<2;side++){
          const sign=side?1:-1;
          put(goblinLimbs,i*4+side,sign*.14,.34,0,.14,.5,.16,sign*swing,0,0,visible);
          put(goblinLimbs,i*4+2+side,sign*.34,.92,0,.13,.5,.13,side?attack:-swing,0,sign*.16,visible);
          put(goblinEars,i*2+side,sign*.36,1.48,0,.18,.43,.18,0,0,-sign*1.2,visible);
          put(goblinEyes,i*2+side,sign*.12,1.47,.245,.075,.065,.04,0,0,sign*.1,visible);
        }
        put(clubs,i,.45,.75,attack?-.25:.25,1,1,1,attack,0,-.15,visible);
        goblinHead.setColorAt(i,e.hurt>0?white:normal);
      }
      for(const e of enemies){
        const visible=e.hp>0&&Math.hypot(e.x-combat.motor.x,e.z-combat.motor.z)<20;
        const height=e.variant==='slime'?1.25:1.95;
        root.position.set(e.x,e.y+height,e.z);root.quaternion.copy(camera.quaternion);root.scale.setScalar(1);root.updateMatrix();
        put(bars,e.id,0,0,0,.92,.09,1,0,0,0,visible);
        const health=e.hp/e.maxHP;put(fills,e.id,-.44*(1-health),0,.008,.88*health,.055,1,0,0,0,visible);
        root.position.set(e.x,e.y+.03,e.z);root.rotation.set(0,0,0);root.updateMatrix();
        put(warnings,e.id,0,0,0,1.25,1,1.25,0,0,0,visible&&e.state==='windup');
        const entry=custom.get(e.id);if(entry)animateCustom(e,entry,dt);
      }
      for(const mesh of batches)mesh.instanceMatrix.needsUpdate=true;
      if(slimeBody.instanceColor)slimeBody.instanceColor.needsUpdate=true;
      if(goblinHead.instanceColor)goblinHead.instanceColor.needsUpdate=true;
      const phase=combat.attackPhase;slash.visible=combat.attacking&&phase>.2&&phase<.65;
      slash.position.set(combat.motor.x,combat.motor.y,combat.motor.z);slash.rotation.y=combat.motor.angle+(phase-.4)*.9;
      for(const n of numbers){
        n.life=Math.max(0,n.life-dt);if(n.life<=0){n.el.style.display='none';continue;}
        projected.set(n.x,n.y+(1-n.life/.8)*.8,n.z).project(camera);
        n.el.style.display=projected.z>-1&&projected.z<1?'block':'none';n.el.style.opacity=String(Math.min(1,n.life*4));
        n.el.style.transform=`translate(${(projected.x*.5+.5)*innerWidth}px,${(-projected.y*.5+.5)*innerHeight}px) translate(-50%,-50%)`;
      }
    }
  };
  return api;
}

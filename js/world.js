import * as THREE from 'three';
import { CollisionGrid, heightAt, SPAWN } from './physics.js';

export const LANDMARKS = [
  { id:'gate', name:'星詠みの石門', x:0, z:-28, radius:8 },
  { id:'tree', name:'星降りの古木', x:42, z:-50, radius:10 },
  { id:'camp', name:'旅人の灯り', x:-42, z:25, radius:9 }
];
export const STAR_POSITIONS = [
  [1,3],[-6,-13],[0,-32],[21,-39],[42,-48],[-20,21],[-42,23],[33,24]
];
export function pathDistance(x,z) {
  const main = Math.abs(x - Math.sin(z*.047)*6);
  const segment = (ax,az,bx,bz) => {
    const dx=bx-ax,dz=bz-az,t=Math.max(0,Math.min(1,((x-ax)*dx+(z-az)*dz)/(dx*dx+dz*dz)));
    return Math.hypot(x-ax-t*dx,z-az-t*dz);
  };
  return Math.min(main, segment(-1,14,-42,25), segment(-5,-29,42,-50));
}
export function createWorld(scene) {
  const grid = new CollisionGrid(), animated = [], stars = [];
  let seed=7319;
  const random=()=> { seed=(seed*1664525+1013904223)>>>0; return seed/4294967296; };
  const material=(color,extra={})=>new THREE.MeshStandardMaterial({color,flatShading:true,roughness:1,...extra});
  const stone=material('#85958c'), stoneLight=material('#b4bb9c'), bark=material('#655f49'), leaves=material('#578875'), gold=material('#d7bd79');
  const dummy=new THREE.Object3D();
  function addMesh(geometry,mat,x,y,z,parent=scene) { const mesh=new THREE.Mesh(geometry,mat); mesh.position.set(x,y,z); parent.add(mesh); return mesh; }
  function localMesh(geometry,mat,x,y,z,parent) { return addMesh(geometry,mat,x,y,z,parent); }
  function instance(geometry,mat,entries) {
    const mesh=new THREE.InstancedMesh(geometry,mat,entries.length);
    entries.forEach((e,i)=> {
      dummy.position.set(e.x,e.y,e.z); dummy.rotation.set(e.rx||0,e.ry||0,e.rz||0); dummy.scale.set(e.sx??1,e.sy??1,e.sz??1); dummy.updateMatrix(); mesh.setMatrixAt(i,dummy.matrix);
      if(e.color) mesh.setColorAt(i,new THREE.Color(e.color));
    });
    mesh.instanceMatrix.needsUpdate=true; mesh.computeBoundingSphere(); scene.add(mesh); return mesh;
  }
  const groundGeo=new THREE.PlaneGeometry(260,260,130,130); groundGeo.rotateX(-Math.PI/2);
  const pos=groundGeo.attributes.position, colors=new Float32Array(pos.count*3);
  const forest=new THREE.Color('#54755e'), path=new THREE.Color('#a6a58a'), moss=new THREE.Color('#5d8064');
  for(let i=0;i<pos.count;i++) {
    const x=pos.getX(i),z=pos.getZ(i); pos.setY(i,heightAt(x,z));
    const d=pathDistance(x,z),noise=(Math.sin(x*.9+z*.71)+Math.cos(x*.47-z*1.1))*.025;
    const c=forest.clone().lerp(moss,.4+noise*4).lerp(path,1-THREE.MathUtils.smoothstep(d,2.0,4.2));
    c.offsetHSL(0,0,noise); colors.set([c.r,c.g,c.b],i*3);
  }
  groundGeo.setAttribute('color',new THREE.BufferAttribute(colors,3)); groundGeo.computeVertexNormals();
  addMesh(groundGeo,new THREE.MeshStandardMaterial({vertexColors:true,roughness:1}),0,0,0);

  // A reusable set of low-poly geometries keeps hundreds of trees in a few draw calls.
  const trees=[];
  for(let i=0;i<340;i++) {
    const angle=random()*Math.PI*2,r=Math.sqrt(random())*120,x=Math.cos(angle)*r,z=Math.sin(angle)*r;
    if(pathDistance(x,z)<4.7 || Math.hypot(x-SPAWN.x,z-SPAWN.z)<7 || LANDMARKS.some(l=>Math.hypot(x-l.x,z-l.z)<l.radius*.8) || STAR_POSITIONS.some(s=>Math.hypot(x-s[0],z-s[1])<2.4)) continue;
    trees.push({x,z,y:heightAt(x,z),s:1+random()*.85,deciduous:random()>.66,rotation:random()*6});
  }
  trees.push(...[[-8,6],[9,1],[-11,-10],[12,-19],[-13,-33],[14,15]].map(([x,z])=>({x,z,y:heightAt(x,z),s:1.35,deciduous:false,rotation:0})));
  instance(new THREE.CylinderGeometry(.21,.37,1,6),bark,trees.map(t=>({x:t.x,y:t.y+t.s*2.8,z:t.z,sx:t.s,sy:t.s*5.6,sz:t.s})));
  for(let level=0;level<3;level++) {
    const palette=['#367365','#427f6c','#548b73'];
    instance(new THREE.ConeGeometry(1,1,7),material(palette[level]),trees.filter(t=>!t.deciduous).map(t=>({x:t.x,y:t.y+t.s*(3.3+level*1.45),z:t.z,sx:t.s*(2.25-level*.51),sy:t.s*(3.9-level*.6),sz:t.s*(2.25-level*.51),ry:t.rotation})));
  }
  for(let level=0;level<2;level++) instance(new THREE.IcosahedronGeometry(1,1),material(level?'#6b9876':'#53896c'),trees.filter(t=>t.deciduous).map(t=>({x:t.x+(level?.65:-.3)*t.s,y:t.y+(5.4+level)*t.s,z:t.z,sx:t.s*(2.5-level*.5),sy:t.s*2,sz:t.s*2.3,ry:t.rotation})));
  for(const t of trees) grid.add({x:t.x,z:t.z,radius:t.s*.36,height:t.s*8});

  const rocks=[];
  for(let i=0;i<100;i++) {
    const x=(random()-.5)*214,z=(random()-.5)*214,s=.4+random()*1.4;
    if(pathDistance(x,z)<4.3 || LANDMARKS.some(l=>Math.hypot(x-l.x,z-l.z)<l.radius) || STAR_POSITIONS.some(p=>Math.hypot(x-p[0],z-p[1])<2.5))continue;
    rocks.push({x,z,y:heightAt(x,z)+s*.3,sx:s,sy:s*.7,sz:s*.8,ry:random()*6}); grid.add({x,z,radius:s*.88,height:s*1.3});
  }
  instance(new THREE.DodecahedronGeometry(1,0),stone,rocks);

  const grassGeometry=new THREE.BufferGeometry();
  grassGeometry.setAttribute('position',new THREE.Float32BufferAttribute([-.12,0,0,.12,0,0,.02,.65,0,0,0,-.12,0,0,.12,0,.5,.02],3)); grassGeometry.computeVertexNormals();
  const grasses=[],flowers=[];
  for(let i=0;i<6500;i++) {
    const x=(random()-.5)*185,z=(random()-.5)*185;
    if(pathDistance(x,z)<3.2)continue;
    const s=.35+random()*.7;
    grasses.push({x,y:heightAt(x,z)-.01,z,sx:s,sy:s,sz:s,ry:random()*6,color:random()>.65?'#8da478':'#6e976c'});
    if(i%28===0) flowers.push({x,y:heightAt(x,z)+.24,z,sx:.08,sy:.13,sz:.08,color:random()>.4?'#e7d5a0':'#9bc1d0'});
  }
  const grass=instance(grassGeometry,new THREE.MeshLambertMaterial({color:'#b0c69a',side:THREE.DoubleSide}),grasses);
  instance(new THREE.OctahedronGeometry(1),new THREE.MeshBasicMaterial({color:'#ffffff'}),flowers);

  // Distant silhouettes hide the edge without expensive sky textures or post-processing.
  const hills=[];
  for(let i=0;i<18;i++) { const a=i/18*Math.PI*2,r=145; hills.push({x:Math.cos(a)*r,y:-6,z:Math.sin(a)*r,sx:25+random()*20,sy:20+random()*19,sz:26+random()*20,ry:a}); }
  instance(new THREE.IcosahedronGeometry(1,1),material('#597e77'),hills);
  const skyStars=new Float32Array(150*3);
  for(let i=0;i<150;i++){ const a=random()*Math.PI*2,e=.22+random()*1.15,r=190; skyStars[i*3]=Math.cos(a)*Math.cos(e)*r;skyStars[i*3+1]=Math.sin(e)*r;skyStars[i*3+2]=Math.sin(a)*Math.cos(e)*r; }
  scene.add(new THREE.Points(new THREE.BufferGeometry().setAttribute('position',new THREE.BufferAttribute(skyStars,3)),new THREE.PointsMaterial({color:'#f5ead0',size:.28,transparent:true,opacity:.7,fog:false})));
  addMesh(new THREE.SphereGeometry(4,16,12),new THREE.MeshBasicMaterial({color:'#f5efd2',fog:false}),-63,70,-150);

  // Star-reader's gate: an original, weathered forest monument.
  const gate=new THREE.Group(); gate.position.set(0,heightAt(0,-28),-28); scene.add(gate);
  for(const x of [-2.5,2.5]) {
    localMesh(new THREE.BoxGeometry(.85,4.6,.9),stone,x,2.3,0,gate);
    localMesh(new THREE.BoxGeometry(1.2,.28,1.2),stoneLight,x,.15,0,gate);
    localMesh(new THREE.BoxGeometry(1.1,.26,1.1),stoneLight,x,4.55,0,gate);
    grid.add({x,z:-28,radius:.65,height:4.8});
  }
  localMesh(new THREE.BoxGeometry(6.6,.6,1.1),stone,0,4.95,0,gate);
  const cap=localMesh(new THREE.BoxGeometry(7,.24,1.3),material('#627f67'),0,5.37,0,gate);cap.rotation.z=.025;
  localMesh(new THREE.OctahedronGeometry(.43),material('#dfd397',{emissive:'#ccb978',emissiveIntensity:.4}),0,4.15,0,gate);
  for(let i=0;i<4;i++)localMesh(new THREE.BoxGeometry(3+i*.25,.13,.75),stoneLight,0,.06,-2-i*.8,gate);
  const rune=localMesh(new THREE.TorusGeometry(.56,.025,4,24),gold,0,3.9,.57,gate); rune.rotation.z=Math.PI/4;

  // The old tree is assembled from simple forms; GLBs can later replace/add landmarks.
  const tree=new THREE.Group(); tree.position.set(42,heightAt(42,-50),-50);scene.add(tree);
  localMesh(new THREE.CylinderGeometry(.7,1.3,7,7),bark,0,3.5,0,tree);
  for(let i=0;i<6;i++) {
    const a=i/6*Math.PI*2;
    const branch=localMesh(new THREE.CylinderGeometry(.23,.52,4,5),bark,Math.cos(a)*1.2,6,Math.sin(a)*1.2,tree); branch.rotation.z=Math.sin(a)*.7;branch.rotation.x=Math.cos(a)*.7;
    localMesh(new THREE.IcosahedronGeometry(2.9,1),material(i%2?'#8ba788':'#6d977d'),Math.cos(a)*2.2,8+Math.sin(i)*.7,Math.sin(a)*2.2,tree);
    const lamp=localMesh(new THREE.OctahedronGeometry(.15),material('#f5d88f',{emissive:'#efc572',emissiveIntensity:1.3}),Math.cos(a)*2.6,5.2+Math.sin(i),Math.sin(a)*2.6,tree);animated.push({mesh:lamp,baseY:lamp.position.y,phase:i});
  }
  grid.add({x:42,z:-50,radius:1.3,height:11});
  const treeCircle=localMesh(new THREE.TorusGeometry(4,.12,5,32),stone,0,.08,0,tree);treeCircle.rotation.x=Math.PI/2;

  // A quiet campsite, with an emissive fire and a triangular canvas shelter.
  const camp=new THREE.Group();camp.position.set(-42,heightAt(-42,25),25);scene.add(camp);
  const tent=localMesh(new THREE.ConeGeometry(2.3,2.5,4,1,true),material('#c4af7c',{side:THREE.DoubleSide}),-2,1.2,-2,camp);tent.rotation.y=Math.PI/4;
  grid.add({x:-44,z:23,radius:1.8,height:2.5});
  const log=localMesh(new THREE.CylinderGeometry(.28,.28,2.2,6),bark,1,.3,2,camp);log.rotation.z=Math.PI/2;
  for(let i=0;i<8;i++){const a=i/8*Math.PI*2;localMesh(new THREE.DodecahedronGeometry(.22),stone,Math.cos(a)*.7,.12,Math.sin(a)*.7,camp);}
  const flame=localMesh(new THREE.ConeGeometry(.28,.8,5),material('#ffdb83',{emissive:'#ff9f3a',emissiveIntensity:1.8}),0,.4,0,camp);
  animated.push({mesh:flame,baseY:.4,phase:2,fire:true});

  const posts=[];
  for(const z of [6,-9,-22,-38,24]) {
    const x=Math.sin(z*.047)*6+3.4,y=heightAt(x,z);
    posts.push({x,y:y+.65,z,sx:.1,sy:1.3,sz:.1});
    addMesh(new THREE.BoxGeometry(.28,.35,.28),material('#e3cd85',{emissive:'#e6c674',emissiveIntensity:.7}),x,y+1.5,z);
  }
  instance(new THREE.CylinderGeometry(1,1,1,5),bark,posts);
  const starMat=material('#f6dd9b',{emissive:'#edc978',emissiveIntensity:1.5});
  STAR_POSITIONS.forEach(([x,z],id)=> {
    const group=new THREE.Group();const y=heightAt(x,z)+1.1;group.position.set(x,y,z);scene.add(group);
    const gem=localMesh(new THREE.OctahedronGeometry(.19),starMat,0,0,0,group);gem.scale.y=1.5;
    const ring=localMesh(new THREE.TorusGeometry(.33,.013,3,20),gold,0,0,0,group);ring.rotation.x=Math.PI*.3;
    stars.push({id,x,z,y,group,ring});
  });

  const spriteCanvas=document.createElement('canvas');spriteCanvas.width=spriteCanvas.height=32;
  const ctx=spriteCanvas.getContext('2d'),gradient=ctx.createRadialGradient(16,16,0,16,16,16);gradient.addColorStop(0,'#fff6c7');gradient.addColorStop(.16,'#e9e9a4');gradient.addColorStop(.42,'#b8d38b88');gradient.addColorStop(1,'#b8d38b00');ctx.fillStyle=gradient;ctx.fillRect(0,0,32,32);
  const flyBase=[],flyPositions=new Float32Array(130*3);
  for(let i=0;i<130;i++)flyBase.push({x:(random()-.5)*140,z:(random()-.5)*140,y:1+random()*3,phase:random()*7});
  const flyGeo=new THREE.BufferGeometry();flyGeo.setAttribute('position',new THREE.BufferAttribute(flyPositions,3));
  const flies=new THREE.Points(flyGeo,new THREE.PointsMaterial({map:new THREE.CanvasTexture(spriteCanvas),size:.23,transparent:true,depthWrite:false,color:'#f7e7aa',blending:THREE.AdditiveBlending}));flies.frustumCulled=false;scene.add(flies);
  return {grid,stars,trees,grass,flies,
    update(time) {
      for(const star of stars) { if(!star.group.visible)continue;star.group.position.y=star.y+Math.sin(time*1.8+star.id)*.17;star.group.rotation.y=time*.6; }
      for(const a of animated){ if(a.fire){a.mesh.scale.y=1+Math.sin(time*7)*.15;a.mesh.rotation.y=time*.4;}else a.mesh.position.y=a.baseY+Math.sin(time+a.phase)*.12; }
      flyBase.forEach((f,i)=>{ const x=f.x+Math.sin(time*.23+f.phase)*1.4,z=f.z+Math.cos(time*.19+f.phase)*1.2;flyPositions[i*3]=x;flyPositions[i*3+1]=heightAt(x,z)+f.y+Math.sin(time+f.phase)*.35;flyPositions[i*3+2]=z; });
      flyGeo.attributes.position.needsUpdate=true;
    }
  };
}

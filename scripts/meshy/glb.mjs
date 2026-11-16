import { readFile } from 'node:fs/promises';
import * as THREE from '../../vendor/three/three.module.js';
import { rigProfile, assertCompatibleRig, prepareMotion } from '../../js/motion-library.js';
import { prepareModel, createFootGrounding } from '../../js/model-utils.js';
import { motionDuration } from '../../js/motion-state.js';

export function readGLB(bytes) {
  if(bytes.length<28||bytes.readUInt32LE(0)!==0x46546c67||bytes.readUInt32LE(4)!==2||bytes.readUInt32LE(8)!==bytes.length)
    throw new Error('Invalid GLB header');
  const length=bytes.readUInt32LE(12);
  if(bytes.readUInt32LE(16)!==0x4e4f534a||length+20>bytes.length)throw new Error('Invalid GLB JSON');
  const json=JSON.parse(bytes.subarray(20,20+length).toString('utf8'));
  const offset=20+length;
  const bin=offset+8<=bytes.length&&bytes.readUInt32LE(offset+4)===0x004e4942?bytes.subarray(offset+8,offset+8+bytes.readUInt32LE(offset)):Buffer.alloc(0);
  if(json.extensionsRequired?.length||json.buffers?.some(b=>b.uri)||json.images?.some(i=>i.uri&&!i.uri.startsWith('data:')))
    throw new Error('Self-contained GLB without external resources/required decoders is required');
  return {json,bin};
}
export function writeGLB(json,bin) {
  let text=Buffer.from(JSON.stringify(json));text=Buffer.concat([text,Buffer.alloc((4-text.length%4)%4,32)]);
  bin=Buffer.concat([bin,Buffer.alloc((4-bin.length%4)%4)]);
  const header=Buffer.alloc(20);header.writeUInt32LE(0x46546c67);header.writeUInt32LE(2,4);header.writeUInt32LE(28+text.length+bin.length,8);header.writeUInt32LE(text.length,12);header.writeUInt32LE(0x4e4f534a,16);
  const binHeader=Buffer.alloc(8);binHeader.writeUInt32LE(bin.length);binHeader.writeUInt32LE(0x004e4942,4);
  return Buffer.concat([header,text,binHeader,bin]);
}
export async function loadGLB(bytes) {
  const {GLTFLoader}=await import('../../vendor/three/addons/loaders/GLTFLoader.js');
  const {json,bin}=readGLB(bytes); // Reject external-resource reads before parsing.
  // Node inspection needs bind/geometry data, not browser image decoders.
  for(const mesh of json.meshes||[])for(const primitive of mesh.primitives)delete primitive.material;
  delete json.materials;delete json.images;delete json.textures;
  const neutral=writeGLB(json,bin);
  return new GLTFLoader().parseAsync(neutral.buffer.slice(neutral.byteOffset,neutral.byteOffset+neutral.byteLength),'');
}
export async function inspectFile(file) {
  const bytes=await readFile(file),{json}=readGLB(bytes);
  const triangles=(json.meshes||[]).reduce((n,m)=>n+m.primitives.reduce((s,p)=>s+(json.accessors[p.indices??p.attributes.POSITION]?.count||0)/3,0),0);
  return {file,bytes:bytes.length,triangles,skins:json.skins?.length||0,bones:json.skins?.[0]?.joints.length||0,
    animations:(json.animations||[]).map(a=>a.name),images:json.images?.length||0,materials:json.materials?.length||0};
}

// Keep only nodes, skin bind data and selected animation accessors. This avoids
// downloading five copies of the character mesh/textures into iPhone memory.
export function animationPack(bytes,sourceName,outputName) {
  const {json,bin}=readGLB(bytes),animation=json.animations?.find(a=>a.name===sourceName);
  if(!animation)throw new Error('Selected animation is absent');
  const views=[],accessors=[],chunks=[],viewMap=new Map(),accessorMap=new Map();let offset=0;
  function view(index){
    if(viewMap.has(index))return viewMap.get(index);
    const source=json.bufferViews[index];if(!source||source.buffer!==0||source.extensions)throw new Error('Unsupported animation buffer');
    const part=bin.subarray(source.byteOffset||0,(source.byteOffset||0)+source.byteLength);
    if(part.length!==source.byteLength)throw new Error('Truncated animation buffer');
    const id=views.length;views.push({...source,buffer:0,byteOffset:offset});chunks.push(part,Buffer.alloc((4-part.length%4)%4));offset+=part.length+(4-part.length%4)%4;viewMap.set(index,id);return id;
  }
  function accessor(index){
    if(accessorMap.has(index))return accessorMap.get(index);
    const a=json.accessors[index];if(!a||a.sparse||a.extensions||a.bufferView===undefined)throw new Error('Unsupported animation accessor');
    const id=accessors.length;accessors.push({...a,bufferView:view(a.bufferView)});accessorMap.set(index,id);return id;
  }
  const skins=(json.skins||[]).map(s=>({...s,inverseBindMatrices:s.inverseBindMatrices===undefined?undefined:accessor(s.inverseBindMatrices)}));
  const result={asset:{version:'2.0',generator:'hoshi-rpg-3d animation-only pack'},scene:json.scene||0,
    scenes:json.scenes.map(s=>({nodes:s.nodes})),nodes:json.nodes.map(n=>Object.fromEntries(Object.entries(n).filter(([k])=>['name','children','translation','rotation','scale','matrix'].includes(k)))),skins,
    animations:[{...animation,name:outputName,samplers:animation.samplers.map(s=>({...s,input:accessor(s.input),output:accessor(s.output)}))}],
    accessors,bufferViews:views,buffers:[{byteLength:offset}]};
  return writeGLB(result,Buffer.concat(chunks));
}

export async function validateMotion(baseBytes,candidateBytes,state,spec,options={}) {
  const base=await loadGLB(baseBytes),candidate=await loadGLB(candidateBytes);
  assertCompatibleRig(await rigProfile(base),await rigProfile(candidate));
  const clip=prepareMotion(base.scene,candidate.animations,spec,state);
  const timeScale=clip.duration/motionDuration(state);
  if(timeScale>(options.maxTimeScale||2.5))throw new Error(`${state}: playback would be ${timeScale.toFixed(2)}x; set a reviewed clip range before integration`);
  const {wrapper}=prepareModel(base,{height:1.9}),grounding=createFootGrounding(wrapper,0,true);
  if(!grounding)throw new Error('Foot contacts cannot be checked');
  const mixer=new THREE.AnimationMixer(base.scene),action=mixer.clipAction(clip);action.setLoop(THREE.LoopOnce,1);action.clampWhenFinished=true;action.play();
  const inverse=new THREE.Matrix4(),relative=new THREE.Matrix4(),point=new THREE.Vector3();let worst=0;
  // Offline only: check every vertex at 31 poses. Runtime uses bounded samples.
  for(let frame=0;frame<=30;frame++){
    mixer.setTime(clip.duration*frame/30);grounding.update(state);inverse.copy(wrapper.matrixWorld).invert();
    base.scene.traverse(mesh=>{
      if(!mesh.isSkinnedMesh)return;relative.multiplyMatrices(inverse,mesh.matrixWorld);
      let min=Infinity;
      for(let i=0;i<mesh.geometry.attributes.position.count;i++){mesh.getVertexPosition(i,point).applyMatrix4(relative);min=Math.min(min,point.y);}
      worst=Math.min(worst,min);
    });
  }
  if(worst<-.035)throw new Error(`${state}: ground penetration ${worst.toFixed(3)}m; review motion before integration`);
  return {sourceClip:spec.clip||candidate.animations[0].name,clip:clip.name,duration:clip.duration,timeScale,worstPenetration:worst};
}

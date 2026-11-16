import * as THREE from '../vendor/three/three.module.js';
import { trimClip } from './model-utils.js';
import { MOTION_STATES } from './motion-state.js';

// Compare actual bind data, not a filename, bone count, or a claimed fingerprint.
export async function rigProfile(gltf) {
  const skins=gltf.parser?.json.skins||[];
  if(skins.length!==1)throw new Error('互換性検査にはスキンが1つ必要です');
  const skeleton=await gltf.parser.getDependency('skin',0);
  gltf.scene.updateWorldMatrix(true,true);
  const parentInverse=new THREE.Matrix4().copy(gltf.scene.parent?.matrixWorld||new THREE.Matrix4()).invert();
  const names=new Set();
  const bones=skeleton.bones.map((bone,i)=>{
    if(!bone.name||names.has(bone.name))throw new Error('ボーン名が空または重複しています');
    names.add(bone.name);
    return {name:bone.name,parent:bone.parent?.isBone?bone.parent.name:null,
      matrix:new THREE.Matrix4().multiplyMatrices(parentInverse,bone.matrixWorld).toArray(),
      inverse:skeleton.boneInverses[i].toArray()};
  }).sort((a,b)=>a.name.localeCompare(b.name));
  return {bones};
}

export function assertCompatibleRig(base,candidate,tolerance=.0001) {
  if(base.bones.length!==candidate.bones.length)throw new Error('骨格の関節数が一致しません');
  for(let i=0;i<base.bones.length;i++){
    const a=base.bones[i],b=candidate.bones[i];
    if(a.name!==b.name||a.parent!==b.parent)throw new Error('ボーン名または親子関係が一致しません');
    for(const field of ['matrix','inverse'])for(let n=0;n<16;n++){
      if(!Number.isFinite(b[field][n])||Math.abs(a[field][n]-b[field][n])>tolerance*Math.max(1,Math.abs(a[field][n])))
        throw new Error('レスト姿勢・単位・バインド行列が一致しません');
    }
  }
  return true;
}

export function prepareMotion(root,clips,entry,state) {
  if(!MOTION_STATES.includes(state))throw new Error('未対応のモーションです');
  const source=entry.clip?clips.find(c=>c.name===entry.clip):clips.length===1?clips[0]:null;
  if(!source)throw new Error('クリップを一意に選択できません');
  if(source.tracks.some(t=>t.createInterpolant.isInterpolantFactoryMethodGLTFCubicSpline))throw new Error('Cubic splineモーションはLINEARへベイクしてから登録してください');
  if(entry.range!==undefined&&entry.range!==null&&(!Array.isArray(entry.range)||entry.range.length!==2||!entry.range.every(Number.isFinite)||entry.range[0]<0||entry.range[1]>source.duration||entry.range[1]<=entry.range[0]))throw new Error('モーションの区間が不正です');
  const clip=trimClip(source,entry.range);
  if(!Number.isFinite(clip.duration)||clip.duration<=0||clip.duration>10)throw new Error('モーションの長さが不正です');
  let animated=false;
  for(const track of clip.tracks){
    const binding=THREE.PropertyBinding.parseTrackName(track.name),node=root.getObjectByName(binding.nodeName);
    if(!node?.isBone||!['position','quaternion','scale'].includes(binding.propertyName)||binding.objectName||binding.propertyIndex!==undefined)
      throw new Error('ボーン以外のトラックは自動適用できません');
    if(![...track.times,...track.values].every(Number.isFinite))throw new Error('不正なキーフレームです');
    if(binding.propertyName==='scale'){
      if(Array.from(track.values).some((v,i)=>Math.abs(v-node.scale.getComponent(i%3))>.0001))throw new Error('骨の拡縮を含むモーションは自動適用できません');
    }
    // The existing collision motor owns translation. Preserve crouch/roll Y,
    // while removing horizontal root motion that would move the hero twice.
    if(binding.propertyName==='position'&&!node.parent?.isBone){
      for(let i=0;i<track.values.length;i+=3){track.values[i]=node.position.x;track.values[i+2]=node.position.z;}
    }
    if(binding.propertyName==='quaternion'&&track.times.length>1)animated=true;
  }
  if(!animated)throw new Error('回転アニメーションが含まれていません');
  clip.name=`Hoshi_${state}`;
  return clip.optimize();
}

export async function loadMotionLibrary(base,entries,loader,manifestURL,onWarning=console.warn) {
  const clips=[],mapping={},rejected=[];
  if(!entries||!Object.keys(entries).length)return {clips,mapping,rejected};
  const baseRig=await rigProfile(base);
  for(const [state,entry] of Object.entries(entries)){
    let timer;const controller=new AbortController();
    try{
      if(!MOTION_STATES.includes(state)||!entry||typeof entry.url!=='string')throw new Error('Invalid motion entry');
      const url=new URL(entry.url,manifestURL),directory=new URL('./motions/',manifestURL);
      if(url.origin!==directory.origin||!url.pathname.startsWith(directory.pathname)||!url.pathname.endsWith('.glb'))throw new Error('Motion must be a local GLB');
      timer=setTimeout(()=>controller.abort(),12000);
      const response=await fetch(url,{signal:controller.signal});if(!response.ok)throw new Error(`HTTP ${response.status}`);
      const limit=2*1024*1024;
      if(Number(response.headers.get('content-length'))>limit)throw new Error('Animation pack exceeds 2 MiB');
      const reader=response.body.getReader(),parts=[];let length=0;
      try{while(true){const {value,done}=await reader.read();if(done)break;length+=value.byteLength;if(length>limit)throw new Error('Animation pack exceeds 2 MiB');parts.push(value);}}
      finally{await reader.cancel().catch(()=>{});}
      const joined=new Uint8Array(length);let offset=0;for(const part of parts){joined.set(part,offset);offset+=part.byteLength;}
      const bytes=joined.buffer;
      if(!/^[a-f0-9]{64}$/.test(entry.sha256||''))throw new Error('Missing motion checksum');
      const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
      if(digest!==entry.sha256)throw new Error('Motion checksum mismatch');
      const data=new DataView(bytes);
      if(bytes.byteLength<28||data.getUint32(0,true)!==0x46546c67||data.getUint32(4,true)!==2||data.getUint32(8,true)!==bytes.byteLength||data.getUint32(16,true)!==0x4e4f534a)throw new Error('Invalid motion GLB');
      const json=JSON.parse(new TextDecoder().decode(bytes.slice(20,20+data.getUint32(12,true))));
      if(json.meshes?.length||json.images?.length||json.buffers?.some(b=>b.uri)||json.extensionsRequired?.length)throw new Error('Animation-only, self-contained GLB required');
      const candidate=await loader.parseAsync(bytes,'');
      assertCompatibleRig(baseRig,await rigProfile(candidate));
      const clip=prepareMotion(base.scene,candidate.animations,entry,state);
      if(clip.duration/(state==='land'?.2:.36)>2.5)throw new Error('Playback is too fast; review the clip range');
      clips.push(clip);mapping[state]=clip.name;
    }catch(error){rejected.push(state);onWarning(`追加モーション ${state} を適用せず、従来の表示を継続します。`,error);}
    finally{clearTimeout(timer);}
  }
  return {clips,mapping,rejected};
}

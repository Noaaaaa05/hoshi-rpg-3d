import { readFileSync } from 'node:fs';
const path=process.argv[2]||'assets/models/hero_animated.glb';
const bytes=readFileSync(path);
if(bytes.toString('ascii',0,4)!=='glTF'||bytes.readUInt32LE(4)!==2)throw new Error('Expected GLB v2');
const declared=bytes.readUInt32LE(8);
if(declared!==bytes.length)throw new Error('GLB length mismatch');
let offset=12, json=null;
while(offset+8<=bytes.length){
  const length=bytes.readUInt32LE(offset),type=bytes.readUInt32LE(offset+4);
  if(offset+8+length>bytes.length)throw new Error('Invalid GLB chunk');
  if(type===0x4e4f534a)json=JSON.parse(bytes.toString('utf8',offset+8,offset+8+length).trim());
  offset+=8+length;
}
if(!json)throw new Error('GLB JSON missing');
const skins=json.skins||[],nodes=json.nodes||[],animations=json.animations||[];
const bones=[...new Set(skins.flatMap(s=>(s.joints||[]).map(i=>nodes[i]?.name||`node_${i}`)))];
const info={
  file:path,skins:skins.length,joints:bones.length,
  boneSamples:bones.slice(0,45),
  animations:animations.map(a=>({name:a.name||'(unnamed)',channels:(a.channels||[]).length})),
  meshes:(json.meshes||[]).length,
  hasHumanoidNames:bones.some(n=>/hips|pelvis/i.test(n))&&bones.some(n=>/spine/i.test(n))&&bones.some(n=>/foot/i.test(n))
};
console.log(JSON.stringify(info,null,2));
console.log('Inspection only: no Meshy API request, no credits used.');

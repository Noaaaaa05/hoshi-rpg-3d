import fs from 'node:fs';
import crypto from 'node:crypto';
const c=JSON.parse(fs.readFileSync('config/ai-world.json','utf8'));
const ids=new Set();
for(const z of c.zones){if(!/^[a-z][a-z0-9-]*$/.test(z.id)||ids.has(z.id))throw Error('Invalid or duplicate zone');ids.add(z.id);}
if(c.rules.paid_meshy_requests!==false||c.rules.requires_explicit_approval!==true||c.rules.automatic_merge!==false)throw Error('Unsafe paid/merge settings');
const tasks=[];
for(const z of c.zones){tasks.push({zone:z.id,kind:'terrain',id:z.terrain,method:'procedural-threejs'});for(const kind of ['structures','npcs','enemies'])for(const id of z[kind])tasks.push({zone:z.id,kind,id,method:kind==='structures'?'static-3d':'rigged-3d',status:'planned'});}
const hash=crypto.createHash('sha256').update(JSON.stringify(c)).digest('hex');
const plan={schema:1,style:c.style,config_sha256:hash,zones:c.zones.map(z=>({id:z.id,name:z.name})),tasks,motion_sets:c.motion_sets,approval:{paid_requests_authorized:false,credit_estimate:null},notice:'OFFLINE PLAN ONLY: No images, 3D models, motions or game assets have been generated. No paid API calls.'};
fs.mkdirSync('work/world',{recursive:true});fs.writeFileSync('work/world/plan.json',JSON.stringify(plan,null,2)+'\n');
console.log('World plan tasks:',tasks.length,'SHA256:',hash,'No paid API requests.');

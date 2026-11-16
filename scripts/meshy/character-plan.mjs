import fs from 'node:fs';
import crypto from 'node:crypto';
const config=JSON.parse(fs.readFileSync('config/ai-characters.json','utf8'));
const ids=new Set();
for(const c of config.characters){
 if(!/^[a-z][a-z0-9-]*$/.test(c.id)||ids.has(c.id)||!['hero','enemy'].includes(c.role)||!c.prompt?.trim()) throw Error('Invalid character config');
 ids.add(c.id);
}
if(!config.characters.some(c=>c.role==='hero')||!config.characters.some(c=>c.role==='enemy'))throw Error('Hero and enemy required');
const canonical=JSON.stringify(config);
const hash=crypto.createHash('sha256').update(canonical).digest('hex');
const plan={schema:1,config_sha256:hash,characters:config.characters.map(({id,role,name,prompt})=>({id,role,name,prompt,stages:['image','textured-3d','rigging','motions','validation','game-integration']})),motions:config.motions,skeleton:config.skeleton,paid_requests_authorized:false,estimated_credits:null,note:'Planning only. Exact cost must be verified against current Meshy API pricing before a separate explicit approval. No paid API calls.'};
fs.mkdirSync('work/characters',{recursive:true});
fs.writeFileSync('work/characters/plan.json',JSON.stringify(plan,null,2)+'\n');
console.log('Plan SHA256:',hash);
console.log('No Meshy requests were sent. No credits were used.');

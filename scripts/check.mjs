import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { conflictingImports } from './module-versions.mjs';
const files=(await readdir('js')).filter(p=>p.endsWith('.js')).map(p=>'js/'+p);
files.push('scripts/serve.mjs','scripts/check.mjs','scripts/module-versions.mjs');
for (const directory of ['scripts/meshy', 'scripts/rpg']) {
  files.push(...(await readdir(directory)).filter(p => p.endsWith('.mjs')).map(p => directory + '/' + p));
}
for(const file of files){const r=spawnSync(process.execPath,['--check',file],{stdio:'inherit'});if(r.status!==0)process.exit(r.status||1);}
const sources={};
for(const file of files.filter(p=>p.startsWith('js/')))sources[file]=await readFile(file,'utf8');
const conflicts=conflictingImports(sources);
if(conflicts.length)throw new Error('Use one import specifier per module, so the browser evaluates it once:\n'+conflicts.join('\n'));
JSON.parse(await readFile('assets/models/manifest.json','utf8'));
JSON.parse(await readFile('config/meshy-motions.json','utf8'));
const html=await readFile('index.html','utf8');
for(const file of ['style.css','js/main.js','vendor/three/three.module.js','vendor/three/addons/loaders/GLTFLoader.js','vendor/three/addons/utils/BufferGeometryUtils.js','vendor/three/addons/utils/SkeletonUtils.js','assets/icon.svg'])await readFile(file);
if(!html.includes('type="importmap"'))throw new Error('Missing module import map');
console.log(`Syntax and static assets OK (${files.length} JavaScript files).`);

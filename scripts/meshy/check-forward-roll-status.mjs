// Read-only Meshy task inspection. No paid generation calls, no retries.
const id='01a1e4b0-d14f-73d6-ab4e-9ff7c372edf1';
const key=process.env.MESHY_API_KEY;
if(!key)throw new Error('MESHY_API_KEY secret missing.');
const res=await fetch('https://api.meshy.ai/openapi/v1/text-to-motion/'+encodeURIComponent(id),{
  method:'GET',headers:{Authorization:'Bearer '+key,Accept:'application/json'},
  signal:AbortSignal.timeout(20000)
});
if(!res.ok)throw new Error('Read-only status GET failed: HTTP '+res.status);
const raw=await res.json();
const task=raw.result&&typeof raw.result==='object'?raw.result:raw;
const status=String(task.status??'UNKNOWN');
const safe=['PENDING','IN_PROGRESS','SUCCEEDED','FAILED','EXPIRED','CANCELED','UNKNOWN'];
const clean=safe.includes(status)?status:'UNKNOWN';
const output=task.output??task.result??{};
const names=output&&typeof output==='object'?Object.keys(output).filter(k=>!/(url|token|key|secret|auth)/i.test(k)).slice(0,12):[];
const fs=await import('node:fs');
fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
  '## Meshy forward roll — read-only status\\n\\n'.replaceAll('\\n','\n')+
  '- Task ID: `'+id+'`\n'+
  '- Status: **'+clean+'**\n'+
  '- Output metadata keys (excluding URLs): '+(names.join(', ')||'none')+'\n'+
  '- API calls: exactly one GET; **no paid generation, no retry**\n'+
  '- Output URLs are deliberately not logged.\n'
);
console.log('Read-only task status:',clean);
if(clean==='UNKNOWN')console.log('Top-level response keys:',Object.keys(task).filter(k=>!/(url|token|key|secret|auth)/i.test(k)).join(', '));

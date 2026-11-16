// Inspect the existing Meshy task with ONE read-only GET. Never print raw response or URLs.
const id='01a1e4b0-d14f-73d6-ab4e-9ff7c372edf1';
const key=process.env.MESHY_API_KEY;
if(!key)throw new Error('MESHY_API_KEY missing.');
const res=await fetch('https://api.meshy.ai/openapi/v1/text-to-motion/'+encodeURIComponent(id),{
 method:'GET',headers:{Authorization:'Bearer '+key,Accept:'application/json'},
 signal:AbortSignal.timeout(20000)
});
if(!res.ok)throw new Error('Read-only GET returned HTTP '+res.status);
const raw=await res.json();
const obj=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const result=obj(raw?.result)?raw.result:null;
const task=obj(raw?.data)?raw.data:result??raw;
const safeKey=k=>!/(url|uri|token|key|secret|auth|prompt|image|model|file|asset|download|output|result|error|message)/i.test(k);
const keys=x=>obj(x)?Object.keys(x).filter(safeKey).slice(0,20):[];
const candidates=[['task.status',task?.status],['result.status',result?.status],['raw.status',raw?.status],['task.state',task?.state],['raw.state',raw?.state]];
const valid=new Set(['PENDING','IN_PROGRESS','SUCCEEDED','SUCCESS','FAILED','EXPIRED','CANCELED','CANCELLED','PROCESSING','COMPLETED','QUEUED']);
const observed=candidates.filter(([,v])=>typeof v==='string'&&v.length<40).map(([p,v])=>[p,v.toUpperCase()]);
const recognized=observed.find(([,v])=>valid.has(v));
const status=recognized?.[1]??'UNKNOWN';
const output=obj(task?.output)?task.output:null;
const lines=[
 '## Meshy forward roll — diagnostic (read-only)',
 '',
 '- Existing task: `'+id+'`',
 '- Status: **'+status+'**',
 '- Status source: '+(recognized?.[0]??'not identified'),
 '- Status candidates (safe enum values only): '+(observed.filter(([,v])=>/^[A-Z_]{1,24}$/.test(v)).map(([p,v])=>p+'='+v).join(', ')||'none'),
 '- Top-level field names (filtered): '+(keys(raw).join(', ')||'none'),
 '- Task field names (filtered): '+(keys(task).join(', ')||'none'),
 '- Output field names (filtered): '+(keys(output).join(', ')||'none'),
 '- Response shape: '+(obj(raw)?'object':Array.isArray(raw)?'array':typeof raw),
 '- Exactly one GET; no paid generation, no retries; no raw payload, signed URLs, prompts or keys logged.'
];
const fs=await import('node:fs');
fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,lines.join('\n')+'\n');
console.log('Read-only diagnostic status:',status);

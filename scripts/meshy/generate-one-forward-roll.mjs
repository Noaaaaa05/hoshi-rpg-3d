// One approved Swift text-to-motion task. No retries, no other paid calls.
const { GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_SHA, MESHY_API_KEY, CONFIRM }=process.env;
const expected='APPROVE-ONE-FORWARD-ROLL-3-CREDITS';
if(CONFIRM!==expected)throw new Error('Exact manual approval phrase required.');
if(!GITHUB_TOKEN||!GITHUB_REPOSITORY||!GITHUB_SHA||!MESHY_API_KEY)throw new Error('Required environment secret missing.');
const api='https://api.meshy.ai/openapi/v1';
const github='https://api.github.com/repos/'+GITHUB_REPOSITORY;
const auth={Authorization:'Bearer '+MESHY_API_KEY,Accept:'application/json'};
const timeout=(ms)=>AbortSignal.timeout(ms);
const check=await fetch(api+'/balance',{headers:auth,signal:timeout(20000)});
if(!check.ok)throw new Error('Free balance preflight failed: HTTP '+check.status);
const balance=await check.json();
if(!Number.isInteger(balance.balance)||balance.balance<3)throw new Error('Insufficient or unknown API balance; no paid request made.');
console.log('Preflight: API balance sufficient for max 3 credits.');
// Atomic one-time reservation: creating this immutable tag succeeds at most once.
// Reserve BEFORE paid call, so even network uncertainty cannot trigger another paid POST.
const marker='refs/tags/meshy-one-shot-forward-roll-swift-2026-11-16';
const lock=await fetch(github+'/git/refs',{
  method:'POST',headers:{Authorization:'Bearer '+GITHUB_TOKEN,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28','Content-Type':'application/json'},
  body:JSON.stringify({ref:marker,sha:GITHUB_SHA}),signal:timeout(20000)
});
if(!lock.ok)throw new Error('One-time lock not created (possibly already used). HTTP '+lock.status+'. No paid call made.');
console.log('One-time lock reserved. No repeat or rerun permitted.');
const payload={
  prompt:'A fantasy swordsman starts upright in a ready stance, crouches and tucks chin, performs one fluid forward shoulder roll on the ground, then rises smoothly to the same upright ready stance. Athletic, grounded, no standing spin, no backflip.',
  mode:'swift',duration:3
};
if(payload.mode!=='swift'||payload.duration!==3||payload.prompt.length>400)throw new Error('Payload invariant failed.');
// Exactly ONE paid POST. No retry or polling. An uncertain response must NOT be retried.
const res=await fetch(api+'/text-to-motion',{
 method:'POST',headers:{...auth,'Content-Type':'application/json'},
 body:JSON.stringify(payload),signal:timeout(30000)
});
if(!res.ok)throw new Error('Single generation POST returned HTTP '+res.status+'. Do NOT rerun.');
const data=await res.json();
if(typeof data.result!=='string'||!data.result)throw new Error('Task response unexpected. Do NOT rerun; inspect task list manually.');
console.log('Meshy task created successfully. Task ID: '+data.result);
console.log('Swift clip requested; 3 API credits maximum for this one task.');
const fs=await import('node:fs');
fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,'## Meshy forward roll (one shot)\n\n- Mode: swift\n- Duration: 3 seconds\n- Authorized credit cap: 3\n- Task ID: `'+data.result+'`\n- Result: Task created (not necessarily finished)\n- Rerun: forbidden by one-time tag\n- No animation retargeting or additional paid calls\n');

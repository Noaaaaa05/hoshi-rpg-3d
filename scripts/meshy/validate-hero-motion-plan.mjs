import { readFileSync } from 'node:fs';
const plan=JSON.parse(readFileSync(new URL('../../config/meshy-hero-motion-plan.json',import.meta.url),'utf8'));
const sum=plan.steps.reduce((s,step)=>s+(step.credits||0),0);
if(plan.status!=='DRAFT_NOT_APPROVED'||plan.approval?.granted!==false||plan.apiRequestsEnabled!==false||plan.approval?.automaticRetries!==false)throw new Error('Plan must stay disabled until explicit user approval.');
if(sum!==17||plan.estimatedCredits.ifExistingRigWorks!==12||plan.estimatedCredits.ifNewRigNeeded!==17)throw new Error('Credit estimates need review.');
console.log('Hero motion plan validated. No Meshy API requests were made.');
console.log('Estimated credits: 12 if existing rig reusable; up to 17 if new rig required.');
console.log('Current status: NOT APPROVED; no paid generation permitted.');

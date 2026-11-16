import { readFile,writeFile,mkdir } from 'node:fs/promises';
import path from 'node:path';
import { makePlan } from './production.mjs';
const [batch,...args]=process.argv.slice(2),options={};
for(let i=0;i<args.length;i+=2){if(!['--review','--limit','--out','--publication','--source-publication','--offset','--ids'].includes(args[i])||!args[i+1])throw new Error('Unknown plan option');options[args[i].slice(2)]=args[i+1];}
if(!batch)throw new Error('Usage: npm run assets:plan -- <private-batch-directory> [--review review.json] [--limit 16] [--out plan.json]');
const catalog=JSON.parse(await readFile(path.join(batch,'catalog.json'),'utf8'));
const review=options.review?JSON.parse(await readFile(options.review,'utf8')):{};
if(options.publication&&!['true','false'].includes(options.publication))throw new Error('Publication must be true or false');
if(options['source-publication']&&!['true','false'].includes(options['source-publication']))throw new Error('Source publication must be true or false');
const plan=makePlan(catalog,review,{limit:Number(options.limit||16),offset:Number(options.offset||0),assetIds:options.ids?options.ids.split(','):null,publication:options.publication==='true',sourcePublication:options['source-publication']==='true'}),output=options.out||path.join(batch,'production-plan.json');
await mkdir(path.dirname(output),{recursive:true});await writeFile(output,JSON.stringify(plan,null,2)+'\n');
console.log(JSON.stringify({planSHA256:plan.sha256,proposed:plan.proposedCount,ready:plan.readyCount,estimatedCreditsIfAllApproved:plan.estimatedCreditsIfAllApproved,networkRequests:0,paidApproved:false},null,2));

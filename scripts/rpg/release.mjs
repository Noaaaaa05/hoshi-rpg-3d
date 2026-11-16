import { appendFile, readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { branchPattern, releaseGate, shaPattern } from './release-gate.mjs';

const shell = promisify(execFile);
const repo = 'Noaaaaa05/hoshi-rpg-3d';
const owner = repo.split('/')[0];
const root = 'https://api.github.com/repos/' + repo;
const key = process.env.GH_TOKEN;

async function api(path, method = 'GET', body) {
  const url = root + path;
  if (!key && method === 'GET') {
    const {stdout} = await shell('curl', ['--silent', '--fail', '--max-time', '20', '--', url],
      {maxBuffer: 3 * 1024 * 1024}).catch(() => { throw new Error('GitHub read failed for ' + path.split('?')[0]); });
    return JSON.parse(stdout);
  }
  if (!key) throw new Error('GitHub write token is unavailable');
  const response = await fetch(url, {method, redirect:'error', signal:AbortSignal.timeout(20000), headers: {
    Authorization:'Bearer ' + key, Accept:'application/vnd.github+json', 'Content-Type':'application/json',
  }, body: body === undefined ? undefined : JSON.stringify(body)}).catch(() => { throw new Error('GitHub connection failed'); });
  if (!response.ok) throw new Error('GitHub HTTP ' + response.status + ' for ' + path.split('?')[0]);
  return response.json();
}

let write = false;
let number, head, expectedRunId;
try {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--workflow') {
    if (process.env.GITHUB_REPOSITORY !== repo || process.env.GITHUB_EVENT_NAME !== 'workflow_run') throw new Error('Expected the repository workflow event');
    const {workflow_run: run} = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
    if (run?.event !== 'pull_request' || run?.conclusion !== 'success' ||
        run.head_repository?.full_name !== repo || !branchPattern.test(run.head_branch)) {
      throw new Error('Expected a successful same-repository content workflow');
    }
    const related = await api('/pulls?state=open&base=main&head=' + encodeURIComponent(owner + ':' + run.head_branch));
    if (related.length !== 1 || related[0].head?.sha !== run.head_sha) throw new Error('Expected one open PR at the checked head');
    number = related[0].number;
    head = run.head_sha;
    expectedRunId = run.id;
    write = true;
  } else if (args.length === 2) [number, head] = [Number(args[0]), args[1]];
  else throw new Error('Usage: npm run rpg:release -- <PR number> <checked head SHA>');

  const report = await releaseGate({get: api, repo, owner, number, expectedHead: head, expectedRunId});
  console.log(JSON.stringify({ready:true, ...report}));
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, 'PR #' + number + ' passed the RPG release gate.\n');
  if (write) {
    const pages = await api('/pages');
    if (pages.build_type !== 'legacy' || pages.source?.branch !== 'main' || pages.source?.path !== '/') {
      throw new Error('Automatic release expects the existing Pages source main /(root). Use Work to release this PR.');
    }
    const latest = await api('/branches/main');
    if (latest.commit?.sha !== report.base) throw new Error('The target branch moved before merge');
    const merge = await api('/pulls/' + number + '/merge', 'PUT', {sha: report.head, merge_method:'merge'});
    if (!merge.merged || !shaPattern.test(merge.sha)) throw new Error('GitHub did not confirm the merge');
    console.log('Merged PR #' + number + ' at ' + merge.sha);
    try {
      await api('/pages/builds', 'POST');
    } catch (error) {
      throw new Error('PR #' + number + ' is merged. Request a Pages build for ' + merge.sha + '. ' + error.message);
    }
    console.log('Requested GitHub Pages publication for ' + merge.sha);
  }
} catch (error) {
  console.error('RPG release stopped: ' + error.message);
  process.exitCode = 1;
}

import { isDeepStrictEqual } from 'node:util';
import { CATEGORIES, CONTENT_PATH, MAX_CATALOG_BYTES, parseCatalog } from '../../js/rpg-content.js';

const CHECK_WORKFLOW = '.github/workflows/check.yml';
export const shaPattern = /^[a-f0-9]{40}$/;
export const branchPattern = /^codex\/rpg-content-[a-z0-9-]{1,62}$/;
const requiredSteps = ['Run npm run check', 'Validate RPG catalog', 'Run npm test', 'Run npm run test:browser'];
const stop = message => { throw new Error(message); };
const equalsRepo = (value, repo) => value?.toLowerCase() === repo.toLowerCase();

export function additiveCatalog(base, next) {
  let additions = 0;
  for (const type of CATEGORIES) {
    for (const key of Object.keys(base[type])) {
      if (!Object.hasOwn(next[type], key) || !isDeepStrictEqual(base[type][key], next[type][key])) {
        stop('Existing catalog entries require a reviewed release: ' + type + '.' + key);
      }
    }
    additions += Object.keys(next[type]).length - Object.keys(base[type]).length;
  }
  if (additions < 1 || additions > 25) stop('Expected 1–25 additive catalog entries');
  return additions;
}

function readCatalog(response) {
  if (response.path !== CONTENT_PATH || response.type !== 'file' || response.encoding !== 'base64' ||
      response.size > MAX_CATALOG_BYTES || typeof response.content !== 'string') stop('Cannot verify the catalog bytes');
  return parseCatalog(Buffer.from(response.content, 'base64').toString('utf8'));
}

function checkedRun(run, pr, workflow, repo, expectedRunId) {
  if (!run || run.workflow_id !== workflow.id || run.path?.split('@')[0] !== CHECK_WORKFLOW ||
      run.event !== 'pull_request' || run.head_sha !== pr.head.sha || run.head_branch !== pr.head.ref ||
      !equalsRepo(run.head_repository?.full_name, repo) ||
      (expectedRunId !== undefined && run.id !== expectedRunId) ||
      (run.pull_requests?.length && !run.pull_requests.some(link => link.number === pr.number &&
        link.head?.sha === pr.head.sha && link.base?.ref === pr.base.ref))) {
    stop('The Game checks run does not match the current PR head and base');
  }
  if (run.status !== 'completed' || run.conclusion !== 'success') stop('The latest PR Game checks must succeed');
}

export async function releaseGate({get, repo, owner, number, expectedHead, expectedRunId}) {
  if (!Number.isSafeInteger(number) || number <= 0 || !shaPattern.test(expectedHead)) stop('PR number and reviewed head SHA required');
  const pr = await get('/pulls/' + number);
  if (pr.number !== number || pr.state !== 'open' || pr.draft || pr.mergeable !== true || pr.mergeable_state !== 'clean' ||
      !equalsRepo(pr.base.repo?.full_name, repo) || pr.base.ref !== 'main' ||
      !equalsRepo(pr.head.repo?.full_name, repo) || !branchPattern.test(pr.head.ref) || pr.head.sha !== expectedHead ||
      !equalsRepo(pr.user?.login, owner) || !shaPattern.test(pr.base.sha)) {
    stop('PR must be an open, mergeable, same-repository RPG content PR on the reviewed head');
  }
  // Do not interpret titles, descriptions, labels, artifact contents or arbitrary commands.
  if (pr.changed_files !== 1) stop('Automatic release accepts the catalog file only');
  const [branch, files, workflow, combined, before, after, lineage] = await Promise.all([
    get('/branches/main'),
    get('/pulls/' + number + '/files?per_page=10'),
    get('/actions/workflows/check.yml'),
    get('/commits/' + expectedHead + '/status'),
    get('/contents/' + CONTENT_PATH + '?ref=' + pr.base.sha),
    get('/contents/' + CONTENT_PATH + '?ref=' + expectedHead),
    get('/compare/' + pr.base.sha + '...' + expectedHead + '?per_page=1'),
  ]);
  if (branch.commit?.sha !== pr.base.sha || lineage.status !== 'ahead' || lineage.behind_by !== 0 ||
      lineage.merge_base_commit?.sha !== pr.base.sha) stop('PR head must contain the latest main commit');
  if (!Array.isArray(files) || files.length !== 1 || files[0].filename !== CONTENT_PATH || files[0].status !== 'modified') {
    stop('Automatic release accepts an additive catalog change only');
  }
  if (workflow.path !== CHECK_WORKFLOW || workflow.state !== 'active' || !Number.isSafeInteger(workflow.id)) stop('Game checks workflow unavailable');
  if (!Array.isArray(combined.statuses) || combined.statuses.some(status => status.state !== 'success')) stop('A commit status is pending or failed');
  const additions = additiveCatalog(readCatalog(before), readCatalog(after));
  const runs = (await get('/actions/workflows/' + workflow.id + '/runs?event=pull_request&head_sha=' + expectedHead + '&per_page=10')).workflow_runs;
  const run = runs?.find(candidate => candidate.head_branch === pr.head.ref);
  checkedRun(run, pr, workflow, repo, expectedRunId);
  const { jobs } = await get('/actions/runs/' + run.id + '/jobs?per_page=30');
  const game = jobs?.find(job => job.name === 'game');
  if (game?.conclusion !== 'success' || !requiredSteps.every(name =>
    game.steps?.some(step => step.name === name && step.conclusion === 'success'))) {
    stop('Static, content, unit and browser check steps must succeed');
  }
  const checks = await get('/commits/' + expectedHead + '/check-runs?filter=latest&per_page=100');
  if (!Array.isArray(checks.check_runs) || checks.total_count !== checks.check_runs.length ||
      checks.check_runs.some(check => check.status !== 'completed' || !['success','skipped','neutral'].includes(check.conclusion))) {
    stop('At least one commit check is incomplete or unsuccessful');
  }
  return { pr: number, head: expectedHead, base: pr.base.sha, run: run.id, additions };
}

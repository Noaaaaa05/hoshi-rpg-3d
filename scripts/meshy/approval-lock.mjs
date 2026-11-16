// A unique Git ref reserves the user's approval across Actions runs and runner failures.
export function approvalReservation(env, fetchImpl = fetch) {
  const { MESHY_APPROVAL_ID: id, GITHUB_TOKEN: key, GITHUB_SHA: sha } = env;
  if (!/^[a-z0-9][a-z0-9-]{7,63}$/.test(id ?? '') || !key || !/^[a-f0-9]{40}$/.test(sha ?? '') ||
      env.GITHUB_ACTIONS !== 'true' || env.GITHUB_RUN_ATTEMPT !== '1' || env.GITHUB_REF !== 'refs/heads/main' ||
      env.GITHUB_REPOSITORY !== 'Noaaaaa05/hoshi-rpg-3d' || env.GITHUB_ACTOR !== env.GITHUB_REPOSITORY_OWNER) {
    throw new Error('Paid mode needs a fresh, owner-authorized main workflow and an approval ID');
  }
  return async () => {
    let response;
    try {
      response = await fetchImpl('https://api.github.com/repos/Noaaaaa05/hoshi-rpg-3d/git/refs', {
        method:'POST', redirect:'error', signal:AbortSignal.timeout(15000),
        headers:{Authorization:'Bearer '+key, Accept:'application/vnd.github+json', 'Content-Type':'application/json'},
        body:JSON.stringify({ref:'refs/tags/meshy-approval-'+id, sha}),
      });
    } catch { throw new Error('The approval reservation outcome is unknown. Reconcile it before another paid submission.'); }
    if (response.status !== 201) throw new Error('Approval could not be reserved (HTTP '+response.status+'). No new paid task was submitted.');
  };
}

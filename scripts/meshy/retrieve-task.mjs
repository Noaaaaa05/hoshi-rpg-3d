import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const API = 'https://api.meshy.ai';
const statuses = new Set(['PENDING', 'IN_PROGRESS', 'SUCCEEDED', 'FAILED', 'EXPIRED', 'CANCELED', 'CANCELLED']);
const statusAliases = new Map([['QUEUED','PENDING'],['PROCESSING','IN_PROGRESS'],['COMPLETED','SUCCEEDED'],['SUCCESS','SUCCEEDED']]);
const resources = {
  motion: ['/openapi/v1/text-to-motion/', 'motion'],
  animation: ['/openapi/v1/animations/', 'animation_glb_url'],
  rigging: ['/openapi/v1/rigging/', 'rigged_character_glb_url'],
  'text-to-3d': ['/openapi/v2/text-to-3d/', 'model'],
  'image-to-3d': ['/openapi/v1/image-to-3d/', 'model'],
};
export const TASK_KINDS = Object.keys(resources);
const idPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i;
const maxBytes = 25 * 1024 * 1024;

function statusOf(task) {
  for (const value of [task?.status, task?.state]) {
    if (typeof value !== 'string') continue;
    const status = value.trim().toUpperCase();
    if (statuses.has(status)) return status;
    if (statusAliases.has(status)) return statusAliases.get(status);
  }
  return null;
}

async function get(fetchImpl, url, headers) {
  let response;
  try {
    response = await fetchImpl(url, { method: 'GET', redirect: 'error', headers, signal: AbortSignal.timeout(45000) });
  } catch { throw new Error('Meshy GET connection failed'); }
  if (!response.ok) throw new Error('Meshy GET returned HTTP ' + response.status);
  return response;
}

function identifyAsset(task, type) {
  const result = task.result ?? task.output ?? task;
  if (type === 'model') return { link: (task.model_urls ?? result.model_urls)?.glb, format: 'glb' };
  if (type === 'motion') {
    const format = typeof result.motion_format === 'string' ? result.motion_format.toLowerCase() : '';
    return { link: result.motion_url, format: ['bvh', 'fbx'].includes(format) ? format : null };
  }
  return { link: result[type], format: 'glb' };
}

function expectedHeader(bytes, format) {
  if (format === 'glb') return bytes.length >= 28 && bytes.toString('ascii', 0, 4) === 'glTF' &&
    bytes.readUInt32LE(4) === 2 && bytes.readUInt32LE(8) === bytes.length;
  if (format === 'bvh') return /^\s*HIERARCHY\s+ROOT\s+/i.test(bytes.toString('utf8', 0, 256));
  return bytes.toString('ascii', 0, 20) === 'Kaydara FBX Binary  ' || /^\s*;\s*FBX /i.test(bytes.toString('utf8', 0, 128));
}

async function downloadAsset(fetchImpl, link, format) {
  let url;
  try { url = new URL(link); } catch { throw new Error('The completed task has no supported download'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port ||
      !(url.hostname === 'assets.meshy.ai' || url.hostname.endsWith('.assets.meshy.ai'))) {
    throw new Error('Unexpected Meshy download host');
  }
  const response = await get(fetchImpl, url.href);
  if (!response.body || Number(response.headers.get('content-length')) > maxBytes) throw new Error('Missing or oversized asset');
  const reader = response.body.getReader(), chunks = [];
  let length = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maxBytes) throw new Error('Downloaded asset exceeds 25 MiB');
      chunks.push(Buffer.from(value));
    }
  } finally { await reader.cancel().catch(() => {}); }
  const bytes = Buffer.concat(chunks);
  if (!expectedHeader(bytes, format)) throw new Error('Download does not match the expected format');
  return bytes;
}

export async function retrieveTask({kind, id, apiKey, download = false, fetchImpl = fetch}) {
  if (!idPattern.test(id ?? '') || !TASK_KINDS.includes(kind)) throw new Error('A supported task kind and UUID are required');
  if (!apiKey) throw new Error('MESHY_API_KEY is not available');
  const [endpoint, type] = resources[kind];
  const response = await get(fetchImpl, API + endpoint + id, { Authorization: 'Bearer ' + apiKey, Accept: 'application/json' });
  let raw;
  try { raw = await response.json(); } catch { throw new Error('Meshy task response was not JSON'); }
  const candidates = [raw, raw?.data, raw?.result, raw?.data?.result];
  const task = candidates.find(value => value?.id === id && statusOf(value)) ??
    candidates.find(value => !value?.id && statusOf(value));
  const status = statusOf(task) ?? 'UNKNOWN';
  const report = { kind, id, status, requests: 1 };
  if (Number.isInteger(task?.progress) && task.progress >= 0 && task.progress <= 100) report.progress = task.progress;
  if (status !== 'SUCCEEDED') return { report };
  const { link, format } = identifyAsset(task, type);
  report.format = format;
  report.available = Boolean(link && format);
  if (!download || !report.available) return { report };
  const bytes = await downloadAsset(fetchImpl, link, format);
  report.requests++;
  report.size = bytes.length;
  report.sha256 = createHash('sha256').update(bytes).digest('hex');
  return { report, bytes };
}

async function run() {
  const [kind, id, output] = process.argv.slice(2);
  if (![4, 5].includes(process.argv.length)) throw new Error('Usage: npm run meshy:retrieve -- <kind> <task-uuid> [output-directory]');
  const { report, bytes } = await retrieveTask({kind, id, apiKey: process.env.MESHY_API_KEY, download: Boolean(output)});
  console.log(JSON.stringify(report));
  if (output) {
    await mkdir(output, { recursive: true });
    await writeFile(join(output, 'task.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    if (bytes) await writeFile(join(output, 'asset.' + report.format), bytes, { flag: 'wx' });
  }
  if (report.status === 'UNKNOWN' || (output && report.status === 'SUCCEEDED' && !bytes)) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await run().catch(error => {
    const message = /^(Meshy GET returned HTTP \d{3}|Meshy GET connection failed|MESHY_API_KEY is not available|A supported task kind and UUID are required|Unexpected Meshy download host|Download does not match the expected format|Meshy task response was not JSON|Downloaded asset exceeds 25 MiB|Missing or oversized asset|The completed task has no supported download|Usage: npm run meshy:retrieve -- <kind> <task-uuid> \[output-directory\])$/.test(error?.message);
    console.error(message ? error.message : 'Meshy read-only task inspection stopped');
    process.exitCode = 1;
  });
}

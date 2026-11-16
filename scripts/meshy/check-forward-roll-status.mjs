import { appendFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { createClient } from './pipeline.mjs';

const taskId = '01a1e4b0-d14f-73d6-ab4e-9ff7c372edf1';
const statusValues = new Set([
  'PENDING', 'QUEUED', 'IN_PROGRESS', 'PROCESSING', 'SUCCEEDED', 'SUCCESS', 'COMPLETED',
  'FAILED', 'EXPIRED', 'CANCELED', 'CANCELLED'
]);
const completedValues = new Set(['SUCCEEDED', 'SUCCESS', 'COMPLETED']);
const knownFields = ['id', 'type', 'status', 'state', 'data', 'result', 'output',
  'progress', 'motion_url', 'motion_format', 'mode', 'duration_ms', 'expires_at'];
const { MESHY_API_KEY, GITHUB_STEP_SUMMARY, GITHUB_OUTPUT, MESHY_DOWNLOAD_DIR } = process.env;

function statusOf(value) {
  return [value?.status, value?.state]
    .filter(field => typeof field === 'string')
    .map(field => field.trim().toUpperCase())
    .find(field => statusValues.has(field));
}

function safeFields(value) {
  return knownFields.filter(field => value && Object.hasOwn(value, field)).join(', ') || 'none';
}

async function note(line) {
  await appendFile(GITHUB_STEP_SUMMARY, line + '\n');
}

async function safeRequest(request, errorPrefix, errorPattern) {
  try {
    return await request();
  } catch (error) {
    const http = errorPattern.exec(error?.message)?.[1];
    const message = http ? errorPrefix + ' HTTP ' + http : errorPrefix;
    await note('- ' + message);
    console.error(message);
    process.exitCode = 1;
  }
}

async function inspect() {
  await note('## Existing Meshy forward-roll task (free GET only)');
  await note('- Task ID: `' + taskId + '`');
  if (!MESHY_API_KEY) {
    await note('- MESHY_API_KEY is unavailable to this job.');
    process.exitCode = 1;
    return;
  }

  const client = createClient(MESHY_API_KEY);
  const raw = await safeRequest(() => client.request('/text-to-motion/' + taskId),
    'Status lookup failed.', /^Meshy HTTP ([1-5]\d\d);/);
  if (process.exitCode) return;

  const candidates = [raw, raw?.data, raw?.result, raw?.data?.result];
  const task = candidates.find(value => value?.id === taskId && statusOf(value)) ??
    candidates.find(value => statusOf(value) && (value?.id === undefined || value.id === taskId));
  const status = statusOf(task) ?? 'UNKNOWN';
  console.log('Read-only diagnostic status:', status);
  await note('- Status: **' + status + '**');
  await note('- Response fields: ' + safeFields(raw));
  await note('- Task fields: ' + safeFields(task));
  if (typeof task?.progress === 'number' && Number.isInteger(task.progress) && task.progress >= 0 && task.progress <= 100) {
    await note('- Progress: ' + task.progress + '%');
  }
  if (!completedValues.has(status)) return;

  const result = [task.result, task.output, task].find(value => typeof value?.motion_url === 'string' && value.motion_url);
  if (result?.motion_format !== 'bvh') {
    await note('- The expected Swift BVH download is unavailable.');
    process.exitCode = 1;
    return;
  }

  const bytes = await safeRequest(() => client.download(result.motion_url),
    'BVH download failed.', /^GLB download HTTP ([1-5]\d\d)$/);
  if (!bytes) return;
  const header = bytes.subarray(0, 512).toString('utf8');
  if (!/^\s*HIERARCHY\s+ROOT\s+/i.test(header)) {
    await note('- The downloaded bytes do not have a BVH header.');
    process.exitCode = 1;
    return;
  }
  await mkdir(MESHY_DOWNLOAD_DIR, { recursive: true });
  await writeFile(join(MESHY_DOWNLOAD_DIR, 'forward-roll.bvh'), bytes);
  await appendFile(GITHUB_OUTPUT, 'downloaded=true\n');
  const checksum = createHash('sha256').update(bytes).digest('hex');
  console.log('Swift BVH downloaded:', bytes.length, 'bytes; SHA-256', checksum);
  await note('- BVH: ' + bytes.length + ' bytes, SHA-256 `' + checksum + '`.');
}

await inspect().catch(() => {
  console.error('The read-only workflow could not finish.');
  process.exitCode = 1;
});

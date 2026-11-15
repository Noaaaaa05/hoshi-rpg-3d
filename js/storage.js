import { clamp, WORLD_RADIUS } from './physics.js';
const KEY = 'hoshi-rpg-3d:v0.1';
export function loadSave() {
  try {
    const data = JSON.parse(localStorage.getItem(KEY));
    if (!data || data.version !== 1) return null;
    const position = data.position;
    const validPosition = position && Number.isFinite(position.x) && Number.isFinite(position.z) && Math.hypot(position.x, position.z) <= WORLD_RADIUS;
    return { position: validPosition ? position : null,
      stars: Array.isArray(data.stars) ? [...new Set(data.stars.filter(v => Number.isInteger(v) && v >= 0 && v < 8))] : [],
      landmarks: Array.isArray(data.landmarks) ? [...new Set(data.landmarks.filter(v => ['gate','tree','camp'].includes(v)))] : [],
      quality: ['auto','low','high'].includes(data.quality) ? data.quality : 'auto',
      sensitivity: Number.isFinite(data.sensitivity) ? clamp(data.sensitivity, .4, 1.8) : 1 };
  } catch { return null; }
}
export function writeSave(data) {
  try { localStorage.setItem(KEY, JSON.stringify({ ...data, version: 1 })); return true; }
  catch { return false; }
}

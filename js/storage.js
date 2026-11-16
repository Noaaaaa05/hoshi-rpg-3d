import { clamp, WORLD_RADIUS } from './physics.js?v=0.2.8';
import { normalizeProgression, maxHPForLevel } from './combat.js?v=0.2.7';
// Keep the same key so v0.1 exploration saves migrate without losing progress.
const KEY = 'hoshi-rpg-3d:v0.1';
export function loadSave() {
  try {
    const data = JSON.parse(localStorage.getItem(KEY));
    if (!data || ![1,2].includes(data.version)) return null;
    const position = data.position;
    const validPosition = position && Number.isFinite(position.x) && Number.isFinite(position.z) && Math.hypot(position.x, position.z) <= WORLD_RADIUS;
    const progression = normalizeProgression(data.progression);
    return { position: validPosition ? position : null, progression,
      hp: Number.isFinite(data.hp) ? clamp(data.hp,1,maxHPForLevel(progression.level)) : maxHPForLevel(progression.level),
      stars: Array.isArray(data.stars) ? [...new Set(data.stars.filter(v => Number.isInteger(v) && v >= 0 && v < 8))] : [],
      landmarks: Array.isArray(data.landmarks) ? [...new Set(data.landmarks.filter(v => ['gate','tree','camp'].includes(v)))] : [],
      quality: ['auto','low','high'].includes(data.quality) ? data.quality : 'auto',
      sensitivity: Number.isFinite(data.sensitivity) ? clamp(data.sensitivity, .4, 1.8) : 1,
      ...(data.rpg && typeof data.rpg==='object' && !Array.isArray(data.rpg) ? {rpg:data.rpg} : {}),
      villageInventory: {
        herbs:Number.isInteger(data.villageInventory?.herbs)?clamp(data.villageInventory.herbs,0,999):0,
        gold:Number.isInteger(data.villageInventory?.gold)?clamp(data.villageInventory.gold,0,999999):100
      } };
  } catch { return null; }
}
export function writeSave(data) {
  try { localStorage.setItem(KEY, JSON.stringify({ ...data, version: 2 })); return true; }
  catch { return false; }
}

import { SPAWN, WORLD_RADIUS } from './physics.js';

export const CONTENT_PATH = 'assets/rpg/catalog.json';
export const CATEGORIES = ['models', 'motions', 'actors', 'zones', 'placements', 'dialogues', 'quests', 'items', 'skills'];
export const MAX_CATALOG_BYTES = 128 * 1024;
export const MAX_MODEL_BYTES = 5 * 1024 * 1024;
export const MAX_PACK_BYTES = 2 * 1024 * 1024;
const PRESETS = ['scout', 'beacon', 'cottage', 'slime', 'goblin'];
const QUEST_STATES = ['active', 'ready', 'complete'];
const identifier = value => typeof value === 'string' &&
  /^[a-z][a-z0-9-]{0,47}$/.test(value) && !['constructor', 'prototype'].includes(value);
const assetPath = value => typeof value === 'string' && /^models\/(?:[a-z0-9_-]+\/)*[a-z0-9_-]+\.glb$/i.test(value);
const checksum = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max;
const number = (value, min, max) => Number.isFinite(value) && value >= min && value <= max;
const integer = (value, min, max) => Number.isInteger(value) && number(value, min, max);
const oneOf = (value, values) => values.includes(value);
const choiceCondition = value => value === 'available' || QUEST_STATES.includes(value);
const optional = (value, validate) => value === undefined || validate(value);

function requireValue(condition, path, reason) {
  if (!condition) throw new Error(path + ': ' + reason);
}

function shape(value, path, keys) {
  requireValue(isRecord(value), path, 'object expected');
  for (const key of Object.keys(value)) requireValue(keys.includes(key), path + '.' + key, 'unknown field');
}

function record(value, path, limit, visit) {
  requireValue(isRecord(value) && Object.keys(value).length <= limit, path, 'object or entry limit');
  for (const [id, spec] of Object.entries(value)) {
    requireValue(identifier(id), path + '.' + id, 'invalid identifier');
    visit(spec, path + '.' + id, id);
  }
}

export function emptyCatalog() {
  return { version: 1, ...Object.fromEntries(CATEGORIES.map(type => [type, {}])) };
}

export function parseCatalog(source) {
  requireValue(typeof source === 'string' && new TextEncoder().encode(source).length <= MAX_CATALOG_BYTES,
    'catalog', 'file size limit');
  return validateCatalog(JSON.parse(source));
}

export function validateCatalog(catalog) {
  shape(catalog, 'catalog', ['version', ...CATEGORIES]);
  requireValue(catalog.version === 1, 'catalog.version', 'supported version is 1');
  for (const category of CATEGORIES) requireValue(isRecord(catalog[category]), category, 'object expected');
  const ref = (type, id) => identifier(id) && Object.hasOwn(catalog[type], id);
  const hue = value => typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
  record(catalog.models, 'models', 48, (spec, path) => {
    shape(spec, path, ['type', 'height', 'preset', 'color', 'file', 'sha256', 'bones', 'rotationY']);
    requireValue(oneOf(spec.type, ['glb', 'procedural']) && number(spec.height, .25, 12) &&
      PRESETS.includes(spec.preset) && hue(spec.color) && optional(spec.rotationY, v => number(v, -Math.PI, Math.PI)),
    path, 'type, height, preset, color or orientation is invalid');
    if (spec.type === 'glb') {
      requireValue(assetPath(spec.file) && checksum(spec.sha256) && integer(spec.bones, 0, 128), path, 'local GLB, checksum and bone count required');
    } else {
      requireValue(spec.file === undefined && spec.sha256 === undefined && spec.bones === undefined, path, 'procedural models have no file');
    }
  });
  record(catalog.motions, 'motions', 128, (spec, path) => {
    shape(spec, path, ['model', 'clip', 'loop', 'speed', 'blend', 'range', 'file', 'sha256']);
    requireValue(ref('models', spec.model) && catalog.models[spec.model].type === 'glb' &&
      catalog.models[spec.model].bones > 0 && text(spec.clip, 128) &&
      typeof spec.loop === 'boolean' && number(spec.speed, .25, 3) && number(spec.blend, .01, .5), path, 'model or playback settings are invalid');
    requireValue(spec.file === undefined ? spec.sha256 === undefined : assetPath(spec.file) && checksum(spec.sha256), path, 'invalid animation pack path or checksum');
    requireValue(optional(spec.range, v => Array.isArray(v) && v.length === 2 && number(v[0], 0, 30) &&
      number(v[1], 0, 30) && v[1] > v[0]), path, 'invalid playback range');
  });
  record(catalog.actors, 'actors', 40, (spec, path) => {
    shape(spec, path, ['name', 'role', 'model', 'motions', 'dialogue', 'enemy']);
    requireValue(text(spec.name, 64) && oneOf(spec.role, ['npc', 'companion', 'enemy']) &&
      ref('models', spec.model), path, 'name, role or model is invalid');
    requireValue(optional(spec.dialogue, id => spec.role !== 'enemy' && ref('dialogues', id)), path, 'invalid dialogue');
    record(spec.motions ?? {}, path + '.motions', 32, (id, at) => {
      requireValue(ref('motions', id) && catalog.motions[id].model === spec.model, at, 'motion must target the actor model');
    });
    if (spec.role === 'enemy') {
      shape(spec.enemy, path + '.enemy', ['variant', 'hp', 'damage', 'xp', 'speed', 'radius', 'range', 'windup', 'recovery']);
      const e = spec.enemy;
      requireValue(oneOf(e.variant, ['slime', 'goblin']) && integer(e.hp, 1, 5000) && integer(e.damage, 1, 250) &&
        integer(e.xp, 0, 500) && number(e.speed, .1, 8) && number(e.radius, .15, 1.7) &&
        number(e.range, .5, 4) && number(e.windup, .15, 4) && number(e.recovery, .1, 5), path, 'invalid enemy attributes');
    } else requireValue(spec.enemy === undefined, path, 'enemy attributes require the enemy role');
  });
  record(catalog.zones, 'zones', 24, (spec, path) => {
    shape(spec, path, ['name', 'kind', 'x', 'z', 'radius', 'exit']);
    requireValue(text(spec.name, 64) && oneOf(spec.kind, ['town', 'village', 'forest', 'dungeon']) &&
      number(spec.radius, 1.5, 25) && Math.hypot(spec.x, spec.z) + spec.radius < WORLD_RADIUS &&
      Number.isFinite(spec.x) && Number.isFinite(spec.z), path, 'zone must fit inside the existing world');
    requireValue(optional(spec.exit, id => ref('zones', id) && catalog.zones[id] !== spec), path, 'invalid exit');
  });
  const placedCompanions = new Set();
  let enemyCount = 0;
  record(catalog.placements, 'placements', 48, (spec, path) => {
    shape(spec, path, ['zone', 'model', 'actor', 'x', 'z', 'yaw', 'collider']);
    requireValue(ref('zones', spec.zone) && Number.isFinite(spec.x) && Number.isFinite(spec.z) &&
      optional(spec.yaw, v => number(v, -Math.PI, Math.PI)), path, 'invalid zone or placement');
    const zone = catalog.zones[spec.zone];
    requireValue(Math.hypot(spec.x - zone.x, spec.z - zone.z) <= zone.radius, path, 'placement is outside its zone');
    requireValue(spec.actor === undefined ? ref('models', spec.model) : spec.model === undefined && ref('actors', spec.actor),
      path, 'specify one model or actor');
    requireValue(optional(spec.collider, v => spec.actor === undefined && number(v, .1, 4)), path, 'invalid prop collider');
    const actor = spec.actor === undefined ? undefined : catalog.actors[spec.actor];
    if (actor?.role === 'enemy') {
      enemyCount++;
      requireValue(enemyCount <= 16 && Math.hypot(spec.x - SPAWN.x, spec.z - SPAWN.z) >= 10, path, 'enemy count or spawn safety');
    }
    if (actor?.role === 'companion') {
      requireValue(!placedCompanions.has(spec.actor), path, 'companion can only be placed once');
      placedCompanions.add(spec.actor);
    }
  });
  record(catalog.items, 'items', 64, (spec, path) => {
    shape(spec, path, ['name', 'kind', 'heal', 'attackBonus']);
    requireValue(text(spec.name, 64) && oneOf(spec.kind, ['keepsake', 'consumable', 'weapon']) &&
      (spec.kind === 'consumable' ? integer(spec.heal, 1, 100) : spec.heal === undefined) &&
      (spec.kind === 'weapon' ? integer(spec.attackBonus, 1, 30) : spec.attackBonus === undefined), path, 'invalid item');
  });
  record(catalog.quests, 'quests', 48, (spec, path) => {
    shape(spec, path, ['name', 'description', 'chapter', 'goal', 'reward', 'requires']);
    shape(spec.goal, path + '.goal', ['kind', 'target', 'count']);
    shape(spec.reward, path + '.reward', ['item', 'count']);
    const goal = spec.goal;
    requireValue(text(spec.name, 64) && text(spec.description, 320) && oneOf(spec.chapter, ['main', 'side']) &&
      (goal.kind === 'visit' ? ref('zones', goal.target) && goal.count === 1 :
        goal.kind === 'defeat' && ref('actors', goal.target) && catalog.actors[goal.target].role === 'enemy' && integer(goal.count, 1, 10)) &&
      ref('items', spec.reward.item) && integer(spec.reward.count, 1, 20) &&
      optional(spec.requires, v => Array.isArray(v) && v.length <= 8 && v.every(id => ref('quests', id))), path, 'invalid quest');
  });
  const reviewed = new Set(), visiting = new Set();
  function reviewQuest(id) {
    if (reviewed.has(id)) return;
    requireValue(!visiting.has(id), 'quests.' + id, 'prerequisite cycle');
    visiting.add(id);
    for (const previous of catalog.quests[id].requires ?? []) reviewQuest(previous);
    visiting.delete(id);
    reviewed.add(id);
  }
  for (const id of Object.keys(catalog.quests)) reviewQuest(id);
  record(catalog.dialogues, 'dialogues', 48, (spec, path) => {
    shape(spec, path, ['start', 'nodes']);
    record(spec.nodes, path + '.nodes', 24, (node, at) => {
      shape(node, at, ['text', 'choices']);
      requireValue(text(node.text, 480) && Array.isArray(node.choices) && node.choices.length <= 5, at, 'invalid dialogue node');
      for (const choice of node.choices) {
        shape(choice, at + '.choice', ['label', 'next', 'quest', 'action', 'when']);
        requireValue(text(choice.label, 72) &&
          optional(choice.next, id => identifier(id) && Object.hasOwn(spec.nodes, id)) &&
          (choice.quest === undefined ? choice.when === undefined && oneOf(choice.action, [undefined, 'recruit']) :
            ref('quests', choice.quest) && optional(choice.when, choiceCondition) &&
            oneOf(choice.action, [undefined, 'offer', 'turn-in'])), at, 'invalid dialogue choice');
      }
    });
    requireValue(identifier(spec.start) && Object.hasOwn(spec.nodes, spec.start), path, 'unknown start node');
  });
  record(catalog.skills, 'skills', 24, (spec, path) => {
    shape(spec, path, ['name', 'duration', 'stamina', 'power', 'hits', 'unlockQuest']);
    requireValue(text(spec.name, 64) && number(spec.duration, .35, 1.8) && integer(spec.stamina, 1, 60) &&
      number(spec.power, .15, 3) && Array.isArray(spec.hits) && integer(spec.hits.length, 1, 4) &&
      spec.hits.every((v, i) => number(v, .1, .9) && (!i || v - spec.hits[i-1] >= .08)) &&
      optional(spec.unlockQuest, id => ref('quests', id)), path, 'invalid skill timing, damage, cost or unlock');
  });
  return catalog;
}

export function applyOperations(previous, request) {
  shape(request, 'request', ['version', 'summary', 'changes']);
  requireValue(request.version === 1 && text(request.summary, 180) && Array.isArray(request.changes) &&
    request.changes.length > 0 && request.changes.length <= 40, 'request', 'invalid version, summary or change count');
  const catalog = structuredClone(previous);
  const seen = new Set();
  for (const change of request.changes) {
    shape(change, 'change', ['op', 'type', 'id', 'value']);
    const {op, type, id, value} = change;
    requireValue(CATEGORIES.includes(type) && identifier(id) && oneOf(op, ['add', 'replace', 'remove']), 'change', 'invalid operation');
    const key = type + '.' + id;
    requireValue(!seen.has(key), key, 'duplicate operation');
    seen.add(key);
    const existing = Object.hasOwn(catalog[type], id);
    requireValue(op === 'add' ? !existing : existing, key, 'current state does not match the operation');
    if (op === 'remove') {
      requireValue(value === undefined, key, 'remove requires only an ID');
      delete catalog[type][id];
    } else catalog[type][id] = structuredClone(value);
  }
  return validateCatalog(catalog);
}

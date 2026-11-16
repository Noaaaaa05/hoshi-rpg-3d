import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { applyOperations, CONTENT_PATH, emptyCatalog, parseCatalog, validateCatalog } from '../js/rpg-content.js';
import { lintCatalog } from '../scripts/rpg/catalog-lint.mjs';
import { inspectAsset } from '../scripts/rpg/asset.mjs';
import { publishedFiles, verifyPages } from '../scripts/rpg/verify-pages.mjs';
import { conflictingImports } from '../scripts/module-versions.mjs';

const demo = JSON.parse(await readFile('docs/requests/watchpost.json', 'utf8'));
const registered = parseCatalog(await readFile(CONTENT_PATH, 'utf8'));
// A schema-valid variation of the watchpost example, so each finding is about playability only.
function lint(change) {
  const catalog = applyOperations(emptyCatalog(), demo);
  change?.(catalog);
  return lintCatalog(validateCatalog(catalog));
}
const greeting = catalog => catalog.dialogues['mina-watchpost'].nodes.greeting.choices;
const prop = (zone, x, z, collider) => ({ zone, model: 'watchpost-hut', x, z, collider });

test('the registered catalog and the watchpost example are playable without findings', () => {
  assert.deepEqual(lintCatalog(registered), { errors: [], warnings: [] });
  assert.deepEqual(lint(), { errors: [], warnings: [] });
});

test('a quest that cannot be accepted, progressed or reported is an error', () => {
  assert.match(lint(c => greeting(c).shift()).errors.join(), /watchpost-round: no placed character offers/);
  // The report sits behind the offer, which disappears once the quest is accepted.
  const hidden = lint(c => c.dialogues['mina-watchpost'].nodes.accepted.choices.push(greeting(c).splice(1, 1)[0]));
  assert.deepEqual(hidden.errors, ['quests.watchpost-round: no placed character accepts the report while the quest is ready']);
  const absent = lint(c => { delete c.placements['mina-trail']; });
  assert.equal(absent.errors.length, 2);
  assert.match(absent.warnings.join(), /actors\.mina: not placed.*dialogues\.mina-watchpost: no placed character/);
  const unplaced = lint(c => {
    c.actors.bat = { name: '洞窟コウモリ', role: 'enemy', model: 'mina-scout',
      enemy: { variant: 'slime', hp: 20, damage: 4, xp: 5, speed: 2, radius: .4, range: 1.2, windup: .5, recovery: 1 } };
    c.quests['bat-hunt'] = { name: 'コウモリ退治', description: 'コウモリを2体倒す。', chapter: 'side',
      goal: { kind: 'defeat', target: 'bat', count: 2 }, reward: { item: 'watchpost-dagger', count: 1 } };
    greeting(c).push({ label: '退治を引き受ける', quest: 'bat-hunt', action: 'offer' },
      { label: '退治を報告する', quest: 'bat-hunt', action: 'turn-in' });
  });
  assert.deepEqual(unplaced.errors, ['quests.bat-hunt: the enemy to defeat (bat) is not placed']);
});

test('zones, exits and star lights must stay reachable around prop colliders', () => {
  const covered = lint(c => { c.placements.wall = prop('watchpost', 4.8, 5.5, 4); });
  assert.match(covered.errors.join(), /cannot stand inside zone watchpost/);
  const shadowed = lint(c => {
    c.zones.copy = { ...c.zones.watchpost };
    c.quests['watchpost-round'].goal.target = 'copy';
  });
  assert.match(shadowed.errors.join(), /cannot stand inside zone copy/);
  assert.deepEqual(lint(c => { c.zones.watchpost.exit = 'trail-rest'; }), { errors: [], warnings: [] });
  const blockedExit = lint(c => {
    c.zones.watchpost.exit = 'trail-rest';
    c.placements.gate = prop('watchpost', 4.8, 5.5, 2);
  });
  assert.match(blockedExit.errors.join(), /zones\.watchpost: the exit cannot be used/);
  const talker = lint(c => {
    c.zones.watchpost.exit = 'trail-rest';
    c.placements['mina-trail'] = { zone: 'watchpost', actor: 'mina', x: 4.2, z: 5.1 };
  });
  assert.deepEqual(talker.errors, []);
  assert.match(talker.warnings.join(), /zones\.watchpost: a character within talk range/);
  const star = lint(c => {
    c.zones.glade = { name: '星の広場', kind: 'forest', x: 1, z: 3, radius: 2 };
    c.placements.rock = prop('glade', 1, 3, 2);
  });
  assert.match(star.errors.join(), /star light 0 at \(1, 3\) unreachable/);
});

test('content that can never appear is reported as a warning', () => {
  const { errors, warnings } = lint(c => {
    c.actors.mina.role = 'npc';
    c.actors.bob = { name: '旅人ボブ', role: 'npc', model: 'mina-scout' };
    c.dialogues.spare = { start: 'hello', nodes: { hello: { text: 'こんにちは。', choices: [] } } };
    c.dialogues['mina-watchpost'].nodes.orphan = { text: '……', choices: [] };
    greeting(c).push({ label: 'もう一度引き受ける', quest: 'watchpost-round', action: 'offer', when: 'complete' });
    c.items['spare-herb'] = { name: '予備の薬草', kind: 'consumable', heal: 10 };
    c.models['spare-model'] = { type: 'procedural', preset: 'beacon', height: 1, color: '#ffffff' };
    c.placements['mina-trail'] = { zone: 'watchpost', actor: 'mina', x: 6.5, z: 6.2 };
    c.placements.crate = prop('trail-rest', .5, 12, 1);
  });
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings.sort(), [
    'actors.bob: not placed, so it never appears',
    'dialogues.mina-watchpost.nodes.greeting: choice "もう一度引き受ける" is never shown',
    'dialogues.mina-watchpost.nodes.joined: cannot be reached from the start node',
    'dialogues.mina-watchpost.nodes.orphan: cannot be reached from the start node',
    'dialogues.mina-watchpost.nodes.thanks: choice "ミナを仲間にする" is never shown',
    'dialogues.spare: no placed character speaks this dialogue',
    'items.spare-herb: no quest rewards this item, so it cannot be obtained',
    'models.spare-model: not used by an actor, placement or motion',
    'placements.crate: the collider covers the player start',
    'placements.mina-trail: the character stands inside the collider of watchpost-shelter',
  ]);
});

test('asset intake measures a GLB and prints entries that pass the catalog checks', async () => {
  const model = await inspectAsset({ file: 'assets/models/hero_animated.glb', id: 'hero-copy' });
  assert.deepEqual(model.problems, []);
  assert.equal(model.kind, 'model');
  assert.equal(model.sha256, registered.models.hero.sha256);
  assert.deepEqual([model.bones, model.triangles, model.textures], [66, 10112, 0]);
  assert.deepEqual(model.clips.map(clip => clip.name).sort(), ['Attack', 'Idle_03', 'Running', 'Walking']);
  assert.deepEqual(model.request.changes.map(change => change.type + '.' + change.id), ['models.hero-copy',
    'motions.hero-copy-running', 'motions.hero-copy-walking', 'motions.hero-copy-attack', 'motions.hero-copy-idle-03']);
  assert.equal(model.request.changes[0].value.file, 'models/hero_animated.glb');
  applyOperations(registered, model.request);

  const pack = await inspectAsset({ file: 'assets/models/motions/roll-d0b3c225826c.glb', model: 'hero' });
  assert.deepEqual(pack.problems, []);
  assert.equal(pack.kind, 'motion-pack');
  assert.deepEqual(pack.request.changes[0].value, { ...registered.motions['hero-roll'], blend: .16 });

  assert.match((await inspectAsset({ file: 'assets/models/motions/roll-d0b3c225826c.glb' })).problems.join(), /--model <id>/);
  assert.match((await inspectAsset({ file: 'assets/models/hero.glb' })).problems.join(), /exceeds 15,000 triangles/);
  // An entry that already exists is reported before anyone edits the catalog.
  assert.match((await inspectAsset({ file: 'assets/models/hero_animated.glb', id: 'hero' })).problems.join(), /models\.hero/);
  await assert.rejects(inspectAsset({ file: 'package.json' }), /inside assets\/models/);
});

test('public site verification compares every file the game loads and sends only GET requests', async () => {
  const files = await publishedFiles(process.cwd());
  for (const file of ['index.html', 'js/main.js', 'vendor/three/three.module.js', 'assets/rpg/catalog.json',
    'assets/models/hero_animated.glb', 'assets/models/motions/roll-d0b3c225826c.glb']) assert.ok(files.includes(file), file);
  const base = 'https://example.test/hoshi-rpg-3d/';
  const calls = [];
  const serve = change => async (url, options) => {
    calls.push(options);
    const { pathname, search } = new URL(url);
    assert.ok(url.startsWith(base) && search === '?verify=7');
    const file = pathname.slice('/hoshi-rpg-3d/'.length);
    return change?.(file) ?? new Response(await readFile(path.join(process.cwd(), file)));
  };
  const same = await verifyPages({ base, stamp: 7, fetchImpl: serve() });
  assert.deepEqual(same, { base, files: files.length, different: [], unavailable: [], published: true });
  assert.ok(calls.length === files.length && calls.every(call => call.method === 'GET' && call.redirect === 'error'));
  const stale = await verifyPages({ base, stamp: 7, fetchImpl: serve(file =>
    file === 'assets/rpg/catalog.json' ? new Response('{}') : file === 'js/main.js' ? new Response('', { status: 404 }) : null) });
  assert.deepEqual([stale.published, stale.different, stale.unavailable], [false, ['assets/rpg/catalog.json'], ['js/main.js']]);
  await assert.rejects(verifyPages({ base: 'http://example.test/', fetchImpl: serve() }), /https site URL/);
});

test('one module imported under two version queries is reported', () => {
  assert.deepEqual(conflictingImports({
    'js/a.js': "import { x } from './shared.js?v=1';\nimport './plain.js';",
    'js/b.js': "import { x } from './shared.js?v=2';\nconst lazy = import('./plain.js');",
  }), ["shared.js is imported as './shared.js?v=1' (js/a.js) and './shared.js?v=2' (js/b.js)"]);
});

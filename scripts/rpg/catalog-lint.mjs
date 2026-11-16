// Checks that the schema cannot express: content that validates but cannot be played as authored.
// Errors stop `rpg:check` and `rpg:apply`. Warnings are reported and left to the author.
import { SPAWN, insideCollider } from '../../js/physics.js';
import { STAR_POSITIONS } from '../../js/world.js';

// Distances used by the game. Keep them in step with the files named here.
const PLAYER_RADIUS = .38;  // CollisionGrid.resolve() in js/physics.js
const TALK_RANGE = 3.2;     // nearby() in js/rpg-world.js
const EXIT_RANGE = 1.65;    // nearby() in js/rpg-world.js
const STAR_RANGE = 1.25;    // explore() in js/main.js

// Same selection as areaAt() in js/rpg-world.js: the nearest centre among the zones that contain the point.
function zoneAt(zones, x, z) {
  let selected, distance = Infinity;
  for (const [id, zone] of zones) {
    const d = Math.hypot(x - zone.x, z - zone.z);
    if (d <= zone.radius && d < distance) { selected = id; distance = d; }
  }
  return selected;
}

// Rings of sample points around a centre, out to (but not on) the limit.
function* around(x, z, limit) {
  yield [x, z];
  for (let ring = 1; ring <= 16; ring++) {
    const radius = limit * ring / 16.5;
    for (let step = 0; step < 32; step++) {
      const angle = step / 32 * Math.PI * 2;
      yield [x + Math.sin(angle) * radius, z + Math.cos(angle) * radius];
    }
  }
}

// Whether a choice can appear while `quest` is in `state`. Choices about other quests are assumed possible.
function shown(choice, quest, state, canRecruit) {
  if (choice.action === 'recruit') return canRecruit;
  if (choice.quest === undefined) return true;
  const needed = choice.action === 'offer' ? 'available' : choice.action === 'turn-in' ? 'ready' : choice.when;
  if (choice.when !== undefined && choice.when !== needed) return false;
  return choice.quest !== quest || needed === undefined || needed === state;
}

function reachableNodes(dialogue, quest, state, canRecruit) {
  const found = new Set([dialogue.start]), queue = [dialogue.start];
  while (queue.length) {
    for (const choice of dialogue.nodes[queue.pop()].choices) {
      if (choice.next === undefined || found.has(choice.next) || !shown(choice, quest, state, canRecruit)) continue;
      found.add(choice.next);
      queue.push(choice.next);
    }
  }
  return found;
}

export function lintCatalog(catalog) {
  const errors = [], warnings = [];
  const placements = Object.entries(catalog.placements), zones = Object.entries(catalog.zones);
  const placedActors = new Set(placements.map(([, placement]) => placement.actor).filter(id => id !== undefined));
  // The same collider that js/rpg-world.js adds to the grid for each prop.
  const props = placements.filter(([, placement]) => placement.collider || placement.colliderBox).map(([id, placement]) =>
    [id, placement.colliderBox
      ? { x: placement.x, z: placement.z, shape: 'box', halfX: placement.colliderBox[0], halfZ: placement.colliderBox[1], angle: placement.yaw ?? 0 }
      : { x: placement.x, z: placement.z, radius: placement.collider }]);
  const talkers = placements.filter(([, placement]) => catalog.actors[placement.actor]?.dialogue);
  const free = (x, z) => props.every(([, prop]) => !insideCollider(prop, x, z, PLAYER_RADIUS));

  // Dialogues are spoken by placed NPCs and companions. Everything a quest needs must be reachable through them.
  const spoken = new Map();
  for (const id of placedActors) {
    const actor = catalog.actors[id];
    if (!actor.dialogue) continue;
    const entry = spoken.get(actor.dialogue) ?? { canRecruit: false };
    entry.canRecruit ||= actor.role === 'companion';
    spoken.set(actor.dialogue, entry);
  }
  function offered(quest, action, state) {
    for (const [id, { canRecruit }] of spoken) {
      const dialogue = catalog.dialogues[id];
      for (const node of reachableNodes(dialogue, quest, state, canRecruit)) {
        if (dialogue.nodes[node].choices.some(choice => choice.action === action && choice.quest === quest &&
            shown(choice, quest, state, canRecruit))) return true;
      }
    }
    return false;
  }

  for (const [id, quest] of Object.entries(catalog.quests)) {
    const at = 'quests.' + id + ': ';
    if (!offered(id, 'offer', 'available')) errors.push(at + 'no placed character offers this quest while it is available');
    if (!offered(id, 'turn-in', 'ready')) errors.push(at + 'no placed character accepts the report while the quest is ready');
    if (quest.goal.kind === 'defeat' && !placedActors.has(quest.goal.target)) {
      errors.push(at + 'the enemy to defeat (' + quest.goal.target + ') is not placed');
    }
    if (quest.goal.kind === 'visit') {
      const zone = catalog.zones[quest.goal.target];
      const standable = [...around(zone.x, zone.z, zone.radius)].some(([x, z]) =>
        zoneAt(zones, x, z) === quest.goal.target && free(x, z));
      if (!standable) errors.push(at + 'the player cannot stand inside zone ' + quest.goal.target +
        ' (covered by a prop collider or by another zone)');
    }
  }

  for (const [id, zone] of zones) {
    if (!zone.exit) continue;
    const spots = [...around(zone.x, zone.z, EXIT_RANGE)].filter(([x, z]) => zoneAt(zones, x, z) === id && free(x, z));
    if (!spots.length) {
      errors.push('zones.' + id + ': the exit cannot be used (its centre is covered by a prop collider or by another zone)');
    } else if (spots.every(([x, z]) => talkers.some(([, talker]) => Math.hypot(x - talker.x, z - talker.z) < TALK_RANGE))) {
      warnings.push('zones.' + id + ': a character within talk range of the centre replaces the exit button with the talk button');
    }
  }

  for (const [index, [x, z]] of STAR_POSITIONS.entries()) {
    if (![...around(x, z, STAR_RANGE)].some(([px, pz]) => free(px, pz))) {
      errors.push('placements: a prop collider makes star light ' + index + ' at (' + x + ', ' + z + ') unreachable');
    }
  }

  for (const [id, placement] of placements) {
    const at = 'placements.' + id + ': ';
    if (props.some(([prop, collider]) => prop === id && insideCollider(collider, SPAWN.x, SPAWN.z, PLAYER_RADIUS))) {
      warnings.push(at + 'the collider covers the player start');
    }
    // Props may overlap each other, and enemies are pushed out of colliders when they spawn.
    if (placement.actor === undefined || catalog.actors[placement.actor].role === 'enemy') continue;
    for (const [other, prop] of props) {
      if (insideCollider(prop, placement.x, placement.z)) {
        warnings.push(at + 'the character stands inside the collider of ' + other);
      }
    }
  }

  for (const id of Object.keys(catalog.actors)) {
    if (!placedActors.has(id)) warnings.push('actors.' + id + ': not placed, so it never appears');
  }
  for (const [id, dialogue] of Object.entries(catalog.dialogues)) {
    if (!spoken.has(id)) {
      warnings.push('dialogues.' + id + ': no placed character speaks this dialogue');
      continue;
    }
    const { canRecruit } = spoken.get(id);
    const reached = reachableNodes(dialogue, undefined, undefined, canRecruit);
    for (const [node, { choices }] of Object.entries(dialogue.nodes)) {
      const at = 'dialogues.' + id + '.nodes.' + node + ': ';
      if (!reached.has(node)) warnings.push(at + 'cannot be reached from the start node');
      for (const choice of choices) {
        if (!shown(choice, undefined, undefined, canRecruit)) warnings.push(at + 'choice "' + choice.label + '" is never shown');
      }
    }
  }
  const rewards = new Set(Object.values(catalog.quests).map(quest => quest.reward.item));
  for (const id of Object.keys(catalog.items)) {
    if (!rewards.has(id)) warnings.push('items.' + id + ': no quest rewards this item, so it cannot be obtained');
  }
  const usedModels = new Set([
    ...Object.values(catalog.actors).map(actor => actor.model),
    ...placements.map(([, placement]) => placement.model),
    ...Object.values(catalog.motions).map(motion => motion.model),
  ]);
  for (const id of Object.keys(catalog.models)) {
    if (!usedModels.has(id)) warnings.push('models.' + id + ': not used by an actor, placement or motion');
  }
  return { errors, warnings };
}

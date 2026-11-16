import { clamp, heightAt } from './physics.js';
import { createRpgVisuals } from './rpg-visuals.js';

export async function createRpgWorld(scene, grid, catalog, progress, warn) {
  const visuals = createRpgVisuals(catalog, warn);
  const zones = Object.entries(catalog.zones);
  let speaker = null;
  const placements = await Promise.all(Object.entries(catalog.placements).map(async ([id, entry]) => {
    const actor = entry.actor === undefined ? undefined : catalog.actors[entry.actor];
    const visual = await visuals.create(entry.model ?? actor.model, actor?.motions);
    return {id, entry, actor, visual};
  }));
  const characters = [], enemySpawns = [], enemyVisuals = [];
  for (const {id, entry, actor, visual} of placements) {
    const {x, z, yaw, collider} = entry;
    visual.group.position.set(x, heightAt(x,z), z);
    visual.group.rotation.y = yaw ?? 0;
    scene.add(visual.group);
    if (collider) grid.add({x, z, radius:collider, height:catalog.models[entry.model].height});
    if (actor?.role === 'enemy') {
      enemySpawns.push({x, z, type:'rpg-' + entry.actor, contentActor:entry.actor, contentPlacement:id, config:{...actor.enemy, name:actor.name}});
      enemyVisuals.push({id, visual});
    } else if (actor) characters.push({id, actorId:entry.actor, actor, visual});
  }

  function areaAt(x, z) {
    let selected;
    let distance = Infinity;
    for (const [id, zone] of zones) {
      const d = Math.hypot(x-zone.x, z-zone.z);
      if (d <= zone.radius && d < distance) { selected = {id, ...zone, distance:d}; distance = d; }
    }
    return selected;
  }

  function nearby(motor) {
    let nearest = null, distance = 3.2;
    for (const character of characters) {
      if (!character.actor.dialogue) continue;
      const position = character.visual.group.position;
      const d = Math.hypot(motor.x-position.x, motor.z-position.z);
      if (d < distance) { nearest = character; distance = d; }
    }
    const zone = areaAt(motor.x, motor.z);
    const exit = zone?.exit && zone.distance < 1.65 ? {id:zone.id, exit:catalog.zones[zone.exit]} : null;
    // A recruited companion follows within talk range. At an exit, offer the exit and not the companion.
    if (nearest && !(exit && progress.companions.includes(nearest.actorId))) return nearest;
    return exit;
  }

  function bindEnemies(combat) {
    for (const entry of enemyVisuals) {
      entry.enemy = combat.enemies.find(enemy => enemy.contentPlacement === entry.id);
      if (entry.enemy) entry.enemy.modelLoaded = true;
    }
  }

  function update(dt, motor) {
    for (const {id, actorId, visual} of characters) {
      const {group} = visual;
      let walking = false;
      if (progress.companions.includes(actorId) && dt > 0) {
        const x = motor.x - Math.sin(motor.angle)*2.4, z = motor.z - Math.cos(motor.angle)*2.4;
        const dx = x-group.position.x, dz = z-group.position.z;
        const distance = Math.hypot(dx, dz);
        if (distance > 1.1) {
          const step = clamp(distance / 2, 2, 5) * dt / distance;
          const next = distance > 24 ? grid.resolve(x,z) : grid.resolve(group.position.x+dx*step, group.position.z+dz*step, .3);
          walking = Math.hypot(next.x-group.position.x, next.z-group.position.z) > .002;
          group.position.set(next.x, heightAt(next.x,next.z), next.z);
          if (walking) group.rotation.y = Math.atan2(dx, dz);
        }
      }
      group.visible = Math.hypot(group.position.x-motor.x,group.position.z-motor.z) < 55;
      if (group.visible) visual.animate(speaker === id ? 'talk' : walking ? 'walk' : 'idle', dt);
    }
    for (const {visual, enemy} of enemyVisuals) {
      const {group} = visual;
      group.visible = Boolean(enemy) && Math.hypot(enemy.x-motor.x,enemy.z-motor.z) < 55 &&
        (enemy.hp > 0 || enemy.deathTime < 1.2);
      if (!group.visible) continue;
      group.position.set(enemy.x, enemy.y, enemy.z);
      group.rotation.y = enemy.angle;
      const state = enemy.hp <= 0 ? 'death' : enemy.hurt > .15 ? 'damage' : enemy.state === 'windup' ? 'attack' : enemy.moving ? 'walk' : 'idle';
      visual.animate(state, dt);
    }
  }

  return {enemySpawns, bindEnemies, areaAt, nearby, update, setSpeaker: id => { speaker = id; },
    debug: () => ({placements: placements.map(({id, visual}) => ({id, x:visual.group.position.x,z:visual.group.position.z})), ...progress.toJSON()})};
}

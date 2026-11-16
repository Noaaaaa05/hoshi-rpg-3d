import { readFile, writeFile } from 'node:fs/promises';
import * as THREE from '../../vendor/three/three.module.js';
import { animationPack, loadGLB, readGLB, validateMotion, writeGLB } from './glb.mjs';
import { createFootGrounding, prepareModel } from '../../js/model-utils.js';
import { ROLL_DURATION } from '../../js/motion-state.js';

const clipName = 'Hoshi_roll';
const heroPath = new URL('../../assets/models/hero_animated.glb', import.meta.url);
const manifestPath = new URL('../../assets/models/manifest.json', import.meta.url);
const startFrame = 9;
const rollStartFrame = 25;
const recoveryFrame = 48;
const endFrame = 72;
const rollStartTime = 0.15;
const recoveryTime = 0.50;
const endTime = ROLL_DURATION;
const radians = Math.PI / 180;
const up = new THREE.Vector3(0, 1, 0);

const mixamoToBVH = {
  Hips: 'Hips', Spine: 'Spine1', Spine1: 'Spine2', Spine2: 'Chest',
  Neck: 'Neck2', Head: 'Head',
  LeftShoulder: 'LeftShoulder', LeftArm: 'LeftArm', LeftForeArm: 'LeftForeArm', LeftHand: 'LeftHand',
  RightShoulder: 'RightShoulder', RightArm: 'RightArm', RightForeArm: 'RightForeArm', RightHand: 'RightHand',
  LeftUpLeg: 'LeftLeg', LeftLeg: 'LeftShin', LeftFoot: 'LeftFoot', LeftToeBase: 'LeftToeBase',
  RightUpLeg: 'RightLeg', RightLeg: 'RightShin', RightFoot: 'RightFoot', RightToeBase: 'RightToeBase'
};

function readSwiftBVH(text) {
  const [hierarchy, motion] = text.trim().split(/^MOTION\s*$/m);
  if (!motion) throw new Error('The Swift BVH lacks a motion section.');
  const tokens = hierarchy.trim().match(/[^\s{}]+|[{}]/g);
  const joints = new Map();
  let cursor = 0;
  let stride = 0;
  function expect(token) {
    if (tokens[cursor++] !== token) throw new Error('Unexpected Swift BVH hierarchy.');
  }
  function joint(parent) {
    const name = tokens[cursor++];
    expect('{');
    expect('OFFSET');
    cursor += 3;
    expect('CHANNELS');
    const count = Number(tokens[cursor++]);
    const channels = tokens.slice(cursor, cursor + count).join(' ');
    if (count !== 3 && count !== 6) throw new Error('Unexpected Swift BVH channel count.');
    if (channels !== (count === 6 ? 'Xposition Yposition Zposition ' : '') + 'Zrotation Yrotation Xrotation') {
      throw new Error('Unexpected Swift BVH channel order.');
    }
    joints.set(name, { name, parent, start: stride, rotation: stride + count - 3, count });
    cursor += count;
    stride += count;
    while (tokens[cursor] === 'JOINT') {
      expect('JOINT');
      joint(name);
    }
    expect('}');
  }
  expect('HIERARCHY');
  expect('ROOT');
  joint(null);

  const [frameHeader, timeHeader, ...rows] = motion.trim().split(/\r?\n/);
  const frameCount = Number(frameHeader.match(/^Frames:\s+(\d+)$/)?.[1]);
  const frameTime = Number(timeHeader.match(/^Frame Time:\s+([\d.]+)$/)?.[1]);
  if (frameCount !== rows.length || endFrame >= frameCount || !Number.isFinite(frameTime) || Math.abs(frameTime - 1 / 30) > 0.00001) {
    throw new Error('The forward roll requires the reviewed 30 fps Swift clip.');
  }
  const frames = rows.map(row => row.trim().split(/\s+/).map(Number));
  if (frames.some(row => row.length !== stride || row.some(value => !Number.isFinite(value)))) {
    throw new Error('The Swift BVH contains invalid keyframes.');
  }
  for (const name of Object.values(mixamoToBVH)) {
    if (!joints.has(name)) throw new Error('Missing source joint ' + name);
  }
  return { joints, frames };
}

function worldRotations(frame, joints, turn) {
  const world = new Map();
  const correction = new THREE.Quaternion().setFromAxisAngle(up, turn);
  for (const { name, parent, rotation } of joints.values()) {
    const [z, y, x] = frame.slice(rotation, rotation + 3).map(value => value * radians);
    const local = new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, 'ZYX'));
    world.set(name, (world.get(parent) || correction).clone().multiply(local));
  }
  return world;
}

function timeFor(frame) {
  if (frame <= rollStartFrame) return THREE.MathUtils.mapLinear(frame, startFrame, rollStartFrame, 0, rollStartTime);
  if (frame <= recoveryFrame) return THREE.MathUtils.mapLinear(frame, rollStartFrame, recoveryFrame, rollStartTime, recoveryTime);
  return THREE.MathUtils.mapLinear(frame, recoveryFrame, endFrame, recoveryTime, endTime);
}

function adjustSwordClearance(hero, spec, nodes, hips, positions, times) {
  const { wrapper } = prepareModel(hero, spec);
  const grounding = createFootGrounding(wrapper, spec.footOffset, true);
  if (!grounding) throw new Error('Cannot establish ground contacts for the roll.');
  const hand = nodes.find(({ bone }) => bone.name === spec.weapon.bone);
  if (!hand) throw new Error('Cannot find the sword hand on the target rig.');

  const localBlade = new THREE.Vector3().fromArray(spec.weapon.direction).normalize();
  const localGrip = new THREE.Vector3().fromArray(spec.weapon.position);
  const handWorld = new THREE.Quaternion();
  const parentWorld = new THREE.Quaternion();
  const blade = new THREE.Vector3();
  const grip = new THREE.Vector3();
  const level = new THREE.Vector3();
  const scale = new THREE.Vector3();
  const turn = new THREE.Quaternion();
  const tuckedBlade = new THREE.Vector3(-1, 0.26, 0.2).normalize();
  for (let frame = 0; frame < times.length; frame++) {
    for (const { bone, values } of nodes) bone.quaternion.fromArray(values, frame * 4);
    hips.bone.position.fromArray(positions, frame * 3);
    grounding.update('roll');
    hand.bone.getWorldQuaternion(handWorld);
    hand.bone.getWorldScale(scale);
    hand.bone.localToWorld(grip.copy(localGrip));
    blade.copy(localBlade).applyQuaternion(handWorld);
    const reach = (spec.weapon.length + 0.08) * scale.x;
    const clearance = THREE.MathUtils.clamp((0.07 - grip.y) / reach, -1, 1);
    // Keep the blade outside the body while the wrist passes through inversion.
    const tuck = THREE.MathUtils.smoothstep(times[frame], 0.12, 0.22) *
      (1 - THREE.MathUtils.smoothstep(times[frame], 0.43, 0.58));
    level.copy(blade).lerp(tuckedBlade, tuck).normalize();
    if (level.y < clearance) {
      level.y = 0;
      if (level.lengthSq() < 0.0001) level.set(tuckedBlade.x, 0, tuckedBlade.z);
      level.normalize().multiplyScalar(Math.sqrt(1 - clearance * clearance));
      level.y = clearance;
    }
    const adjusted = turn.setFromUnitVectors(blade, level).multiply(handWorld);
    hand.bone.parent.getWorldQuaternion(parentWorld).invert().multiply(adjusted)
      .normalize().toArray(hand.values, frame * 4);
  }
  for (let frame = 1; frame < times.length; frame++) {
    const index = frame * 4;
    const previous = handWorld.fromArray(hand.values, index - 4);
    const current = turn.fromArray(hand.values, index);
    if (previous.dot(current) < 0) {
      for (let i = index; i < index + 4; i++) hand.values[i] *= -1;
    }
  }
}

async function makePack(bvhPath) {
  const bytes = await readFile(heroPath);
  const hero = await loadGLB(bytes);
  const { json, bin } = readGLB(bytes);
  if (json.skins?.length !== 1 || json.skins[0].joints?.length !== 66) {
    throw new Error('The target is expected to have the original 66-bone Mixamo rig.');
  }
  const { joints, frames } = readSwiftBVH(await readFile(bvhPath, 'utf8'));
  const hips = joints.get('Hips');
  if (hips.count !== 6) throw new Error('The Swift pelvis translation is missing.');

  hero.scene.updateMatrixWorld(true);
  const nodes = json.skins[0].joints.map(index => {
    const originalName = json.nodes[index].name;
    const name = THREE.PropertyBinding.sanitizeNodeName(originalName);
    const bone = hero.scene.getObjectByName(name);
    if (!bone?.isBone) throw new Error('Missing target joint ' + originalName);
    const source = mixamoToBVH[originalName.replace(/^mixamorig:/, '')];
    return { index, bone, source, rest: bone.getWorldQuaternion(new THREE.Quaternion()), values: [] };
  });
  const byBone = new Map(nodes.map(entry => [entry.bone, entry]));
  const fingerPose = new Map(hero.animations.find(clip => clip.name === 'Idle_03').tracks
    .filter(track => /Hand(Thumb|Index|Middle|Ring|Pinky)\d+\.quaternion$/.test(track.name))
    .map(track => [track.name.slice(0, -'.quaternion'.length), Array.from(track.values.slice(0, 4))]));
  const targetHips = nodes.find(entry => entry.source === 'Hips');
  const pelvis = targetHips.bone.position;
  const hipY0 = frames[startFrame][hips.start + 1];
  const hipScale = pelvis.y / hipY0;
  const dx = frames[recoveryFrame][hips.start] - frames[rollStartFrame][hips.start];
  const dz = frames[recoveryFrame][hips.start + 2] - frames[rollStartFrame][hips.start + 2];
  const yawCorrection = -Math.atan2(dx, dz);
  const positions = [];
  const times = [];
  for (let frame = startFrame; frame <= endFrame; frame++) {
    const rampIn = THREE.MathUtils.smoothstep(frame, startFrame, rollStartFrame);
    const rampOut = 1 - THREE.MathUtils.smoothstep(frame, recoveryFrame, endFrame);
    const sourceWorld = worldRotations(frames[frame], joints, yawCorrection * rampIn * rampOut);
    for (const entry of nodes) {
      const { bone, source, rest, values } = entry;
      let rotation = fingerPose.get(bone.name) ?? bone.quaternion.toArray();
      if (source) {
        const parent = byBone.get(bone.parent);
        const parentWorld = parent?.source
          ? sourceWorld.get(parent.source).clone().multiply(parent.rest)
          : bone.parent.getWorldQuaternion(new THREE.Quaternion());
        rotation = parentWorld.invert().multiply(sourceWorld.get(source)).multiply(rest).normalize().toArray();
      }
      if (values.length && rotation.reduce((dot, value, i) => dot + value * values[values.length - 4 + i], 0) < 0) {
        rotation = rotation.map(value => -value);
      }
      values.push(...rotation);
    }
    // Use the target's proportions. Horizontal travel stays with the collision motor.
    positions.push(pelvis.x, pelvis.y + (frames[frame][hips.start + 1] - hipY0) * hipScale, pelvis.z);
    times.push(timeFor(frame));
  }

  const { player: spec } = JSON.parse(await readFile(manifestPath, 'utf8'));
  adjustSwordClearance(hero, spec, nodes, targetHips, positions, times);

  const chunks = [bin];
  let offset = bin.length;
  function append(values, type, components, bounds = {}) {
    const buffer = Buffer.alloc(4 * values.length);
    values.forEach((value, i) => buffer.writeFloatLE(value, i * 4));
    const view = json.bufferViews.length;
    json.bufferViews.push({ buffer: 0, byteOffset: offset, byteLength: buffer.length });
    chunks.push(buffer);
    offset += buffer.length;
    const accessor = json.accessors.length;
    json.accessors.push({ bufferView: view, componentType: 5126, count: values.length / components, type, ...bounds });
    return accessor;
  }
  const moving = append(times, 'SCALAR', 1, { min: [0], max: [Math.fround(endTime)] });
  const still = append([0], 'SCALAR', 1, { min: [0], max: [0] });
  const animation = { name: clipName, channels: [], samplers: [] };
  function channel(node, path, input, output) {
    const sampler = animation.samplers.length;
    animation.channels.push({ sampler, target: { node, path } });
    animation.samplers.push({ input, output, interpolation: 'LINEAR' });
  }
  channel(targetHips.index, 'translation', moving, append(positions, 'VEC3', 3));
  for (const { index, source, values } of nodes) {
    channel(index, 'rotation', source ? moving : still, append(source ? values : values.slice(0, 4), 'VEC4', 4));
  }
  json.animations = [animation];
  json.buffers[0].byteLength = offset;
  return { bytes, pack: animationPack(writeGLB(json, Buffer.concat(chunks)), clipName, clipName) };
}

const [, , bvhPath, outputPath] = process.argv;
if (!bvhPath || !outputPath) throw new Error('Usage: node --import ./tests/register-three.mjs scripts/meshy/retarget-forward-roll.mjs <Swift.bvh> <roll.glb>');
const { bytes, pack } = await makePack(bvhPath);
const report = await validateMotion(bytes, pack, 'roll', { clip: clipName });
await writeFile(outputPath, pack);
console.log(JSON.stringify({ bytes: pack.length, ...report }));

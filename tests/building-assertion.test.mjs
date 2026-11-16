import test from 'node:test';
import assert from 'node:assert/strict';
import { circleIntersectsBox } from './helpers/circle-box.mjs';

test('building assertions accept a clear rounded corner and reject real side/corner penetration',()=>{
  const box={x:0,z:0,halfX:1,halfZ:1};
  assert.equal(circleIntersectsBox({x:1.3,z:1.3},box,.38),false); // corner distance sqrt(.18) > .38
  assert.equal(circleIntersectsBox({x:1.2,z:1.2},box,.38),true);
  assert.equal(circleIntersectsBox({x:1.2,z:0},box,.38),true);
  assert.equal(circleIntersectsBox({x:.5,z:.5},box,.38),true);
  assert.equal(circleIntersectsBox({x:1.38,z:0},box,.37),false);
});

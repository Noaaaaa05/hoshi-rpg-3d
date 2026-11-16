import { cameraMovement } from './physics.js';

export const MOTION_STATES = ['roll','dodgeLeft','dodgeRight','dodgeBack','land'];
export const DODGE_DURATION = .36;
export const LAND_DURATION = .2;

// Resolve the stick in world space, then compare with the facing at button-down.
export function selectDodge(x,y,yaw,facing) {
  const move=cameraMovement(x,y,yaw);
  if(move.magnitude<.1)return 'roll';
  const forward=(move.x*Math.sin(facing)+move.z*Math.cos(facing))/move.magnitude;
  const right=(move.x*Math.cos(facing)-move.z*Math.sin(facing))/move.magnitude;
  if(Math.abs(right)>Math.abs(forward))return right>0?'dodgeRight':'dodgeLeft';
  return forward<0?'dodgeBack':'roll';
}

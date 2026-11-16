import { cameraMovement } from './physics.js?v=0.2.8';

export const MOTION_STATES = ['roll','dodgeLeft','dodgeRight','dodgeBack','land'];
export const DODGE_DURATION = .36;
export const LAND_DURATION = .2;
export const ROLL_DURATION = .72;

export function motionDuration(state) {
  return state === 'roll' ? ROLL_DURATION : state === 'land' ? LAND_DURATION : DODGE_DURATION;
}

// The retimed BVH pelvis slows during the crouch, rolls forward, then recovers in place.
const rollTravel = [[0,0],[.10,.06],[.15,.17],[.27,.54],[.35,.71],[.50,.87],[.60,1]];

export function rollTravelFraction(time) {
  for(let i=1;i<rollTravel.length;i++){
    const [end,finish]=rollTravel[i];
    if(time<=end){
      const [start,begin]=rollTravel[i-1];
      return begin+(finish-begin)*(Math.max(time,start)-start)/(end-start);
    }
  }
  return 1;
}

// Resolve the stick in world space, then compare with the facing at button-down.
export function selectDodge(x,y,yaw,facing) {
  const move=cameraMovement(x,y,yaw);
  if(move.magnitude<.1)return 'roll';
  const forward=(move.x*Math.sin(facing)+move.z*Math.cos(facing))/move.magnitude;
  const right=(move.x*Math.cos(facing)-move.z*Math.sin(facing))/move.magnitude;
  if(Math.abs(right)>Math.abs(forward))return right>0?'dodgeRight':'dodgeLeft';
  return forward<0?'dodgeBack':'roll';
}

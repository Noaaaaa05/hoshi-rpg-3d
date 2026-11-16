// An actor's circular footprint has rounded clearance at a box corner.
// Growing both rectangle axes would incorrectly reject legal corner contacts.
export function circleIntersectsBox(point,box,radius){
  const dx=Math.max(Math.abs(point.x-box.x)-box.halfX,0);
  const dz=Math.max(Math.abs(point.z-box.z)-box.halfZ,0);
  return Math.hypot(dx,dz)<radius;
}

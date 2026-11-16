// Rendering-independent game rules, shared by the game and Node tests.
export const WORLD_RADIUS = 108;
export const SPAWN = { x: 0, z: 12 };
export const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
export const damp = (a, b, rate, dt) => a + (b - a) * (1 - Math.exp(-rate * dt));
export function heightAt(x, z) {
  return Math.sin(x * .032) * 1.5 + Math.cos(z * .041) * 1.1 + Math.sin((x + z) * .065) * .48;
}
export function cameraMovement(x, y, yaw) {
  const magnitude = Math.min(1, Math.hypot(x, y));
  const length = Math.hypot(x, y) || 1;
  return { x: (x * Math.cos(yaw) + y * Math.sin(yaw)) / length * magnitude,
    z: (-x * Math.sin(yaw) + y * Math.cos(yaw)) / length * magnitude, magnitude };
}
export class CollisionGrid {
  constructor(cellSize = 8) { this.cellSize = cellSize; this.cells = new Map(); this.items = []; }
  key(x, z) { return `${Math.floor(x / this.cellSize)},${Math.floor(z / this.cellSize)}`; }
  add(c) {
    this.items.push(c);
    for (let x = Math.floor((c.x - c.radius) / this.cellSize); x <= Math.floor((c.x + c.radius) / this.cellSize); x++) {
      for (let z = Math.floor((c.z - c.radius) / this.cellSize); z <= Math.floor((c.z + c.radius) / this.cellSize); z++) {
        const key = `${x},${z}`;
        if (!this.cells.has(key)) this.cells.set(key, []);
        this.cells.get(key).push(c);
      }
    }
  }
  query(x, z, radius = .5) {
    const found = new Set();
    for (let gx = Math.floor((x - radius) / this.cellSize); gx <= Math.floor((x + radius) / this.cellSize); gx++) {
      for (let gz = Math.floor((z - radius) / this.cellSize); gz <= Math.floor((z + radius) / this.cellSize); gz++) {
        for (const c of this.cells.get(`${gx},${gz}`) || []) found.add(c);
      }
    }
    return found;
  }
  resolve(x, z, radius = .38) {
    for (let pass = 0; pass < 4; pass++) {
      for (const c of this.query(x, z, radius)) {
        const dx = x - c.x, dz = z - c.z;
        if (c.shape === 'box') {
          const qx = Math.max(c.x - c.halfX, Math.min(x, c.x + c.halfX));
          const qz = Math.max(c.z - c.halfZ, Math.min(z, c.z + c.halfZ));
          const bx = x - qx, bz = z - qz, bd = Math.hypot(bx, bz);
          if (bd < radius) {
            if (bd > .00001) { x += bx / bd * (radius - bd); z += bz / bd * (radius - bd); }
            else {
              const left = Math.abs(x - (c.x - c.halfX)), right = Math.abs(c.x + c.halfX - x);
              const near = Math.abs(z - (c.z - c.halfZ)), far = Math.abs(c.z + c.halfZ - z);
              const edge = Math.min(left, right, near, far);
              if (edge === left) x = c.x - c.halfX - radius;
              else if (edge === right) x = c.x + c.halfX + radius;
              else if (edge === near) z = c.z - c.halfZ - radius;
              else z = c.z + c.halfZ + radius;
            }
          }
          continue;
        }
        const distance = Math.hypot(dx, dz), min = radius + c.radius;
        if (distance < min) {
          if (distance < .00001) { x += min; } else { x += dx / distance * (min - distance); z += dz / distance * (min - distance); }
        }
      }
    }
    const distance = Math.hypot(x, z);
    if (distance > WORLD_RADIUS) { x *= WORLD_RADIUS / distance; z *= WORLD_RADIUS / distance; }
    return { x, z };
  }
}
export class PlayerMotor {
  constructor(grid) { this.grid = grid; this.stamina = 100; this.hp = 100; this.exhausted = false; this.regenDelay = 0; this.reset(); }
  reset(x = SPAWN.x, z = SPAWN.z) {
    const p = this.grid.resolve(x, z);
    this.x = p.x; this.z = p.z; this.y = heightAt(this.x, this.z); this.vx = 0; this.vz = 0; this.vy = 0;
    this.grounded = true; this.angle = Math.PI; this.speed = 0; this.dashing = false;
  }
  step(dt, input, yaw) {
    dt = clamp(dt, 0, 1 / 30);
    const move = cameraMovement(input.x, input.y, yaw);
    if (this.exhausted && this.stamina >= 25) this.exhausted = false;
    this.dashing = !!(input.dash && move.magnitude > .1 && !this.exhausted && this.stamina > 0);
    if (this.dashing) { this.stamina = Math.max(0, this.stamina - 27 * dt); this.regenDelay = .7; }
    else { this.regenDelay = Math.max(0, this.regenDelay - dt); if (!this.regenDelay) this.stamina = Math.min(100, this.stamina + 19 * dt); }
    if (this.stamina <= 0) this.exhausted = true;
    if (input.jump && this.grounded && this.stamina >= 12) {
      this.vy = 7.3; this.grounded = false; this.stamina -= 12; this.regenDelay = .7;
    }
    const targetSpeed = this.dashing ? 8 : 4.1;
    this.vx = damp(this.vx, move.x * targetSpeed, 12, dt);
    this.vz = damp(this.vz, move.z * targetSpeed, 12, dt);
    this.speed = Math.hypot(this.vx, this.vz);
    // Small movement substeps prevent tunneling through tree trunks during a dash.
    const steps = Math.max(1, Math.ceil(this.speed * dt / .18));
    for (let i = 0; i < steps; i++) {
      const p = this.grid.resolve(this.x + this.vx * dt / steps, this.z + this.vz * dt / steps);
      this.x = p.x; this.z = p.z;
    }
    if (move.magnitude > .08) {
      const target = Math.atan2(move.x, move.z);
      const difference = Math.atan2(Math.sin(target - this.angle), Math.cos(target - this.angle));
      this.angle += difference * (1 - Math.exp(-14 * dt));
    }
    const ground = heightAt(this.x, this.z);
    if (this.grounded) this.y = ground;
    else {
      this.vy -= 20 * dt; this.y += this.vy * dt;
      if (this.y <= ground) {
        if (this.vy < -13) this.hp = Math.max(0, this.hp - Math.round((-this.vy - 13) * 5));
        this.y = ground; this.vy = 0; this.grounded = true;
      }
    }
  }
}

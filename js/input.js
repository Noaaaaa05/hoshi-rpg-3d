import { clamp } from './physics.js?v=0.2.8';

export class Input {
  constructor() {
    this.keys = new Set(); this.move = { x: 0, y: 0 }; this.dash = false; this.jump = false;
    this.lookX = 0; this.lookY = 0; this.enabled = false; this.sensitivity = 1;
    this.joyId = null; this.cameraId = null; this.dashId = null;
    this.attack = false; this.attackHeld = false; this.dodge = false;
    this.attackId = null; this.dodgeId = null;
    const stick = document.querySelector('#joystick'), thumb = document.querySelector('#joystick-thumb');
    const updateStick = e => {
      const box = stick.getBoundingClientRect(), range = box.width * .32;
      let x = e.clientX - (box.left + box.width / 2), y = e.clientY - (box.top + box.height / 2);
      const distance = Math.hypot(x, y);
      if (distance > range) { x *= range / distance; y *= range / distance; }
      thumb.style.transform = `translate(${x}px,${y}px)`;
      const magnitude = Math.hypot(x, y) / range;
      const normalized = magnitude < .1 ? 0 : (magnitude - .1) / .9;
      this.move.x = distance ? x / (Math.hypot(x, y) || 1) * normalized : 0;
      this.move.y = distance ? y / (Math.hypot(x, y) || 1) * normalized : 0;
    };
    stick.addEventListener('pointerdown', e => {
      if (!this.enabled || this.joyId !== null) return;
      e.preventDefault(); this.joyId = e.pointerId; stick.setPointerCapture(e.pointerId); updateStick(e);
    });
    stick.addEventListener('pointermove', e => { if (e.pointerId === this.joyId) updateStick(e); });
    const releaseStick = e => { if (e.pointerId === this.joyId) { this.joyId = null; this.move.x = this.move.y = 0; thumb.style.transform = ''; } };
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) stick.addEventListener(type, releaseStick);
    const camera = document.querySelector('#camera-zone');
    camera.addEventListener('pointerdown', e => {
      if (!this.enabled || this.cameraId !== null) return;
      e.preventDefault(); this.cameraId = e.pointerId; this.lastX = e.clientX; this.lastY = e.clientY; camera.setPointerCapture(e.pointerId);
    });
    camera.addEventListener('pointermove', e => {
      if (e.pointerId !== this.cameraId) return;
      this.lookX += clamp(e.clientX - this.lastX, -100, 100) * .005 * this.sensitivity;
      this.lookY += clamp(e.clientY - this.lastY, -100, 100) * .004 * this.sensitivity;
      this.lastX = e.clientX; this.lastY = e.clientY;
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) camera.addEventListener(type, e => { if (e.pointerId === this.cameraId) this.cameraId = null; });
    const dash = document.querySelector('#dash-button');
    dash.addEventListener('pointerdown', e => { if (!this.enabled || this.dashId !== null) return; e.preventDefault(); this.dashId = e.pointerId; this.dash = true; dash.classList.add('pressed'); dash.setPointerCapture(e.pointerId); });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) dash.addEventListener(type, e => { if (e.pointerId === this.dashId) { this.dashId = null; this.dash = false; dash.classList.remove('pressed'); } });
    document.querySelector('#jump-button').addEventListener('pointerdown', e => { if (this.enabled) { e.preventDefault(); this.jump = true; } });
    for (const action of ['attack', 'dodge']) {
      const button = document.querySelector(`#${action}-button`), id = `${action}Id`;
      button.addEventListener('pointerdown', e => {
        if (!this.enabled || this[id] !== null) return;
        e.preventDefault(); this[id] = e.pointerId; this[action] = true;
        if (action === 'attack') this.attackHeld = true;
        button.classList.add('pressed'); button.setPointerCapture(e.pointerId);
      });
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(type, e => {
        if (e.pointerId !== this[id]) return;
        this[id] = null; if (action === 'attack') this.attackHeld = false; button.classList.remove('pressed');
      });
    }
    const gameKeys = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'ShiftLeft', 'ShiftRight', 'KeyJ', 'KeyK'];
    window.addEventListener('keydown', e => {
      if (!this.enabled || !gameKeys.includes(e.code) || /INPUT|SELECT|TEXTAREA/.test(document.activeElement.tagName)) return;
      e.preventDefault(); this.keys.add(e.code); if (e.code === 'Space' && !e.repeat) this.jump = true;
      if (e.code === 'KeyJ' && !e.repeat) this.attack = true;
      if (e.code === 'KeyK' && !e.repeat) this.dodge = true;
    });
    window.addEventListener('keyup', e => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.reset());
    document.addEventListener('contextmenu', e => e.preventDefault());
    this.thumb = thumb; this.dashButton = dash;
  }
  reset() {
    this.keys.clear(); this.move.x = this.move.y = this.lookX = this.lookY = 0;
    this.dash = this.jump = false; this.joyId = this.cameraId = this.dashId = null;
    this.attack = this.attackHeld = this.dodge = false; this.attackId = this.dodgeId = null;
    for (const id of ['attack-button', 'dodge-button']) document.getElementById(id)?.classList.remove('pressed');
    if (this.thumb) this.thumb.style.transform = '';
    if (this.dashButton) this.dashButton.classList.remove('pressed');
  }
  read() {
    const k = this.keys;
    const x = this.move.x + Number(k.has('KeyD') || k.has('ArrowRight')) - Number(k.has('KeyA') || k.has('ArrowLeft'));
    const y = this.move.y + Number(k.has('KeyS') || k.has('ArrowDown')) - Number(k.has('KeyW') || k.has('ArrowUp'));
    const value = { x, y, dash: this.dash || k.has('ShiftLeft') || k.has('ShiftRight'), jump: this.jump, lookX: this.lookX, lookY: this.lookY,
      attack: this.attack, attackHeld: this.attackHeld || k.has('KeyJ'), dodge: this.dodge };
    this.attack = this.dodge = false;
    this.jump = false; this.lookX = this.lookY = 0;
    return value;
  }
}

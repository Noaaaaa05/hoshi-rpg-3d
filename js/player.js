import * as THREE from 'three';
export function createPlayer(scene) {
  const group = new THREE.Group(), visual = new THREE.Group(); group.add(visual); scene.add(group);
  const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 1, flatShading: true, ...extra });
  const coat = mat('#c3c8a6'), dark = mat('#284e4d'), skin = mat('#deb893'), hair = mat('#393d32'), leather = mat('#735f41');
  function mesh(geometry, material, x, y, z, parent = visual) { const m = new THREE.Mesh(geometry, material); m.position.set(x,y,z); parent.add(m); return m; }
  mesh(new THREE.CylinderGeometry(.25,.36,.69,7),coat,0,.92,0);
  mesh(new THREE.CylinderGeometry(.36,.30,.28,7),dark,0,1.28,0);
  const cape = mesh(new THREE.ConeGeometry(.39,.87,5),dark,0,.99,-.13); cape.rotation.x = -.12;
  mesh(new THREE.SphereGeometry(.23,8,6),skin,0,1.64,0);
  mesh(new THREE.SphereGeometry(.24,8,6,0,Math.PI*2,0,Math.PI*.57),hair,0,1.71,-.015);
  const hood = mesh(new THREE.ConeGeometry(.34,.36,7),dark,0,1.94,-.035); hood.rotation.x = -.09;
  const legs = [], arms = [];
  for (const sign of [-1,1]) {
    const pivot = new THREE.Group(); pivot.position.set(sign*.145,.68,0); visual.add(pivot);
    mesh(new THREE.CylinderGeometry(.09,.085,.45,5),leather,0,-.23,0,pivot);
    mesh(new THREE.BoxGeometry(.16,.18,.25),dark,0,-.46,.045,pivot); legs.push(pivot);
    const arm = new THREE.Group(); arm.position.set(sign*.31,1.25,0); visual.add(arm);
    mesh(new THREE.CylinderGeometry(.10,.075,.44,5),coat,0,-.19,0,arm);
    mesh(new THREE.SphereGeometry(.075,6,4),skin,0,-.43,0,arm); arms.push(arm);
  }
  // A warm hand-carried lantern is visible even on the lowest graphics setting.
  const lantern = new THREE.Group(); lantern.position.set(-.02,-.57,.07); arms[1].add(lantern);
  mesh(new THREE.TorusGeometry(.06,.012,4,8),leather,0,.12,0,lantern);
  mesh(new THREE.BoxGeometry(.14,.19,.14),mat('#ffd992',{emissive:'#ffb949',emissiveIntensity:1.7}),0,0,0,lantern);
  for (const y of [-.11,.11]) mesh(new THREE.BoxGeometry(.18,.035,.18),leather,0,y,0,lantern);
  const sword = new THREE.Group(); sword.position.set(0,-.43,0); arms[0].add(sword);
  mesh(new THREE.BoxGeometry(.075,.69,.045),mat('#d6e3ce',{metalness:.25,roughness:.55}),0,-.43,0,sword);
  mesh(new THREE.BoxGeometry(.25,.055,.08),leather,0,-.07,0,sword);
  mesh(new THREE.CylinderGeometry(.035,.035,.15,5),leather,0,.035,0,sword);
  const glow = new THREE.PointLight('#ffd48b',3.5,6,2); glow.position.set(.4,1,0); group.add(glow);
  const shadow = new THREE.Mesh(new THREE.CircleGeometry(.46,20),new THREE.MeshBasicMaterial({color:'#092c2b',transparent:true,opacity:.28,depthWrite:false})); shadow.rotation.x = -Math.PI/2; scene.add(shadow);
  let phase = 0;
  const api = { group, animateModel: null,
    replaceVisual(model) { visual.visible = false; group.add(model); },
    update(dt, motor, ground, combat) {
      group.position.set(motor.x,motor.y,motor.z); group.rotation.y = motor.angle;
      phase += dt * motor.speed * 2.1;
      const swing = Math.min(1,motor.speed/3.5)*.6;
      legs[0].rotation.x = Math.sin(phase)*swing; legs[1].rotation.x = -Math.sin(phase)*swing;
      arms[0].rotation.x = -Math.sin(phase)*swing*.6; arms[1].rotation.x = Math.sin(phase)*swing*.25-.16;
      arms[0].rotation.z = 0;
      if (combat?.attacking) {
        const p = combat.attackPhase;
        arms[0].rotation.x = -1.15 - Math.sin(p*Math.PI)*.45;
        arms[0].rotation.z = Math.sin((p-.1)*Math.PI*1.3)*1.3;
      }
      visual.rotation.x = combat?.dodging ? -.45 : 0;
      visual.position.y = motor.grounded ? Math.abs(Math.sin(phase))*swing*.055 : .04;
      cape.rotation.x = -.12 + motor.speed*.025;
      shadow.position.set(motor.x,ground+.025,motor.z); shadow.scale.setScalar(1+Math.max(0,motor.y-ground)*.16);
      shadow.material.opacity = .28 / (1 + Math.max(0,motor.y-ground));
      api.animateModel?.(dt,motor,combat);
    }
  };
  return api;
}

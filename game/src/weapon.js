// Weapons: one table owns every gun's numbers, and one system owns the view
// model, the magazine, the reload and the spread. main.js owns the ray and the
// damage; this module only says whether a round may leave and how wild it is.
// Spread punishes moving and jumping, rewards standing still and crouching:
// stopping to aim pays, exactly as the bounty asks.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

export const WEAPONS = {
  pistol: {
    id: 'pistol', name: 'P9 Sidearm', price: 0, damage: 26, headMul: 3.0,
    mag: 12, reserve: 60, gap: 0.17, auto: false, reload: 1.3,
    spreadStill: 0.004, spreadMove: 0.03, kick: 0.006,
  },
  rifle: {
    id: 'rifle', name: 'VK-47', price: 2700, damage: 34, headMul: 2.8,
    mag: 30, reserve: 90, gap: 0.1, auto: true, reload: 2.1,
    spreadStill: 0.003, spreadMove: 0.034, kick: 0.011,
  },
  smg: {
    id: 'smg', name: 'Kestrel-9', price: 1500, damage: 22, headMul: 2.5,
    mag: 32, reserve: 96, gap: 0.072, auto: true, reload: 1.7,
    spreadStill: 0.006, spreadMove: 0.042, kick: 0.007,
  },
  sniper: {
    id: 'sniper', name: 'Longbow', price: 4750, damage: 92, headMul: 3.0,
    mag: 5, reserve: 15, gap: 1.15, auto: false, reload: 2.9,
    spreadStill: 0.0008, spreadMove: 0.05, kick: 0.03,
  },
};

export const GRENADE = { id: 'grenade', name: 'Frag Grenade', price: 300, max: 2 };
export const ARMOR = { id: 'armor', name: 'Kevlar Vest', price: 650 };

const MUZZLE_TIME = 0.06;
const MOVE_REFERENCE = 5.2;

function buildViewModel(def) {
  // Four silhouettes from boxes, so the gun in your hands reads as a different
  // weapon at a glance: short pistol, long rifle, compact SMG, thin scoped sniper.
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.7, metalness: 0.2 });
  const steel = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.45, metalness: 0.4 });
  const grip = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.rust), roughness: 0.6, metalness: 0.1 });
  const group = new THREE.Group();
  const add = (w, h, d, x, y, z, mat) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    group.add(mesh);
    return mesh;
  };
  if (def.id === 'pistol') {
    add(0.07, 0.09, 0.24, 0, 0, -0.1, steel);
    add(0.06, 0.12, 0.07, 0, -0.08, 0.04, grip);
  } else if (def.id === 'smg') {
    add(0.08, 0.1, 0.4, 0, 0, -0.12, steel);
    add(0.05, 0.05, 0.22, 0, 0.02, -0.4, dark);
    add(0.06, 0.14, 0.08, 0, -0.09, 0.05, grip);
    add(0.07, 0.06, 0.16, 0, -0.05, -0.02, dark);
  } else if (def.id === 'sniper') {
    add(0.07, 0.09, 0.62, 0, 0, -0.2, steel);
    add(0.05, 0.05, 0.1, 0, 0.06, -0.12, dark);
    add(0.06, 0.06, 0.3, 0, -0.01, 0.28, dark);
    const scope = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.2, 10), dark);
    scope.rotation.x = Math.PI / 2;
    scope.position.set(0, 0.08, -0.05);
    group.add(scope);
  } else {
    add(0.09, 0.1, 0.46, 0, 0, -0.14, steel);
    add(0.045, 0.045, 0.42, 0, 0.025, -0.42, dark);
    add(0.075, 0.08, 0.22, 0, -0.02, 0.28, grip);
    add(0.06, 0.12, 0.08, 0, -0.09, 0.02, grip);
  }
  group.position.set(0.24, -0.2, -0.42);
  return group;
}

export function createWeapon(camera) {
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.26, 0.26),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.24, -0.17, -0.95);
  flash.visible = false;
  camera.add(flash);
  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 5);
  flashLight.position.set(0.24, -0.16, -0.6);
  camera.add(flashLight);

  const models = {};
  for (const def of Object.values(WEAPONS)) {
    const model = buildViewModel(def);
    model.visible = false;
    camera.add(model);
    models[def.id] = model;
  }

  const state = {
    current: 'pistol',
    mag: WEAPONS.pistol.mag,
    reserve: WEAPONS.pistol.reserve,
    cooldown: 0,
    reloadLeft: 0,
    flash: 0,
    kick: 0,
    grenades: 0,
  };
  let model = models.pistol;
  model.visible = true;

  function step(dt) {
    state.cooldown = Math.max(0, state.cooldown - dt);
    state.flash = Math.max(0, state.flash - dt);
    state.kick += (0 - state.kick) * Math.min(1, dt * 14);
    model.position.z = -0.42 + state.kick;
    model.rotation.x = state.kick * 2.2;
    flash.visible = state.flash > 0;
    flash.rotation.z = state.flash * 30;
    flashLight.intensity = state.flash > 0 ? 18 : 0;
    if (state.reloadLeft > 0) {
      state.reloadLeft = Math.max(0, state.reloadLeft - dt);
      const def = WEAPONS[state.current];
      model.rotation.x = -0.55 * Math.min(1, (def.reload - state.reloadLeft) * 2);
      if (state.reloadLeft === 0) {
        const need = def.mag - state.mag;
        const take = Math.min(need, state.reserve);
        state.mag += take;
        state.reserve -= take;
      }
    }
  }

  return {
    state,
    step,
    def() {
      return WEAPONS[state.current];
    },
    ready() {
      return state.mag > 0 && state.cooldown === 0 && state.reloadLeft === 0;
    },
    pullTrigger() {
      state.cooldown = WEAPONS[state.current].gap;
      state.flash = MUZZLE_TIME;
      state.kick = 0.055;
    },
    takeRound() {
      if (state.mag <= 0) return false;
      state.mag -= 1;
      return true;
    },
    reload() {
      const def = WEAPONS[state.current];
      if (state.reloadLeft > 0 || state.mag === def.mag || state.reserve === 0) return;
      state.reloadLeft = def.reload;
    },
    spread(speed, crouching, airborne) {
      const def = WEAPONS[state.current];
      let value = def.spreadStill + Math.min(1, speed / MOVE_REFERENCE) * def.spreadMove;
      if (crouching) value *= 0.6;
      if (airborne) value += 0.02;
      return value;
    },
    switchTo(id) {
      if (!WEAPONS[id] || id === state.current || state.reloadLeft > 0) return false;
      model.visible = false;
      state.current = id;
      const def = WEAPONS[id];
      state.mag = def.mag;
      state.reserve = def.reserve;
      state.cooldown = 0.25;
      state.reloadLeft = 0;
      model = models[id];
      model.visible = true;
      model.rotation.x = 0;
      return true;
    },
    // Buying a weapon mid-buy-phase arms it with a full loadout.
    buy(id) {
      model.visible = false;
      state.current = id;
      const def = WEAPONS[id];
      state.mag = def.mag;
      state.reserve = def.reserve;
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
      model = models[id];
      model.visible = true;
      model.rotation.x = 0;
    },
    refill() {
      const def = WEAPONS[state.current];
      state.mag = def.mag;
      state.reserve = def.reserve;
      state.cooldown = 0;
      state.reloadLeft = 0;
      state.flash = 0;
      state.kick = 0;
    },
  };
}

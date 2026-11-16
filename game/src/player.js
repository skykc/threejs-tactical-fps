// The player: first-person movement with acceleration, friction, gravity, jump
// and crouch, resolved through the world's collideMove. It also owns the two
// invisible hitboxes the bots' raycasts test against (torso and head), so a bot
// can tell a body hit from a head shot exactly like the player can tell on a bot.
// Health and armour live here too: armour soaks half of every hit until it runs out.
import * as THREE from 'three';

const RADIUS = 0.34;
const STAND_HEIGHT = 1.72;
const CROUCH_HEIGHT = 1.12;
const STAND_EYE = 1.6;
const CROUCH_EYE = 1.02;
const WALK_SPEED = 5.2;
const SLOW_SPEED = 2.6;
const CROUCH_SPEED = 2.4;
const GROUND_ACCEL = 42;
const AIR_ACCEL = 9;
const FRICTION = 9;
const GRAVITY = 20;
const JUMP_SPEED = 6.2;

export function createPlayer(scene, collideMove) {
  const state = {
    position: new THREE.Vector3(0, 0, 11.5),
    velocity: new THREE.Vector3(),
    yaw: 0,
    pitch: 0,
    eye: STAND_EYE,
    onGround: true,
    crouching: false,
    walking: false,
    height: STAND_HEIGHT,
    health: 100,
    armor: 0,
    alive: true,
  };
  const wish = new THREE.Vector3();
  const hitMaterial = new THREE.MeshBasicMaterial({ visible: false });
  const torsoBox = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.85, 0.38), hitMaterial);
  const headBox = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.32, 0.34), hitMaterial);
  torsoBox.userData.part = 'torso';
  headBox.userData.part = 'head';
  torsoBox.userData.player = true;
  headBox.userData.player = true;
  scene.add(torsoBox, headBox);

  function syncHitboxes() {
    torsoBox.position.set(state.position.x, state.position.y + state.height * 0.55, state.position.z);
    torsoBox.rotation.y = state.yaw;
    headBox.position.set(state.position.x, state.position.y + state.height - 0.16, state.position.z);
    headBox.rotation.y = state.yaw;
  }

  function look(dx, dy, sensitivity = 0.0022) {
    state.yaw -= dx * sensitivity;
    state.pitch = Math.max(-1.45, Math.min(1.45, state.pitch - dy * sensitivity));
  }

  function recoil(pitchKick, yawKick) {
    state.pitch = Math.min(1.45, state.pitch + pitchKick);
    state.yaw += yawKick;
  }

  function step(dt, keys) {
    if (!state.alive) return;
    const crouching = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
    state.walking = keys.has('ShiftLeft') || keys.has('ShiftRight');
    if (crouching && !state.crouching) {
      state.crouching = true;
      state.height = CROUCH_HEIGHT;
    } else if (!crouching && state.crouching) {
      state.crouching = false;
      state.height = STAND_HEIGHT;
    }
    const eyeTarget = state.crouching ? CROUCH_EYE : STAND_EYE;
    state.eye += (eyeTarget - state.eye) * Math.min(1, dt * 12);

    const forward = (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0);
    const strafe = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
    wish.set(0, 0, 0);
    if (forward || strafe) {
      const sin = Math.sin(state.yaw);
      const cos = Math.cos(state.yaw);
      wish.set(-sin * forward + cos * strafe, 0, -cos * forward - sin * strafe).normalize();
    }

    const speed = state.crouching ? CROUCH_SPEED : state.walking ? SLOW_SPEED : WALK_SPEED;
    const blend = Math.min(1, (state.onGround ? GROUND_ACCEL : AIR_ACCEL) * dt / speed);
    state.velocity.x += (wish.x * speed - state.velocity.x) * blend;
    state.velocity.z += (wish.z * speed - state.velocity.z) * blend;
    if (state.onGround && !wish.lengthSq()) {
      const damp = Math.max(0, 1 - FRICTION * dt);
      state.velocity.x *= damp;
      state.velocity.z *= damp;
    }

    if (keys.has('Space') && state.onGround) {
      state.velocity.y = JUMP_SPEED;
      state.onGround = false;
    }
    state.velocity.y -= GRAVITY * dt;
    state.onGround = collideMove(state.position, state.velocity, dt, RADIUS, state.height);
    state.velocity.y = Math.max(-30, state.velocity.y);
    syncHitboxes();
  }

  function damage(amount) {
    if (!state.alive) return false;
    let rest = amount;
    if (state.armor > 0) {
      const soaked = Math.min(state.armor, rest * 0.5);
      state.armor -= soaked;
      rest -= soaked;
    }
    state.health -= rest;
    if (state.health <= 0) {
      state.health = 0;
      state.alive = false;
      return true;
    }
    return false;
  }

  function reset(spawn) {
    state.position.set(spawn.x, 0, spawn.z);
    state.velocity.set(0, 0, 0);
    state.yaw = spawn.yaw;
    state.pitch = 0;
    state.eye = STAND_EYE;
    state.height = STAND_HEIGHT;
    state.crouching = false;
    state.health = 100;
    state.alive = true;
    syncHitboxes();
  }

  syncHitboxes();

  return {
    state,
    step,
    look,
    recoil,
    damage,
    reset,
    hitboxes: [torsoBox, headBox],
    groundSpeed() {
      return Math.hypot(state.velocity.x, state.velocity.z);
    },
  };
}

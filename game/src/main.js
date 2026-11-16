// Boot and the one loop: a fixed 60 Hz simulation feeding a render at the
// display's rate, and the whole match in one state object. Phases: buy (15 s,
// buy menu open) -> live (90 s, plant the bomb or eliminate the defenders) ->
// round end -> next round; first to 5 rounds takes the match. The player attacks
// with the bomb; four defender bots hold the sites, converge when it is planted
// and defuse it. ?shot=start|play|plant|end with &seed=N stages a deterministic
// frame for a capture, renders it twice, then freezes and sets window.__shotReady.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createWorld } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createWeapon, WEAPONS, GRENADE, ARMOR } from './weapon.js';
import { createBots } from './bots.js';
import { createHud } from './hud.js';

const FIXED_STEP = 1 / 60;
const BUY_SECONDS = 15;
const ROUND_SECONDS = 90;
const PLANT_SECONDS = 3;
const DETONATE_SECONDS = 35;
const WIN_ROUNDS = 5;
const KILL_REWARD = 300;
const WIN_REWARD = 325;
const LOSS_REWARD = 190;
const PLANT_REWARD = 300;
const GRENADE_FUSE = 1.4;
const GRENADE_RADIUS = 6;
const WEAPON_KEYS = ['Digit1', 'Digit2', 'Digit3', 'Digit4'];
const WEAPON_IDS = ['pistol', 'rifle', 'smg', 'sniper'];

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const random = mulberry32(seed);

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.canvas), 26, 62);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 160);
scene.add(camera);

const world = createWorld(scene);
const bots = createBots(scene, world);
const weapon = createWeapon(camera);
const hud = createHud();
const player = createPlayer(scene, world.collideMove);
const input = createInput(renderer.domElement, onLockChange);
const raycaster = new THREE.Raycaster();
raycaster.far = 90;
const direction = new THREE.Vector3();
const tmpVec = new THREE.Vector3();

// One reused tracer line and one reused explosion, so shooting never allocates.
const tracerGeo = new THREE.BufferGeometry();
tracerGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
const tracer = new THREE.Line(tracerGeo, new THREE.LineBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9 }));
tracer.visible = false;
tracer.frustumCulled = false;
scene.add(tracer);
let tracerLife = 0;

const blast = new THREE.Mesh(
  new THREE.SphereGeometry(1, 16, 12),
  new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0 }),
);
blast.visible = false;
scene.add(blast);
const blastLight = new THREE.PointLight(new THREE.Color(PALETTE.accent), 0, 18);
scene.add(blastLight);
let blastLife = 0;

// The bomb device: a dark box with a blinking light, placed on the site when planted.
const bombMesh = new THREE.Group();
const bombBody = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.2, 0.26), new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.6 }));
const bombLight = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff2e2e') }));
bombLight.position.set(0.12, 0.13, 0);
bombMesh.add(bombBody, bombLight);
bombMesh.visible = false;
scene.add(bombMesh);

const bomb = { state: 'carried', site: null, plantProgress: 0, defuseProgress: 0, detonateLeft: 0 };
const grenades = [];
const grenadeGeo = new THREE.SphereGeometry(0.09, 10, 8);
const grenadeMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.5, metalness: 0.4 });

const game = {
  phase: 'buy',
  round: 1,
  wins: 0,
  losses: 0,
  money: 800,
  timer: BUY_SECONDS,
  elapsed: 0,
  started: false,
  plantedReward: false,
};
const owned = new Set(['pistol']);
let frozen = false;
let accumulator = 0;
let lastTime = performance.now();
let prevFiring = false;

function body() {
  return player.state;
}

function syncCamera() {
  const p = body();
  camera.position.set(p.position.x, p.position.y + p.eye, p.position.z);
  camera.rotation.set(p.pitch, p.yaw, 0, 'YXZ');
}

function aimAt(point) {
  const p = body();
  const dx = point.x - p.position.x;
  const dy = point.y - (p.position.y + p.eye);
  const dz = point.z - p.position.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  p.yaw = Math.atan2(-dx, -dz);
  p.pitch = Math.asin(Math.max(-1, Math.min(1, dy / length)));
  syncCamera();
}

function liveBotMeshes() {
  const meshes = [];
  for (const bot of bots.list) {
    if (bot.alive) meshes.push(bot.torso, bot.head);
  }
  return meshes;
}

function shoot(spread) {
  if (!weapon.takeRound()) {
    weapon.reload();
    return false;
  }
  camera.getWorldDirection(direction);
  direction.x += (random() * 2 - 1) * spread;
  direction.y += (random() * 2 - 1) * spread;
  direction.z += (random() * 2 - 1) * spread;
  direction.normalize();
  scene.updateMatrixWorld(true);
  raycaster.set(camera.position, direction);
  const targets = world.shootables.concat(liveBotMeshes());
  const hit = raycaster.intersectObjects(targets, false)[0];
  const def = weapon.def();
  let endPoint = tmpVec.copy(direction).multiplyScalar(80).add(camera.position);
  if (hit) {
    endPoint = hit.point;
    if (hit.object.userData.bot && game.phase === 'live') {
      // Buy time is safe: shots fired before the round goes live cannot hurt a bot.
      const bot = hit.object.userData.bot;
      const isHead = hit.object.userData.part === 'head';
      const killed = bots.damage(bot, def.damage * (isHead ? def.headMul : 1));
      hud.hitMarker(killed, shot ? 4000 : 90);
      hud.setScore(game.wins, game.losses);
      if (killed) {
        game.money += KILL_REWARD;
        hud.killFeed(`YOU — Defender down [${def.name}]  +$${KILL_REWARD}`);
      }
    }
  }
  // Tracer from the muzzle to the hit point, reused every shot.
  const positions = tracerGeo.attributes.position.array;
  positions[0] = camera.position.x + direction.x * 0.5;
  positions[1] = camera.position.y + direction.y * 0.5 - 0.12;
  positions[2] = camera.position.z + direction.z * 0.5;
  positions[3] = endPoint.x;
  positions[4] = endPoint.y;
  positions[5] = endPoint.z;
  tracerGeo.attributes.position.needsUpdate = true;
  tracer.visible = true;
  tracerLife = 0.06;
  weapon.pullTrigger();
  player.recoil(def.kick * (0.8 + random() * 0.4), (random() * 2 - 1) * 0.004);
  if (game.phase === 'live') bots.hearShot(body().position);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve, def.name, weapon.state.grenades);
  return true;
}

function throwGrenade() {
  if (weapon.state.grenades <= 0 || game.phase !== 'live') return;
  weapon.state.grenades -= 1;
  camera.getWorldDirection(direction);
  const mesh = new THREE.Mesh(grenadeGeo, grenadeMat);
  mesh.position.copy(camera.position).addScaledVector(direction, 0.5);
  mesh.castShadow = true;
  scene.add(mesh);
  grenades.push({
    mesh,
    pos: mesh.position,
    vel: new THREE.Vector3(direction.x * 17, direction.y * 17 + 3.5, direction.z * 17),
    fuse: GRENADE_FUSE,
  });
  hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.def().name, weapon.state.grenades);
}

function explodeGrenade(g) {
  scene.remove(g.mesh);
  blast.position.copy(g.pos);
  blast.visible = true;
  blastLife = 0.35;
  blastLight.position.copy(g.pos);
  blastLight.intensity = 60;
  for (const bot of bots.list) {
    if (!bot.alive) continue;
    const dist = Math.hypot(bot.pos.x - g.pos.x, bot.pos.z - g.pos.z);
    if (dist > GRENADE_RADIUS) continue;
    const amount = 90 - (70 * dist) / GRENADE_RADIUS;
    if (bots.damage(bot, amount)) {
      game.money += KILL_REWARD;
      hud.killFeed(`YOU — Defender down [Frag]  +$${KILL_REWARD}`);
    }
  }
  const p = body();
  const distP = Math.hypot(p.position.x - g.pos.x, p.position.z - g.pos.z);
  if (distP < GRENADE_RADIUS && p.alive) {
    const died = player.damage((90 - (70 * distP) / GRENADE_RADIUS) * 0.5);
    hud.damageFlash();
    if (died) hud.killFeed('YOU — caught by your own frag');
  }
  if (game.phase === 'live') bots.hearShot(g.pos);
}

function stepGrenades(dt) {
  for (let i = grenades.length - 1; i >= 0; i -= 1) {
    const g = grenades[i];
    g.vel.y -= 14 * dt;
    const vx = g.vel.x;
    const vy = g.vel.y;
    const vz = g.vel.z;
    world.collideMove(g.pos, g.vel, dt, 0.12, 0.12);
    if (g.vel.x === 0 && vx !== 0) g.vel.x = -vx * 0.45;
    if (g.vel.y === 0 && vy !== 0) g.vel.y = -vy * 0.45;
    if (g.vel.z === 0 && vz !== 0) g.vel.z = -vz * 0.45;
    g.fuse -= dt;
    if (g.fuse <= 0) {
      explodeGrenade(g);
      grenades.splice(i, 1);
    }
  }
  if (blastLife > 0) {
    blastLife -= dt;
    const t = 1 - Math.max(0, blastLife / 0.35);
    blast.scale.setScalar(0.5 + t * GRENADE_RADIUS);
    blast.material.opacity = Math.max(0, 0.55 * (1 - t));
    blastLight.intensity = Math.max(0, 60 * (1 - t));
    if (blastLife <= 0) blast.visible = false;
  }
  if (tracerLife > 0) {
    tracerLife -= dt;
    if (tracerLife <= 0) tracer.visible = false;
  }
}

function plantBomb(siteName) {
  bomb.state = 'planted';
  bomb.site = siteName;
  bomb.detonateLeft = DETONATE_SECONDS;
  bomb.defuseProgress = 0;
  const site = world.sites[siteName];
  bombMesh.position.set(site.centre.x, 0.12, site.centre.z);
  bombMesh.visible = true;
  game.money += PLANT_REWARD;
  game.plantedReward = true;
  hud.bannerText(`BOMB PLANTED — SITE ${siteName}`);
  hud.killFeed(`YOU planted the bomb  +$${PLANT_REWARD}`);
}

function detonateBomb() {
  bomb.state = 'gone';
  bombMesh.visible = false;
  blast.position.copy(bombMesh.position);
  blast.visible = true;
  blastLife = 0.6;
  blastLight.position.copy(bombMesh.position);
  blastLight.intensity = 90;
  endRound(true, 'Bomb detonated — site lost');
}

function endRound(won, reason) {
  if (game.phase === 'roundEnd' || game.phase === 'matchEnd') return;
  game.phase = 'roundEnd';
  if (won) {
    game.wins += 1;
    game.money += WIN_REWARD;
  } else {
    game.losses += 1;
    game.money += LOSS_REWARD;
  }
  hud.hideBuy();
  hud.setScore(game.wins, game.losses);
  hud.setMoney(game.money);
  const detail = `${reason}. ${game.wins} — ${game.losses}. ${won ? `+$${WIN_REWARD}` : `+$${LOSS_REWARD}`}`;
  if (game.wins >= WIN_ROUNDS || game.losses >= WIN_ROUNDS) {
    game.phase = 'matchEnd';
    const matchWon = game.wins >= WIN_ROUNDS;
    hud.showOverlay('matchEnd', `${matchWon ? 'You take Depot 9.' : 'The defenders hold Depot 9.'} Final score ${game.wins} — ${game.losses}.`);
    hud.bannerText(matchWon ? 'MATCH WON' : 'MATCH LOST', 4000);
  } else {
    hud.showOverlay('roundEnd', detail);
    hud.bannerText(won ? 'ROUND WON' : 'ROUND LOST', 3000);
  }
  if (document.pointerLockElement) document.exitPointerLock();
}

function resetRound() {
  game.phase = 'buy';
  game.timer = BUY_SECONDS;
  game.plantedReward = false;
  bomb.state = 'carried';
  bomb.site = null;
  bomb.plantProgress = 0;
  bomb.defuseProgress = 0;
  bomb.detonateLeft = 0;
  bombMesh.visible = false;
  for (const g of grenades) scene.remove(g.mesh);
  grenades.length = 0;
  blast.visible = false;
  tracer.visible = false;
  player.reset(world.spawns.attacker);
  bots.reset(shot ? random : Math.random);
  weapon.refill();
  hud.hideOverlay();
  hud.setScore(game.wins, game.losses);
  hud.setMoney(game.money);
  hud.setBomb('');
  hud.setPlant(0);
  hud.bannerText(`ROUND ${game.round} — BUY PHASE`);
  hud.showBuy(game.money, [...owned], onBuy);
}

function restartMatch() {
  game.round = 1;
  game.wins = 0;
  game.losses = 0;
  game.money = 800;
  owned.clear();
  owned.add('pistol');
  weapon.buy('pistol');
  resetRound();
}

function onBuy(id, price) {
  if (game.money < price) return;
  if (WEAPONS[id] && owned.has(id)) return;
  if (id === ARMOR.id && player.state.armor >= 100) return;
  if (id === GRENADE.id && weapon.state.grenades >= GRENADE.max) return;
  game.money -= price;
  if (WEAPONS[id]) {
    owned.add(id);
    weapon.buy(id);
  } else if (id === GRENADE.id) {
    weapon.state.grenades += 1;
  } else if (id === ARMOR.id) {
    player.state.armor = 100;
  }
  hud.setMoney(game.money);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.def().name, weapon.state.grenades);
  hud.showBuy(game.money, [...owned], onBuy);
}

function stepBomb(dt) {
  if (game.phase !== 'live') return;
  const p = body();
  if (bomb.state === 'carried') {
    const site = world.insideSite(p.position.x, p.position.z);
    if (site && input.state.keys.has('KeyE') && p.alive) {
      bomb.plantProgress += dt / PLANT_SECONDS;
      hud.setPlant(bomb.plantProgress, `PLANTING — SITE ${site}`);
      if (bomb.plantProgress >= 1) plantBomb(site);
    } else {
      bomb.plantProgress = Math.max(0, bomb.plantProgress - dt * 2);
      hud.setPlant(bomb.plantProgress);
    }
  } else if (bomb.state === 'planted') {
    bomb.detonateLeft -= dt;
    bombLight.material.color.setHex(Math.floor(game.elapsed * 4) % 2 === 0 ? 0xff2e2e : 0x550000);
    const anyDefusing = bots.list.some((bot) => bot.alive && bot.defusing);
    if (anyDefusing) hud.setPlant(bomb.defuseProgress, 'DEFUSE IN PROGRESS — STOP THEM');
    else {
      bomb.defuseProgress = Math.max(0, bomb.defuseProgress - dt * 0.3);
      hud.setPlant(0);
    }
    if (bomb.defuseProgress >= 1) {
      bomb.state = 'gone';
      bombMesh.visible = false;
      endRound(false, 'Bomb defused');
    } else if (bomb.detonateLeft <= 0) {
      detonateBomb();
    }
  }
}

function step(dt) {
  game.elapsed += dt;
  player.step(dt, input.state.keys);
  weapon.step(dt);
  bots.step(dt, game.elapsed, {
    player,
    phase: game.phase,
    collideMove: world.collideMove,
    bomb,
    damagePlayer(amount, isHead) {
      const died = player.damage(amount);
      hud.damageFlash();
      if (died) hud.killFeed(`Defender — YOU [${isHead ? 'headshot' : 'rifle'}]`);
    },
  });
  stepGrenades(dt);
  stepBomb(dt);

  if (game.phase === 'buy') {
    game.timer -= dt;
    if (game.timer <= 0) {
      game.phase = 'live';
      game.timer = ROUND_SECONDS;
      hud.hideBuy();
      hud.bannerText(`ROUND ${game.round} — PLANT THE BOMB`);
    }
  } else if (game.phase === 'live') {
    if (bomb.state !== 'planted') game.timer -= dt;
    if (bots.aliveCount() === 0) {
      endRound(true, 'All defenders eliminated');
    } else if (!body().alive) {
      endRound(false, 'You were eliminated');
    } else if (game.timer <= 0 && bomb.state !== 'planted') {
      endRound(false, 'Time expired — bomb not planted');
    }
  }
}

function syncHud() {
  const p = body();
  const def = weapon.def();
  hud.setHealth(p.health, p.armor);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve, def.name, weapon.state.grenades);
  hud.setMoney(game.money);
  hud.setScore(game.wins, game.losses);
  hud.setAlive(p.alive ? 1 : 0, bots.aliveCount());
  const spreadPx = 6 + weapon.spread(player.groundSpeed(), p.crouching, !p.onGround) * 900;
  hud.setSpread(spreadPx);
  if (game.phase === 'buy') hud.setTimer(game.timer, 'buy');
  else if (game.phase === 'live') hud.setTimer(bomb.state === 'planted' ? bomb.detonateLeft : game.timer, 'live');
  else hud.setTimer(0, 'live');
  if (bomb.state === 'planted') {
    hud.setBomb(`◉ BOMB — SITE ${bomb.site} — ${Math.ceil(bomb.detonateLeft)}s`);
  } else if (bomb.state === 'carried' && game.phase === 'live') {
    hud.setBomb('◆ BOMB — carry it to A or B, hold E to plant');
  } else {
    hud.setBomb('');
  }
}

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;
  if (!frozen) {
    const look = input.takeLook();
    player.look(look.x, look.y);
    const def = weapon.def();
    const firing = input.state.firing;
    if (firing && weapon.ready()) {
      if (def.auto) shoot(weapon.spread(player.groundSpeed(), body().crouching, !body().onGround));
      else if (!prevFiring) shoot(weapon.spread(player.groundSpeed(), body().crouching, !body().onGround));
    }
    prevFiring = firing;
    if (input.state.keys.has('KeyR')) weapon.reload();
    for (let i = 0; i < WEAPON_KEYS.length; i += 1) {
      if (input.takePressed(WEAPON_KEYS[i]) && owned.has(WEAPON_IDS[i])) {
        weapon.switchTo(WEAPON_IDS[i]);
        hud.setAmmo(weapon.state.mag, weapon.state.reserve, weapon.def().name, weapon.state.grenades);
      }
    }
    if (input.takePressed('KeyG')) throwGrenade();
    if (input.takePressed('KeyB') && game.phase === 'buy') {
      if (hud.buyVisible()) {
        hud.hideBuy();
        input.requestLock();
      } else {
        hud.showBuy(game.money, [...owned], onBuy);
        if (document.pointerLockElement) document.exitPointerLock();
      }
    }
    accumulator += dt;
    let steps = 0;
    while (accumulator >= FIXED_STEP && steps < 5) {
      step(FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }
    if (accumulator > FIXED_STEP * 5) accumulator = 0;
    syncCamera();
    syncHud();
  }
  renderer.render(scene, camera);
}

function settle(steps) {
  for (let index = 0; index < steps; index += 1) step(FIXED_STEP);
}

function paintTwiceThenReady() {
  let painted = 0;
  function paint() {
    requestAnimationFrame(paint);
    syncCamera();
    syncHud();
    renderer.render(scene, camera);
    painted += 1;
    if (painted === 2) {
      window.__shotReady = true;
      frozen = true;
    }
  }
  requestAnimationFrame(paint);
}

function runShot(name) {
  hud.hideOverlay();
  hud.hideBuy();
  body().pitch = 0;
  body().yaw = 0;
  if (name === 'start') {
    resetRound();
    aimAt(new THREE.Vector3(0, 1.5, -10));
    hud.showBuy(game.money, [...owned], onBuy);
  } else if (name === 'play') {
    game.phase = 'live';
    game.timer = 73;
    weapon.buy('rifle');
    owned.add('rifle');
    body().position.set(0, 0, 4);
    const botA = bots.list[3];
    botA.pos.set(1.5, 0, -2);
    botA.yaw = Math.PI;
    botA.state = 'hold';
    const botB = bots.list[1];
    botB.pos.set(5, 0, -6);
    botB.yaw = Math.PI * 0.75;
    botB.state = 'hold';
    settle(20);
    aimAt(new THREE.Vector3(botA.pos.x, 1.35, botA.pos.z));
    shoot(0);
    settle(1);
    hud.setScore(0, 0);
  } else if (name === 'plant') {
    game.phase = 'live';
    game.timer = 90;
    weapon.buy('rifle');
    owned.add('rifle');
    plantBomb('A');
    bomb.detonateLeft = 24;
    body().position.set(-10, 0, -6);
    const botA = bots.list[0];
    botA.pos.set(-13, 0, -8.5);
    botA.yaw = Math.PI * 0.5;
    botA.state = 'hold';
    settle(20);
    aimAt(new THREE.Vector3(-15.5, 1.2, -9.5));
    hud.setBomb('◉ BOMB — SITE A — 24s');
  } else if (name === 'end') {
    game.phase = 'roundEnd';
    game.wins = 1;
    game.round = 2;
    const botA = bots.list[0];
    botA.pos.set(-15, 0, -9);
    botA.alive = false;
    botA.fall = 1;
    botA.group.rotation.x = -1.5;
    body().position.set(-11, 0, -4);
    settle(20);
    aimAt(new THREE.Vector3(-15, 1.0, -9));
    hud.setScore(1, 0);
    hud.showOverlay('roundEnd', 'Bomb detonated — site lost. 1 — 0. +$325');
    hud.bannerText('ROUND WON', 4000);
  }
  syncHud();
  paintTwiceThenReady();
}

function onLockChange(locked) {
  if (shot) return;
  if (locked) {
    game.started = true;
    hud.hideOverlay();
  } else if (game.phase === 'buy' || game.phase === 'live') {
    hud.showOverlay(game.started ? 'paused' : 'start');
  }
}

hud.onPlay(() => {
  if (shot) return;
  if (game.phase === 'matchEnd') {
    restartMatch();
    input.requestLock();
    return;
  }
  if (game.phase === 'roundEnd') {
    game.round += 1;
    resetRound();
    input.requestLock();
    return;
  }
  input.requestLock();
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

syncCamera();
syncHud();
if (shot) {
  resetRound();
  runShot(shot);
} else {
  resetRound();
  requestAnimationFrame(frame);
}

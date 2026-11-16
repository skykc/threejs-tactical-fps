// The defenders: four bots that hold the sites, patrol the lanes, react to what
// they see and hear, converge on a planted bomb and defuse it. One bot, one job
// per tick: perceive (staggered), decide, move, shoot. They walk the waypoint
// graph from world.js, so they never cut through a wall, and they shoot with a
// real raycast against the player's hitboxes and the world's cover, with a
// reaction delay and a spread that grows with distance — beatable, but tense.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { WAYPOINTS, EDGES } from './world.js';

const BOT_COUNT = 4;
const BOT_HEALTH = 100;
const WALK_SPEED = 3.1;
const PUSH_SPEED = 4.5;
const EYE_HEIGHT = 1.55;
const VIEW_DIST = 34;
const VIEW_COS = 0.55; // ~113 degrees of vision
const HEAR_DIST = 26;
const REACT_MIN = 0.35;
const REACT_VAR = 0.25;
const SHOT_DAMAGE = 24;
const HEAD_MUL = 2.5;
const DEFUSE_SECONDS = 5;
const BURST_MIN = 3;
const BURST_MAX = 5;

const adjacency = WAYPOINTS.map(() => []);
for (const [a, b] of EDGES) {
  adjacency[a].push(b);
  adjacency[b].push(a);
}

function nearestWaypoint(x, z) {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < WAYPOINTS.length; i += 1) {
    const dx = WAYPOINTS[i].x - x;
    const dz = WAYPOINTS[i].z - z;
    const d = dx * dx + dz * dz;
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

function findPath(from, to) {
  if (from === to) return [to];
  const prev = new Array(WAYPOINTS.length).fill(-1);
  const queue = [from];
  prev[from] = from;
  while (queue.length) {
    const node = queue.shift();
    for (const next of adjacency[node]) {
      if (prev[next] !== -1) continue;
      prev[next] = node;
      if (next === to) {
        const path = [to];
        let at = to;
        while (at !== from) {
          at = prev[at];
          path.unshift(at);
        }
        return path;
      }
      queue.push(next);
    }
  }
  return [to];
}

const tmpDir = new THREE.Vector3();
const tmpTarget = new THREE.Vector3();
const eyePos = new THREE.Vector3();
const raycaster = new THREE.Raycaster();

function buildBotMesh(teamColour) {
  const group = new THREE.Group();
  const vest = new THREE.MeshStandardMaterial({ color: new THREE.Color(teamColour), roughness: 0.75 });
  const dark = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.hairline), roughness: 0.85 });
  const skin = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.ink), roughness: 0.6 });
  const add = (w, h, d, x, y, z, mat) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    group.add(mesh);
    return mesh;
  };
  add(0.16, 0.75, 0.18, -0.12, 0.38, 0, dark); // legs
  add(0.16, 0.75, 0.18, 0.12, 0.38, 0, dark);
  const torso = add(0.56, 0.72, 0.3, 0, 1.12, 0, vest);
  torso.userData.part = 'torso';
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), skin);
  head.position.set(0, 1.62, 0);
  head.castShadow = true;
  head.userData.part = 'head';
  group.add(head);
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.07, 0.05), dark);
  visor.position.set(0, 1.64, 0.14);
  group.add(visor);
  add(0.07, 0.07, 0.6, 0.2, 1.25, 0.25, dark); // rifle, barrel forward
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.2, 0.2),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.accent), transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
  );
  flash.position.set(0.2, 1.28, 0.55);
  flash.visible = false;
  group.add(flash);
  return { group, torso, head, flash };
}

export function createBots(scene, world) {
  const list = [];
  const hitMeshes = [];
  const spawn = world.spawns.defender;
  const anchors = [12, 10, 13, 5]; // A site, A support, B site, mid roam
  let random = Math.random;

  function spawnBot(index) {
    const anchor = anchors[index];
    const { group, torso, head, flash } = buildBotMesh(PALETTE.teal);
    group.position.set(spawn.x + (index - 1.5) * 1.2, 0, spawn.z + (index % 2) * 0.8);
    scene.add(group);
    const bot = {
      index,
      group,
      torso,
      head,
      flash,
      pos: group.position,
      vel: new THREE.Vector3(),
      yaw: Math.PI,
      hp: BOT_HEALTH,
      alive: true,
      state: 'hold',
      anchor,
      path: [],
      pathAt: 0,
      holdAt: WAYPOINTS[anchor],
      lastSeen: null,
      lastSeenAt: -99,
      seen: false,
      reactAt: 0,
      burstLeft: 0,
      fireAt: 0,
      flashAt: 0,
      thinkAt: index * 0.03,
      fall: 0,
      defusing: false,
      investigate: null,
    };
    torso.userData.bot = bot;
    head.userData.bot = bot;
    hitMeshes.push(torso, head);
    list.push(bot);
    return bot;
  }

  for (let i = 0; i < BOT_COUNT; i += 1) spawnBot(i);

  function setPath(bot, destNode) {
    const from = nearestWaypoint(bot.pos.x, bot.pos.z);
    bot.path = findPath(from, destNode);
    bot.pathAt = 0;
  }

  function moveAlongPath(bot, dt, speed, collideMove) {
    if (!bot.path.length) return true;
    const node = WAYPOINTS[bot.path[bot.pathAt]];
    tmpDir.set(node.x - bot.pos.x, 0, node.z - bot.pos.z);
    const dist = tmpDir.length();
    if (dist < 0.35) {
      bot.pathAt += 1;
      if (bot.pathAt >= bot.path.length) {
        bot.path = [];
        return true;
      }
      return false;
    }
    tmpDir.divideScalar(dist);
    bot.vel.set(tmpDir.x * speed, 0, tmpDir.z * speed);
    bot.yaw = Math.atan2(tmpDir.x, tmpDir.z);
    bot.vel.y = -1;
    collideMove(bot.pos, bot.vel, dt, 0.34, 1.72);
    return false;
  }

  function canSee(bot, player, time) {
    if (!player.state.alive) return false;
    const dx = player.state.position.x - bot.pos.x;
    const dz = player.state.position.z - bot.pos.z;
    const distXZ = Math.hypot(dx, dz);
    if (distXZ > VIEW_DIST) return false;
    const fx = Math.sin(bot.yaw);
    const fz = Math.cos(bot.yaw);
    if ((dx * fx + dz * fz) / (distXZ || 1) < VIEW_COS) return false;
    eyePos.set(bot.pos.x, bot.pos.y + EYE_HEIGHT, bot.pos.z);
    tmpTarget.set(player.state.position.x, player.state.position.y + 1.2, player.state.position.z);
    tmpDir.subVectors(tmpTarget, eyePos);
    const dist3 = tmpDir.length();
    tmpDir.divideScalar(dist3 || 1);
    raycaster.set(eyePos, tmpDir);
    raycaster.far = dist3 + 0.5;
    const hits = raycaster.intersectObjects(player.hitboxes.concat(world.shootables), false);
    return hits.length > 0 && hits[0].object.userData.player === true;
  }

  function shootAt(bot, player, time, ctx) {
    if (time < bot.fireAt || bot.burstLeft <= 0) return;
    bot.fireAt = time + 0.12;
    bot.burstLeft -= 1;
    const dist = Math.hypot(player.state.position.x - bot.pos.x, player.state.position.z - bot.pos.z);
    const speed = Math.hypot(player.state.velocity.x, player.state.velocity.z);
    let spread = 0.012 + dist * 0.0011 + Math.min(0.008, speed * 0.0015);
    if (bot.vel.lengthSq() > 1) spread += 0.01;
    tmpTarget.set(player.state.position.x, player.state.position.y + 1.15, player.state.position.z);
    tmpDir.set(tmpTarget.x - bot.pos.x, tmpTarget.y - (bot.pos.y + EYE_HEIGHT), tmpTarget.z - bot.pos.z).normalize();
    tmpDir.x += (random() * 2 - 1) * spread;
    tmpDir.y += (random() * 2 - 1) * spread;
    tmpDir.z += (random() * 2 - 1) * spread;
    tmpDir.normalize();
    eyePos.set(bot.pos.x, bot.pos.y + EYE_HEIGHT, bot.pos.z);
    raycaster.set(eyePos, tmpDir);
    raycaster.far = 45;
    const hits = raycaster.intersectObjects(player.hitboxes.concat(world.shootables), false);
    bot.flash.visible = true;
    bot.flashAt = time + 0.05;
    if (hits.length > 0 && hits[0].object.userData.player === true) {
      const isHead = hits[0].object.userData.part === 'head';
      ctx.damagePlayer(SHOT_DAMAGE * (isHead ? HEAD_MUL : 1), isHead, bot);
    }
  }

  function step(dt, time, ctx) {
    const { player, collideMove, bomb } = ctx;
    // Buy time is safe: bots walk to their anchors but do not see, chase or
    // shoot until the round goes live. (ctx.phase is absent in unit tests,
    // where combat stays on.)
    const combat = !ctx.phase || ctx.phase === 'live';
    for (const bot of list) {
      if (!bot.alive) {
        if (bot.fall < 1) {
          bot.fall = Math.min(1, bot.fall + dt / 0.4);
          bot.group.rotation.x = -bot.fall * 1.5;
        }
        continue;
      }
      if (time > bot.flashAt) bot.flash.visible = false;
      bot.defusing = false;

      // Perception, staggered so four raycasts never land on the same tick.
      if (time >= bot.thinkAt) {
        bot.thinkAt = time + 0.12;
        const seen = combat && canSee(bot, player, time);
        if (seen && !bot.seen) bot.reactAt = time + REACT_MIN + random() * REACT_VAR;
        if (seen) {
          bot.seen = true;
          bot.lastSeen = { x: player.state.position.x, z: player.state.position.z };
          bot.lastSeenAt = time;
          if (bot.state !== 'chase' && bot.state !== 'defuse') bot.state = 'chase';
        } else if (bot.seen && time - bot.lastSeenAt > 4) {
          bot.seen = false;
          bot.state = 'patrol';
          setPath(bot, bot.anchor);
        }
      }

      // Bomb planted: converge on the site; the closest bot defuses.
      if (bomb.planted && bot.state !== 'chase') {
        const siteNode = bomb.site === 'A' ? 12 : 13;
        if (bot.state !== 'push' && bot.state !== 'defuse') {
          bot.state = 'push';
          setPath(bot, siteNode);
        }
      }

      if (bot.state === 'hold') {
        bot.yaw += Math.sin(time * 0.5 + bot.index * 1.7) * dt * 0.25;
        if (bot.investigate) {
          bot.state = 'patrol';
          setPath(bot, nearestWaypoint(bot.investigate.x, bot.investigate.z));
        }
      } else if (bot.state === 'patrol' || bot.state === 'push') {
        const arrived = moveAlongPath(bot, dt, bot.state === 'push' ? PUSH_SPEED : WALK_SPEED, collideMove);
        if (arrived) {
          if (bot.state === 'push') {
            const site = world.sites[bomb.site];
            const dx = bot.pos.x - site.centre.x;
            const dz = bot.pos.z - site.centre.z;
            if (Math.hypot(dx, dz) < 1.6) bot.state = 'defuse';
            else {
              bot.state = 'hold';
              bot.holdAt = { x: bot.pos.x, z: bot.pos.z };
            }
          } else if (bot.investigate) {
            bot.investigate = null;
            bot.state = 'hold';
            bot.holdAt = { x: bot.pos.x, z: bot.pos.z };
          } else if (bot.anchor === 5) {
            // The mid roamer keeps walking between mid centre and mid north.
            const next = bot.patrolTarget === 7 ? 5 : 7;
            bot.patrolTarget = next;
            setPath(bot, next);
          } else {
            bot.state = 'hold';
            bot.holdAt = { x: bot.pos.x, z: bot.pos.z };
          }
        }
      } else if (bot.state === 'chase') {
        if (combat && bot.seen && time >= bot.reactAt) {
          // Face the player and fire in bursts while holding ground.
          tmpDir.set(player.state.position.x - bot.pos.x, 0, player.state.position.z - bot.pos.z);
          bot.yaw = Math.atan2(tmpDir.x, tmpDir.z);
          if (bot.burstLeft <= 0 && time >= bot.fireAt) {
            bot.burstLeft = BURST_MIN + Math.floor(random() * (BURST_MAX - BURST_MIN + 1));
            bot.fireAt = time + 0.15;
          }
          shootAt(bot, player, time, ctx);
        } else if (bot.lastSeen) {
          const arrived = moveAlongPath(bot, dt, PUSH_SPEED, collideMove);
          if (arrived) {
            bot.lastSeen = null;
            bot.state = 'patrol';
            setPath(bot, bot.anchor);
          } else if (bot.path.length === 0) {
            setPath(bot, nearestWaypoint(bot.lastSeen.x, bot.lastSeen.z));
          }
        }
      } else if (bot.state === 'defuse') {
        const site = world.sites[bomb.site];
        tmpDir.set(site.centre.x - bot.pos.x, 0, site.centre.z - bot.pos.z);
        bot.yaw = Math.atan2(tmpDir.x, tmpDir.z);
        bot.defusing = true;
        bomb.defuseProgress += dt / DEFUSE_SECONDS;
      }

      bot.group.rotation.y = bot.yaw;
      if (bot.state === 'hold') bot.group.position.y = 0;
    }
  }

  function hearShot(pos) {
    for (const bot of list) {
      if (!bot.alive || bot.seen) continue;
      const d = Math.hypot(bot.pos.x - pos.x, bot.pos.z - pos.z);
      if (d < HEAR_DIST) bot.investigate = { x: pos.x, z: pos.z };
    }
  }

  function damage(bot, amount) {
    if (!bot.alive) return false;
    bot.hp -= amount;
    if (bot.hp > 0) return false;
    bot.hp = 0;
    bot.alive = false;
    bot.defusing = false;
    return true;
  }

  function reset(seedRandom) {
    random = seedRandom;
    for (let i = 0; i < list.length; i += 1) {
      const bot = list[i];
      bot.group.position.set(spawn.x + (i - 1.5) * 1.2, 0, spawn.z + (i % 2) * 0.8);
      bot.group.rotation.set(0, Math.PI, 0);
      bot.vel.set(0, 0, 0);
      bot.yaw = Math.PI;
      bot.hp = BOT_HEALTH;
      bot.alive = true;
      bot.state = 'patrol';
      bot.anchor = anchors[i];
      bot.patrolTarget = anchors[i];
      bot.path = [];
      bot.pathAt = 0;
      bot.holdAt = WAYPOINTS[anchors[i]];
      bot.lastSeen = null;
      bot.lastSeenAt = -99;
      bot.seen = false;
      bot.reactAt = 0;
      bot.burstLeft = 0;
      bot.fireAt = 0;
      bot.flash.visible = false;
      bot.fall = 0;
      bot.defusing = false;
      bot.investigate = null;
      setPath(bot, bot.anchor);
    }
  }

  return {
    list,
    hitMeshes,
    step,
    hearShot,
    damage,
    reset,
    aliveCount() {
      return list.filter((bot) => bot.alive).length;
    },
  };
}

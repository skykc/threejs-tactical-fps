// Depot 9: an original industrial depot map. Two bombsites (A west, B east), three
// north-south lanes split by two long interior walls, a south plaza where attackers
// spawn and a north plaza where defenders spawn. Every box is a collider for the
// player and the bots and a surface a bullet stops on. Plain geometry only, no
// models, no textures loaded from files; the site letters are drawn on a canvas
// at runtime. The world also owns collision: player.js and bots.js both move
// through collideMove, so the axis-separated AABB solve lives in exactly one place.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// Waypoint graph the bots walk on. Nodes are open floor; edges are straight walks
// that cross no wall. BFS over this graph is the bots' whole pathfinding.
export const WAYPOINTS = [
  { x: 0, z: 11.5 }, // 0 attacker spawn
  { x: 0, z: 8 }, // 1 south mid
  { x: -10, z: 8 }, // 2 south west
  { x: 10, z: 8 }, // 3 south east
  { x: -6, z: 0 }, // 4 mid connector west
  { x: 0, z: 0 }, // 5 mid centre
  { x: 6, z: 0 }, // 6 mid connector east
  { x: 0, z: -6 }, // 7 mid north
  { x: -10, z: 0 }, // 8 west mid
  { x: 10, z: 0 }, // 9 east mid
  { x: -10, z: -6 }, // 10 west north
  { x: 10, z: -6 }, // 11 east north
  { x: -15.5, z: -9.5 }, // 12 site A
  { x: 15.5, z: -9.5 }, // 13 site B
  { x: 0, z: -11.5 }, // 14 defender spawn
  { x: -10, z: 4 }, // 15 west south-mid
  { x: 10, z: 4 }, // 16 east south-mid
  { x: 0, z: 4 }, // 17 mid south
];

export const EDGES = [
  [0, 1], [0, 2], [0, 3], [1, 2], [1, 3], [1, 17], [2, 15], [3, 16],
  [17, 5], [15, 8], [16, 9], [5, 4], [5, 6], [5, 7], [4, 8], [6, 9],
  [8, 10], [9, 11], [10, 12], [11, 13], [7, 14], [10, 14], [11, 14],
  [12, 14], [13, 14],
];

export const SITES = {
  A: { minX: -19, maxX: -12, minZ: -13, maxZ: -6, centre: { x: -15.5, z: -9.5 }, colour: 'accent' },
  B: { minX: 12, maxX: 19, minZ: -13, maxZ: -6, centre: { x: 15.5, z: -9.5 }, colour: 'teal' },
};

export const SPAWNS = {
  attacker: { x: 0, z: 11.5, yaw: 0 },
  defender: { x: 0, z: -11.5, yaw: Math.PI },
};

const probe = new THREE.Box3();

export function createWorld(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const materials = {};
  for (const name of Object.keys(PALETTE)) {
    materials[name] = new THREE.MeshStandardMaterial({
      color: new THREE.Color(PALETTE[name]),
      roughness: name === 'accent' ? 0.5 : 0.9,
      metalness: name === 'hairline' || name === 'surface' ? 0.12 : 0.03,
    });
  }

  const colliders = [];
  const shootables = [];

  function box(width, height, depth, x, y, z, material) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), materials[material]);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
    colliders.push(new THREE.Box3().setFromObject(mesh));
    shootables.push(mesh);
    return mesh;
  }

  // Floor and the perimeter wall, 41 x 29 m, 5 m high, open to the dusk sky.
  box(41.4, 0.4, 29.4, 0, -0.2, 0, 'surface');
  box(0.4, 5, 29.4, -20.7, 2.5, 0, 'surface');
  box(0.4, 5, 29.4, 20.7, 2.5, 0, 'surface');
  box(41.4, 5, 0.4, 0, 2.5, -14.7, 'surface');
  box(41.4, 5, 0.4, 0, 2.5, 14.7, 'surface');

  // Two long interior walls split the depot into west, mid and east lanes. Each has
  // a gap at z in [-1, 1]: the mid connector. Lanes meet again in the plazas.
  for (const x of [-6, 6]) {
    box(0.4, 3.4, 7, x, 1.7, -4.5, 'hairline');
    box(0.4, 3.4, 7, x, 1.7, 4.5, 'hairline');
  }

  // Shipping containers: the big sightline breakers on each lane.
  box(5, 2.6, 2.2, -15, 1.3, -4.5, 'rust');
  box(5, 2.6, 2.2, 15, 1.3, -4.5, 'rust');
  box(2.2, 2.6, 5, -10, 1.3, 6.5, 'teal');
  box(2.2, 2.6, 5, 10, 1.3, 6.5, 'teal');

  // Crates and pillars: crouch cover in mid, the plazas and both sites.
  box(1.4, 1.4, 1.4, -1.6, 0.7, -2.2, 'sand');
  box(1.2, 1.2, 1.2, 1.8, 0.6, 2.4, 'sand');
  box(2, 1.1, 1.2, 0, 0.55, 5.6, 'sand');
  box(1.6, 1.6, 1.6, -6, 0.8, 8.5, 'sand');
  box(1.6, 1.6, 1.6, 6, 0.8, 8.5, 'sand');
  box(2.4, 0.9, 1.2, -3, 0.45, 10, 'sand');
  box(2.4, 0.9, 1.2, 3, 0.45, 10, 'sand');
  box(1.6, 1.6, 1.6, -6, 0.8, -9.5, 'sand');
  box(1.6, 1.6, 1.6, 6, 0.8, -9.5, 'sand');
  box(1.4, 1.4, 1.4, -17.5, 0.7, -8, 'sand');
  box(1.2, 1.1, 1.2, -13, 0.55, -11.5, 'sand');
  box(1, 3.4, 1, -15.5, 1.7, -6.8, 'hairline');
  box(1.4, 1.4, 1.4, 17.5, 0.7, -8, 'sand');
  box(1.2, 1.1, 1.2, 13, 0.55, -11.5, 'sand');
  box(1, 3.4, 1, 15.5, 1.7, -6.8, 'hairline');
  // Sandbag lines: low cover you shoot over standing, hide behind crouched.
  box(3, 1.05, 0.8, -12, 0.52, 2, 'hairline');
  box(3, 1.05, 0.8, 12, 0.52, 2, 'hairline');
  box(3, 1.05, 0.8, 0, 0.52, -9.5, 'hairline');

  // Bombsite plates and hanging letter signs (canvas texture, drawn at runtime).
  const sitePlates = {};
  for (const [name, site] of Object.entries(SITES)) {
    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(site.maxX - site.minX, 0.06, site.maxZ - site.minZ),
      new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE[site.colour]), roughness: 0.7, transparent: true, opacity: 0.35 }),
    );
    plate.position.set((site.minX + site.maxX) / 2, 0.03, (site.minZ + site.maxZ) / 2);
    plate.receiveShadow = true;
    group.add(plate);
    sitePlates[name] = plate;

    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = PALETTE[site.colour];
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = '#15181d';
    ctx.font = 'bold 84px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, 64, 70);
    const texture = new THREE.CanvasTexture(canvas);
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(1.6, 1.6),
      new THREE.MeshBasicMaterial({ map: texture, transparent: true, side: THREE.DoubleSide }),
    );
    sign.position.set(site.centre.x, 3.6, site.minZ + 0.3);
    group.add(sign);
  }

  // Light: a low amber sun from the south-east, a cool sky fill, and one floodlight
  // over each site so the objective reads at a glance.
  const sky = new THREE.HemisphereLight(new THREE.Color('#8fa3b8'), new THREE.Color('#1a1d22'), 0.9);
  scene.add(sky);

  const sun = new THREE.DirectionalLight(new THREE.Color('#ffb26b'), 2.4);
  sun.position.set(14, 18, 16);
  sun.target.position.set(0, 0, -4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -24;
  sun.shadow.camera.right = 24;
  sun.shadow.camera.top = 24;
  sun.shadow.camera.bottom = -24;
  sun.shadow.camera.far = 60;
  sun.shadow.bias = -0.0006;
  scene.add(sun, sun.target);

  const fill = new THREE.DirectionalLight(new THREE.Color('#5f7488'), 0.5);
  fill.position.set(-10, 12, -12);
  scene.add(fill);

  for (const [name, site] of Object.entries(SITES)) {
    const lamp = new THREE.PointLight(new THREE.Color(PALETTE[site.colour]), 14, 14, 1.8);
    lamp.position.set(site.centre.x, 4.2, site.centre.z);
    scene.add(lamp);
  }

  // Axis-separated AABB move. pos is the feet, vel is mutated (zeroed on the axis
  // that hit), and the return is whether the body stands on something. The lift
  // keeps the feet and the crown out of the horizontal tests, so standing on the
  // floor is never read as walking into a wall. One shared probe Box3: no new
  // objects per call.
  function overlaps(x, y, z, radius, height, lift) {
    probe.min.set(x - radius, y + lift, z - radius);
    probe.max.set(x + radius, y + height - lift, z + radius);
    for (const collider of colliders) if (probe.intersectsBox(collider)) return collider;
    return null;
  }

  function collideMove(pos, vel, dt, radius, height) {
    const nextX = pos.x + vel.x * dt;
    if (!overlaps(nextX, pos.y, pos.z, radius, height, 0.04)) pos.x = nextX;
    else vel.x = 0;
    const nextZ = pos.z + vel.z * dt;
    if (!overlaps(pos.x, pos.y, nextZ, radius, height, 0.04)) pos.z = nextZ;
    else vel.z = 0;
    pos.y += vel.y * dt;
    let grounded = false;
    const hit = overlaps(pos.x, pos.y, pos.z, radius, height, 0);
    if (hit) {
      if (vel.y <= 0) {
        pos.y = hit.max.y;
        vel.y = 0;
        grounded = true;
      } else {
        pos.y = hit.min.y - height;
        vel.y = 0;
      }
    }
    if (pos.y < 0) {
      pos.y = 0;
      vel.y = 0;
      grounded = true;
    }
    return grounded;
  }

  function insideSite(x, z) {
    for (const [name, site] of Object.entries(SITES)) {
      if (x >= site.minX && x <= site.maxX && z >= site.minZ && z <= site.maxZ) return name;
    }
    return null;
  }

  return { colliders, shootables, sites: SITES, sitePlates, spawns: SPAWNS, waypoints: WAYPOINTS, edges: EDGES, collideMove, insideSite, group };
}

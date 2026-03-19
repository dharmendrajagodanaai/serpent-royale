import * as THREE from 'three';
import { getTerrainHeight } from './terrain.js';

const MAX_ORBS = 500;
const ORBS_AT_START = 60;
const ORB_COLLECT_DIST = 1.8;
const ORB_COLLECT_DIST_BOOST = 2.5; // wider sweep when boosting at speed
const ORB_RADIUS = 0.22;

// Returns squared distance from point (px,pz) to segment (ax,az)→(bx,bz)
function pointToSegDistSq(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az;
  const lenSq = dx * dx + dz * dz;
  if (lenSq < 0.0001) {
    const ex = px - ax, ez = pz - az;
    return ex * ex + ez * ez;
  }
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / lenSq));
  const cx = ax + t * dx, cz = az + t * dz;
  const ex = px - cx, ez = pz - cz;
  return ex * ex + ez * ez;
}

export class OrbManager {
  constructor(scene) {
    this.scene = scene;
    this.orbs = []; // { x, z, y, alive, bobOffset }
    this._freeSlots = [];
    this._dummy = new THREE.Object3D();
    this._col = new THREE.Color();
    this._time = 0;

    this._buildMesh();
  }

  _buildMesh() {
    const geo = new THREE.SphereGeometry(ORB_RADIUS, 6, 5);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0x44ff88,
      emissiveIntensity: 1.8,
      roughness: 0.1, metalness: 0.3
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX_ORBS);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false; // instances span entire map; prevent culling based on local bounding sphere
    this.mesh.count = 0;
    this.scene.add(this.mesh);

    // Initialize instance colors buffer
    const colors = new Float32Array(MAX_ORBS * 3);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(colors, 3);
  }

  init() {
    // Scatter orbs across arena
    for (let i = 0; i < ORBS_AT_START; i++) {
      this._spawnRandom();
    }
  }

  _spawnRandom() {
    // Random position inside arena (circle r=95)
    const angle = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * 90;
    const x = Math.cos(angle) * r;
    const z = Math.sin(angle) * r;
    this._addOrb(x, z, 0x44ff88);
  }

  _addOrb(x, z, color = 0x44ff88) {
    if (this.orbs.length >= MAX_ORBS) return -1;
    const y = getTerrainHeight(x, z);
    const idx = this.orbs.length;
    this.orbs.push({ x, z, y, alive: true, bobOffset: Math.random() * Math.PI * 2, color });
    return idx;
  }

  // Drop a boost orb at a given position (called when snake drains length while boosting)
  spawnBoostOrb(x, z) {
    const spread = 0.4;
    this._addOrb(
      x + (Math.random() - 0.5) * spread,
      z + (Math.random() - 0.5) * spread,
      0xffaa22  // golden-orange color to distinguish from normal orbs
    );
  }

  // Called when a serpent dies — scatter orbs along entire body path
  scatter(serpent) {
    const segs = serpent.path.segmentPositions;
    if (!segs || segs.length === 0 || serpent.segmentCount === 0) return;
    const count = Math.min(serpent.segmentCount, segs.length);
    for (let i = 0; i < count; i++) {
      const seg = segs[i];
      if (!seg) continue;
      // Drop 2 orbs near the head half, 1 toward the tail
      const orbsHere = i < count * 0.6 ? 2 : 1;
      for (let k = 0; k < orbsHere; k++) {
        const spreadX = seg.x + (Math.random() - 0.5) * 3.5;
        const spreadZ = seg.z + (Math.random() - 0.5) * 3.5;
        this._addOrb(spreadX, spreadZ, 0xff6644);
      }
    }
    // Keep total under MAX_ORBS
    while (this.orbs.length > MAX_ORBS) this.orbs.shift();
  }

  // Swept-sphere orb collection — checks movement segment to avoid tunneling at high speed
  checkCollection(serpents) {
    const events = [];
    for (const s of serpents) {
      if (!s.alive) continue;
      const collectDist = s.boosting ? ORB_COLLECT_DIST_BOOST : ORB_COLLECT_DIST;
      const distSq = collectDist * collectDist;
      // Previous head position for sweep (falls back to current pos on first frame)
      const prevX = s.prevHeadX ?? s.headPos.x;
      const prevZ = s.prevHeadZ ?? s.headPos.z;

      for (let i = this.orbs.length - 1; i >= 0; i--) {
        const orb = this.orbs[i];
        if (!orb.alive) continue;

        // Vacuum pull: orbs within 3 units drift toward head
        const hdx = s.headPos.x - orb.x;
        const hdz = s.headPos.z - orb.z;
        const hd2 = hdx * hdx + hdz * hdz;
        if (hd2 < 9 && hd2 > 0.01) {
          const hd = Math.sqrt(hd2);
          const pull = 0.07 * (1 - hd / 3);
          orb.x += (hdx / hd) * pull;
          orb.z += (hdz / hd) * pull;
        }

        // Swept check: distance from orb center to head movement segment
        const d2 = pointToSegDistSq(orb.x, orb.z, prevX, prevZ, s.headPos.x, s.headPos.z);
        if (d2 < distSq) {
          orb.alive = false;
          events.push({ serpent: s, orbColor: orb.color });
          // Respawn a new orb
          if (Math.random() < 0.7) this._spawnRandom();
        }
      }
    }
    // Compact dead orbs
    this.orbs = this.orbs.filter(o => o.alive);
    return events;
  }

  findNearest(x, z, maxDist = Infinity) {
    let best = null, bestD2 = maxDist * maxDist;
    for (const orb of this.orbs) {
      if (!orb.alive) continue;
      const dx = orb.x - x, dz = orb.z - z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) { bestD2 = d2; best = orb; }
    }
    return best;
  }

  update(time) {
    this._time = time;
    const dummy = this._dummy;
    const mesh = this.mesh;
    const col = this._col;
    let idx = 0;

    for (const orb of this.orbs) {
      if (!orb.alive) continue;
      // Bobbing + pulsing animation for vibrant glow effect
      const yOff = Math.sin(time * 2.0 + orb.bobOffset) * 0.15;
      const pulse = 0.85 + Math.sin(time * 3.5 + orb.bobOffset) * 0.15;
      dummy.position.set(orb.x, orb.y + 0.35 + yOff, orb.z);
      dummy.scale.setScalar(pulse);
      dummy.updateMatrix();
      mesh.setMatrixAt(idx, dummy.matrix);
      col.set(orb.color);
      mesh.setColorAt(idx, col);
      idx++;
    }
    mesh.count = idx;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
}

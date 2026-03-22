import * as THREE from 'three';
import { getTerrainHeight } from './terrain.js';

const MAX_ORBS = 500;
const ORBS_AT_START = 60;
const ORB_COLLECT_DIST = 1.4;
const ORB_RADIUS = 0.22;

const CHASE_ORB_COUNT = 10;
const CHASE_ORB_FLEE_RADIUS = 15;
const CHASE_ORB_SPEED = 5;
const CHASE_ORB_RADIUS = 0.55;
const CHASE_ORB_COLLECT_DIST = 1.6;
const CHASE_ORB_MASS = 3;
const CHASE_ORB_COLOR = 0x00ffaa;

export class OrbManager {
  constructor(scene) {
    this.scene = scene;
    this.orbs = []; // { x, z, y, alive, bobOffset }
    this.chaseOrbs = []; // { x, z, vx, vz, alive }
    this._freeSlots = [];
    this._dummy = new THREE.Object3D();
    this._col = new THREE.Color();
    this._time = 0;

    this._buildMesh();
    this._buildChaseMesh();
  }

  _buildMesh() {
    const geo = new THREE.SphereGeometry(ORB_RADIUS, 6, 5);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0x44ff88,
      emissiveIntensity: 1.2,
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

  _buildChaseMesh() {
    const geo = new THREE.SphereGeometry(CHASE_ORB_RADIUS, 8, 6);
    const mat = new THREE.MeshStandardMaterial({
      color: CHASE_ORB_COLOR,
      emissive: CHASE_ORB_COLOR,
      emissiveIntensity: 1.8,
      roughness: 0.1,
      metalness: 0.0,
    });
    this.chaseMesh = new THREE.InstancedMesh(geo, mat, CHASE_ORB_COUNT + 5);
    this.chaseMesh.frustumCulled = false;
    this.chaseMesh.count = 0;
    this.scene.add(this.chaseMesh);
  }

  init() {
    // Scatter orbs across arena
    for (let i = 0; i < ORBS_AT_START; i++) {
      this._spawnRandom();
    }
    // Spawn chase orbs
    this.chaseOrbs = [];
    for (let i = 0; i < CHASE_ORB_COUNT; i++) {
      this._spawnChaseOrb();
    }
  }

  _spawnChaseOrb() {
    const angle = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * 80;
    this.chaseOrbs.push({
      x: Math.cos(angle) * r,
      z: Math.sin(angle) * r,
      vx: 0, vz: 0,
      alive: true,
    });
  }

  _respawnChaseOrb(idx) {
    const angle = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * 80;
    this.chaseOrbs[idx] = {
      x: Math.cos(angle) * r,
      z: Math.sin(angle) * r,
      vx: 0, vz: 0,
      alive: true,
    };
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

  // Called when a serpent dies — scatter segments as orbs
  scatter(serpent) {
    const segs = serpent.path.segmentPositions;
    if (!segs || segs.length === 0 || serpent.segmentCount === 0) return;
    const count = Math.min(serpent.segmentCount, segs.length);
    for (let i = 0; i < count; i++) {
      const seg = segs[i];
      if (!seg) continue;
      const spreadX = seg.x + (Math.random() - 0.5) * 3;
      const spreadZ = seg.z + (Math.random() - 0.5) * 3;
      this._addOrb(spreadX, spreadZ, 0xff6644);
    }
    // Keep total under MAX_ORBS
    while (this.orbs.length > MAX_ORBS) this.orbs.shift();
  }

  // Returns array of { serpent, orbColor, isChase, mass } collected this frame
  checkCollection(serpents) {
    const events = [];
    const cc2 = CHASE_ORB_COLLECT_DIST * CHASE_ORB_COLLECT_DIST;

    for (const s of serpents) {
      if (!s.alive) continue;

      // Regular orbs
      for (let i = this.orbs.length - 1; i >= 0; i--) {
        const orb = this.orbs[i];
        if (!orb.alive) continue;
        const dx = s.headPos.x - orb.x;
        const dz = s.headPos.z - orb.z;
        if (dx * dx + dz * dz < ORB_COLLECT_DIST * ORB_COLLECT_DIST) {
          orb.alive = false;
          events.push({ serpent: s, orbColor: orb.color, isChase: false, mass: 1 });
          if (Math.random() < 0.7) this._spawnRandom();
        }
      }

      // Chase orbs
      for (let i = 0; i < this.chaseOrbs.length; i++) {
        const orb = this.chaseOrbs[i];
        if (!orb.alive) continue;
        const dx = s.headPos.x - orb.x;
        const dz = s.headPos.z - orb.z;
        if (dx * dx + dz * dz < cc2) {
          orb.alive = false;
          events.push({ serpent: s, orbColor: CHASE_ORB_COLOR, isChase: true, mass: CHASE_ORB_MASS });
          const capturedIdx = i;
          setTimeout(() => this._respawnChaseOrb(capturedIdx), 10000);
        }
      }
    }

    // Compact dead orbs
    this.orbs = this.orbs.filter(o => o.alive);
    return events;
  }

  // Find nearest orb of any type (regular or chase)
  findNearest(x, z, maxDist = Infinity) {
    let best = null, bestD2 = maxDist * maxDist;
    for (const orb of this.orbs) {
      if (!orb.alive) continue;
      const dx = orb.x - x, dz = orb.z - z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) { bestD2 = d2; best = orb; }
    }
    // Check chase orbs too (3x mass — worth pursuing)
    for (const orb of this.chaseOrbs) {
      if (!orb.alive) continue;
      const dx = orb.x - x, dz = orb.z - z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) { bestD2 = d2; best = orb; }
    }
    return best;
  }

  update(time, serpents) {
    this._time = time;
    const dummy = this._dummy;
    const mesh = this.mesh;
    const col = this._col;
    let idx = 0;

    for (const orb of this.orbs) {
      if (!orb.alive) continue;
      const yOff = Math.sin(time * 2.0 + orb.bobOffset) * 0.15;
      dummy.position.set(orb.x, orb.y + 0.35 + yOff, orb.z);
      dummy.scale.setScalar(1.0);
      dummy.updateMatrix();
      mesh.setMatrixAt(idx, dummy.matrix);
      col.set(orb.color);
      mesh.setColorAt(idx, col);
      idx++;
    }
    mesh.count = idx;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

    // ── Chase orb physics ──
    if (serpents) {
      const dt = 1 / 60; // approximate dt — chase orbs use globalTime so no real dt available
      for (const o of this.chaseOrbs) {
        if (!o.alive) continue;
        let fleeX = 0, fleeZ = 0, nearestDist = Infinity;
        for (const s of serpents) {
          if (!s.alive) continue;
          const dx = o.x - s.headPos.x;
          const dz = o.z - s.headPos.z;
          const d = Math.sqrt(dx * dx + dz * dz);
          if (d < CHASE_ORB_FLEE_RADIUS && d < nearestDist && d > 0.01) {
            nearestDist = d;
            fleeX = dx / d;
            fleeZ = dz / d;
          }
        }
        if (nearestDist < CHASE_ORB_FLEE_RADIUS) {
          const urgency = 1 - nearestDist / CHASE_ORB_FLEE_RADIUS;
          o.vx += fleeX * 30 * urgency * dt;
          o.vz += fleeZ * 30 * urgency * dt;
        }
        // Drag
        o.vx *= Math.max(0, 1 - 2.5 * dt);
        o.vz *= Math.max(0, 1 - 2.5 * dt);
        // Cap speed
        const spd = Math.sqrt(o.vx * o.vx + o.vz * o.vz);
        if (spd > CHASE_ORB_SPEED) {
          o.vx = (o.vx / spd) * CHASE_ORB_SPEED;
          o.vz = (o.vz / spd) * CHASE_ORB_SPEED;
        }
        o.x += o.vx * dt;
        o.z += o.vz * dt;
        // Bounce off arena edge
        const r = Math.sqrt(o.x * o.x + o.z * o.z);
        if (r > 88) {
          const nx = o.x / r, nz = o.z / r;
          o.vx -= nx * 8;
          o.vz -= nz * 8;
          o.x = nx * 85;
          o.z = nz * 85;
        }
      }
    }

    // ── Chase orb rendering ──
    const pulse = 1 + Math.sin(time * 4.5) * 0.22;
    let chIdx = 0;
    for (const o of this.chaseOrbs) {
      if (!o.alive) continue;
      dummy.position.set(o.x, getTerrainHeight(o.x, o.z) + 0.55 + Math.sin(time * 3.5 + o.x) * 0.15, o.z);
      dummy.rotation.y = time * 2.5;
      dummy.scale.setScalar(pulse);
      dummy.updateMatrix();
      this.chaseMesh.setMatrixAt(chIdx, dummy.matrix);
      chIdx++;
    }
    this.chaseMesh.count = chIdx;
    this.chaseMesh.instanceMatrix.needsUpdate = true;
  }
}

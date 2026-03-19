import * as THREE from 'three';
import { getTerrainHeight } from './terrain.js';

const MAX_ORBS = 500;
const ORBS_AT_START = 60;
const ORB_COLLECT_DIST = 1.4;
const ORB_RADIUS = 0.22;

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

  // Returns array of serpent indices that collected orbs this frame
  checkCollection(serpents) {
    const events = [];
    for (const s of serpents) {
      if (!s.alive) continue;
      for (let i = this.orbs.length - 1; i >= 0; i--) {
        const orb = this.orbs[i];
        if (!orb.alive) continue;
        const dx = s.headPos.x - orb.x;
        const dz = s.headPos.z - orb.z;
        if (dx * dx + dz * dz < ORB_COLLECT_DIST * ORB_COLLECT_DIST) {
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
      // Bobbing animation
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
  }
}

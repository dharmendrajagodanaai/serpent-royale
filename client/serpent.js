import * as THREE from 'three';
import { getTerrainHeight } from './terrain.js';

export const SERPENT_COLORS = [
  0x00ffcc, // player - cyan
  0xff4444, 0x44ff44, 0x4488ff, 0xff8800, 0xcc44ff, 0xffff00, 0xff44aa,
  0x00ccff, 0xff0088, 0x88ff00, 0xff6600, 0x0088cc, 0xcc8800,
  0xff0000, 0x00ff88, 0x8800cc, 0xffaa00, 0x00ffff, 0xff8844, 0x44aaff,
];

const BOT_NAMES = [
  'Viper', 'Mamba', 'Cobra', 'Python', 'Anaconda', 'Asp', 'Boa',
  'Taipan', 'Adder', 'Krait', 'Rattler', 'Copperhead', 'Bushmaster',
  'Cottonmouth', 'Sidewinder', 'Diamondback', 'Kingsnake', 'Fer-de-Lance',
  'Puff Adder', 'Boomslang',
];

export const TOTAL_SERPENTS = 20; // 1 player + 19 bots
const BASE_SPEED = 6;
const BOOST_SPEED = 12;
const TURN_SPEED = 2.8;
const SEGMENT_SPACING = 0.85;
const START_SEGMENTS = 5;
const MAX_SEGMENTS = 100;
const PATH_MAX = 3000;
const AI_TURN_SPEED = 2.2;
const MAX_TOTAL_SEGS = TOTAL_SERPENTS * MAX_SEGMENTS;

// ─── SerpentPath ────────────────────────────────────────────────────────────

class SerpentPath {
  constructor(startX, startZ, dirX, dirZ) {
    this.positions = []; // oldest first, newest last
    this.headPos = { x: startX, z: startZ };
    this.headDir = { x: dirX, z: dirZ };
    this.segmentSpacing = SEGMENT_SPACING;
    this._distSinceLastPoint = 0;
    this.segmentPositions = []; // cache, updated each frame

    // Seed initial path
    for (let i = 0; i < 60; i++) {
      this.positions.push({ x: startX - dirX * i * 0.3, z: startZ - dirZ * i * 0.3 });
    }
  }

  update(targetDirX, targetDirZ, speed, dt) {
    // Smooth turn
    const currentAngle = Math.atan2(this.headDir.z, this.headDir.x);
    const targetAngle = Math.atan2(targetDirZ, targetDirX);
    let delta = targetAngle - currentAngle;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    const maxTurn = TURN_SPEED * dt;
    const newAngle = currentAngle + Math.sign(delta) * Math.min(Math.abs(delta), maxTurn);
    this.headDir.x = Math.cos(newAngle);
    this.headDir.z = Math.sin(newAngle);

    // Move head
    const step = speed * dt;
    this.headPos.x += this.headDir.x * step;
    this.headPos.z += this.headDir.z * step;

    // Clamp to world bounds
    this.headPos.x = Math.max(-115, Math.min(115, this.headPos.x));
    this.headPos.z = Math.max(-115, Math.min(115, this.headPos.z));

    // Record path points at ~0.4 unit intervals
    this._distSinceLastPoint += step;
    if (this._distSinceLastPoint >= 0.4) {
      this.positions.push({ x: this.headPos.x, z: this.headPos.z });
      if (this.positions.length > PATH_MAX) this.positions.shift();
      this._distSinceLastPoint = 0;
    }
  }

  // Precompute segment positions in a single O(N) pass
  buildSegmentCache(segmentCount) {
    const len = this.positions.length;
    const spacing = this.segmentSpacing;
    const out = this.segmentPositions;

    // Resize
    if (out.length !== segmentCount) {
      out.length = segmentCount;
      for (let i = 0; i < segmentCount; i++) if (!out[i]) out[i] = { x: 0, z: 0 };
    }

    if (len === 0 || segmentCount === 0) return;

    // Segment 0 = head
    out[0].x = this.headPos.x;
    out[0].z = this.headPos.z;

    let segIdx = 1;
    let accumulated = 0;

    for (let i = len - 1; i > 0 && segIdx < segmentCount; i--) {
      const ax = this.positions[i].x, az = this.positions[i].z;
      const bx = this.positions[i - 1].x, bz = this.positions[i - 1].z;
      const dx = bx - ax, dz = bz - az;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < 0.0001) continue;

      const prev = accumulated;
      accumulated += dist;

      while (segIdx < segmentCount && segIdx * spacing <= accumulated) {
        const t = (segIdx * spacing - prev) / dist;
        out[segIdx].x = ax + dx * t;
        out[segIdx].z = az + dz * t;
        segIdx++;
      }
    }

    // Fill remaining with tail
    if (segIdx < segmentCount) {
      const tail = out[segIdx > 0 ? segIdx - 1 : 0];
      for (let s = segIdx; s < segmentCount; s++) {
        out[s].x = tail.x; out[s].z = tail.z;
      }
    }
  }

  trimToLength(segmentCount) {
    // Remove extra path history when length decreases
    const needed = segmentCount * SEGMENT_SPACING / 0.4 + 100;
    if (this.positions.length > needed) {
      this.positions.splice(0, this.positions.length - needed);
    }
  }
}

// ─── SerpentManager ─────────────────────────────────────────────────────────

export class SerpentManager {
  constructor(scene) {
    this.scene = scene;
    this.serpents = [];
    this.playerSerpent = null;
    this.kills = 0;

    this._buildInstancedMesh();
    this._buildHeads();

    this._dummy = new THREE.Object3D();
    this._colorObj = new THREE.Color();

    // Wander noise offsets per bot
    this._botWanderTime = [];
  }

  _buildInstancedMesh() {
    const geo = new THREE.SphereGeometry(0.42, 7, 5);
    const mat = new THREE.MeshStandardMaterial({
      roughness: 0.3, metalness: 0.5,
      emissive: new THREE.Color(0x000000),
    });
    this.bodyMesh = new THREE.InstancedMesh(geo, mat, MAX_TOTAL_SEGS);
    this.bodyMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.bodyMesh.castShadow = false;
    this.bodyMesh.frustumCulled = false; // instances span entire map; prevent Three.js from culling based on tiny local bounding sphere
    this.bodyMesh.count = 0;
    this.scene.add(this.bodyMesh);
  }

  _buildHeads() {
    this.headMeshes = [];
    this.headLights = [];
    const headGeo = new THREE.SphereGeometry(0.55, 10, 8);

    for (let i = 0; i < TOTAL_SERPENTS; i++) {
      const col = new THREE.Color(SERPENT_COLORS[i % SERPENT_COLORS.length]);
      const mat = new THREE.MeshStandardMaterial({
        color: col, emissive: col, emissiveIntensity: 0.6,
        roughness: 0.2, metalness: 0.6
      });
      const mesh = new THREE.Mesh(headGeo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.scene.add(mesh);
      this.headMeshes.push(mesh);

      const light = new THREE.PointLight(SERPENT_COLORS[i % SERPENT_COLORS.length], 1.2, 8);
      light.visible = false;
      this.scene.add(light);
      this.headLights.push(light);
    }
  }

  spawnSerpents(playerIndex = 0) {
    this.serpents = [];
    const count = TOTAL_SERPENTS;
    this._botWanderTime = [];

    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + Math.random() * 0.3;
      const r = 55 + Math.random() * 30;
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;
      const dirAngle = angle + Math.PI; // Face center
      const dirX = Math.cos(dirAngle), dirZ = Math.sin(dirAngle);
      const colorIdx = i % SERPENT_COLORS.length;

      const serpent = {
        id: i,
        isPlayer: i === playerIndex,
        path: new SerpentPath(x, z, dirX, dirZ),
        segmentCount: START_SEGMENTS,
        headPos: { x, z },
        headDir: { x: dirX, z: dirZ },
        color: new THREE.Color(SERPENT_COLORS[colorIdx]),
        alive: true,
        boosting: false,
        boostDrainTimer: 0,
        zoneDamageTimer: 0,
        name: i === playerIndex ? 'YOU' : (BOT_NAMES[i - 1] || `BOT-${i}`),
        kills: 0,
        // AI state
        wanderAngle: Math.random() * Math.PI * 2,
        wanderTimer: 0,
        targetOrb: null,
        aggression: Math.random(), // 0 = defensive, 1 = aggressive
      };

      this.serpents.push(serpent);
      this._botWanderTime.push(Math.random() * 100);

      this.headMeshes[i].visible = true;
      this.headLights[i].visible = true;
    }

    this.playerSerpent = this.serpents[playerIndex];
  }

  updatePlayer(dt, targetDirX, targetDirZ, boosting) {
    const s = this.playerSerpent;
    if (!s || !s.alive) return;

    const canBoost = boosting && s.segmentCount > 3;
    s.boosting = canBoost;
    const speed = canBoost ? BOOST_SPEED : BASE_SPEED;

    s.path.update(targetDirX, targetDirZ, speed, dt);
    s.headPos.x = s.path.headPos.x;
    s.headPos.z = s.path.headPos.z;
    s.headDir.x = s.path.headDir.x;
    s.headDir.z = s.path.headDir.z;

    if (canBoost) {
      s.boostDrainTimer += dt;
      if (s.boostDrainTimer >= 1.0) {
        s.segmentCount = Math.max(3, s.segmentCount - 1);
        s.boostDrainTimer -= 1.0;
        s.path.trimToLength(s.segmentCount);
      }
    } else {
      s.boostDrainTimer = 0;
    }
  }

  updateBots(dt, orbManager, zoneManager) {
    for (let i = 0; i < this.serpents.length; i++) {
      const s = this.serpents[i];
      if (s.isPlayer || !s.alive) continue;

      this._botWanderTime[i] += dt;

      let targetX = s.headDir.x;
      let targetZ = s.headDir.z;
      let wantsBoost = false;

      // ── Flee from much-larger threats (scales with player size) ──
      let fleeing = false;
      for (const threat of this.serpents) {
        if (threat === s || !threat.alive) continue;
        const sizeRatio = threat.segmentCount / Math.max(1, s.segmentCount);
        if (sizeRatio < 1.4) continue; // only flee from clearly bigger
        const dx = s.headPos.x - threat.headPos.x;
        const dz = s.headPos.z - threat.headPos.z;
        const d2 = dx * dx + dz * dz;
        const fleeR = 12 + s.segmentCount * 0.2;
        if (d2 < fleeR * fleeR) {
          const d = Math.sqrt(d2) + 0.001;
          targetX = dx / d;
          targetZ = dz / d;
          wantsBoost = true; // boost to escape
          fleeing = true;
          break;
        }
      }

      // ── Aggressive: large bots cut off or chase smaller serpents ──
      if (!fleeing && s.aggression > 0.5 && s.segmentCount > 18) {
        let bestTarget = null, bestDist = 22;
        for (const target of this.serpents) {
          if (target === s || !target.alive) continue;
          if (target.segmentCount >= s.segmentCount * 0.9) continue; // only chase smaller
          const dx = target.headPos.x - s.headPos.x;
          const dz = target.headPos.z - s.headPos.z;
          const d = Math.sqrt(dx * dx + dz * dz);
          if (d < bestDist) { bestDist = d; bestTarget = target; }
        }
        if (bestTarget) {
          // Intercept: aim ahead of target
          const ahead = 8 + s.segmentCount * 0.2;
          const ix = bestTarget.headPos.x + bestTarget.headDir.x * ahead;
          const iz = bestTarget.headPos.z + bestTarget.headDir.z * ahead;
          const dx = ix - s.headPos.x, dz = iz - s.headPos.z;
          const d = Math.sqrt(dx * dx + dz * dz) + 0.001;
          targetX = dx / d; targetZ = dz / d;
          wantsBoost = bestDist < 14 && s.aggression > 0.65;
        }
      }

      // Find nearest orb (include chase orbs)
      let orbWeight = 0;
      if (!fleeing && orbManager) {
        const nearestOrb = orbManager.findNearest(s.headPos.x, s.headPos.z, 40);
        if (nearestOrb) {
          const dx = nearestOrb.x - s.headPos.x;
          const dz = nearestOrb.z - s.headPos.z;
          const d = Math.sqrt(dx * dx + dz * dz);
          targetX = dx / d; targetZ = dz / d;
          orbWeight = Math.max(0, 1 - d / 40);
        }
      }

      // Wander component
      s.wanderTimer -= dt;
      if (s.wanderTimer <= 0) {
        s.wanderAngle = Math.atan2(s.headDir.z, s.headDir.x) + (Math.random() - 0.5) * 2.0;
        s.wanderTimer = 0.5 + Math.random() * 0.7;
      }
      const wx = Math.cos(s.wanderAngle);
      const wz = Math.sin(s.wanderAngle);

      // Blend orb-seek and wander
      let blendX = fleeing ? targetX : wx * (1 - orbWeight) + targetX * orbWeight;
      let blendZ = fleeing ? targetZ : wz * (1 - orbWeight) + targetZ * orbWeight;

      // Zone avoidance
      if (zoneManager) {
        const r = Math.sqrt(s.headPos.x * s.headPos.x + s.headPos.z * s.headPos.z);
        const zr = zoneManager.currentSize * 0.5;
        if (r > zr * 0.75) {
          const weight = Math.min(1, (r - zr * 0.75) / (zr * 0.25));
          const cx = -s.headPos.x / (r + 0.001);
          const cz = -s.headPos.z / (r + 0.001);
          blendX = blendX * (1 - weight * 0.8) + cx * weight * 0.8;
          blendZ = blendZ * (1 - weight * 0.8) + cz * weight * 0.8;
          if (weight > 0.5) wantsBoost = true;
        }
      }

      // Body collision avoidance — steer away from nearby serpent segments
      if (!fleeing) {
        let avoidX = 0, avoidZ = 0;
        for (const other of this.serpents) {
          if (!other.alive) continue;
          const segs = other.path.segmentPositions;
          if (!segs || segs.length === 0) continue;
          const startSeg = other === s ? 4 : 0;
          const checkCount = Math.min(other.segmentCount, 12);
          for (let si = startSeg; si < checkCount; si++) {
            const seg = segs[si];
            if (!seg) continue;
            const adx = s.headPos.x - seg.x;
            const adz = s.headPos.z - seg.z;
            const d2 = adx * adx + adz * adz;
            if (d2 < 16 && d2 > 0.01) {
              const d = Math.sqrt(d2);
              const w = 1 - d / 4;
              avoidX += (adx / d) * w;
              avoidZ += (adz / d) * w;
            }
          }
        }
        if (avoidX !== 0 || avoidZ !== 0) {
          const avoidMag = Math.sqrt(avoidX * avoidX + avoidZ * avoidZ);
          if (avoidMag > 0.001) {
            const anx = avoidX / avoidMag, anz = avoidZ / avoidMag;
            const strength = Math.min(1, avoidMag * 0.35) * 0.65;
            blendX = blendX * (1 - strength) + anx * strength;
            blendZ = blendZ * (1 - strength) + anz * strength;
          }
        }
      }

      // Normalize
      const blen = Math.sqrt(blendX * blendX + blendZ * blendZ);
      if (blen > 0.001) { blendX /= blen; blendZ /= blen; }

      // Smooth turn (bots turn slower)
      const curAngle = Math.atan2(s.headDir.z, s.headDir.x);
      const tgtAngle = Math.atan2(blendZ, blendX);
      let da = tgtAngle - curAngle;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      const maxT = AI_TURN_SPEED * dt;
      const newAngle = curAngle + Math.sign(da) * Math.min(Math.abs(da), maxT);
      s.headDir.x = Math.cos(newAngle);
      s.headDir.z = Math.sin(newAngle);

      // Apply boost with segment drain
      const canBoost = wantsBoost && s.segmentCount > 5;
      s.boosting = canBoost;
      const speed = canBoost ? BOOST_SPEED : BASE_SPEED;
      if (canBoost) {
        s.boostDrainTimer += dt;
        if (s.boostDrainTimer >= 1.5) { // bots drain slower than player
          s.segmentCount = Math.max(3, s.segmentCount - 1);
          s.boostDrainTimer -= 1.5;
          s.path.trimToLength(s.segmentCount);
        }
      } else {
        s.boostDrainTimer = 0;
      }

      s.path.update(s.headDir.x, s.headDir.z, speed, dt);
      s.headPos.x = s.path.headPos.x;
      s.headPos.z = s.path.headPos.z;
      s.headDir.x = s.path.headDir.x;
      s.headDir.z = s.path.headDir.z;
    }
  }

  killSerpent(serpent) {
    serpent.alive = false;
    const idx = serpent.id;
    this.headMeshes[idx].visible = false;
    this.headLights[idx].visible = false;
  }

  growSerpent(serpent, amount = 1) {
    serpent.segmentCount = Math.min(MAX_SEGMENTS, serpent.segmentCount + amount);
  }

  applyZoneDamage(serpent, dt) {
    serpent.zoneDamageTimer += dt;
    if (serpent.zoneDamageTimer >= 1.0) {
      serpent.zoneDamageTimer -= 1.0;
      serpent.segmentCount = Math.max(1, serpent.segmentCount - 1);
      if (serpent.segmentCount <= 1) return true; // signal death
    }
    return false;
  }

  get aliveCount() {
    return this.serpents.filter(s => s.alive).length;
  }

  // Update all InstancedMesh and head meshes
  render() {
    const dummy = this._dummy;
    let instanceIdx = 0;

    for (const s of this.serpents) {
      if (!s.alive) continue;

      // Build segment cache
      s.path.buildSegmentCache(s.segmentCount);
      const segs = s.path.segmentPositions;

      // Update head mesh
      const hm = this.headMeshes[s.id];
      const hl = this.headLights[s.id];
      if (hm.visible) {
        const hy = getTerrainHeight(s.headPos.x, s.headPos.z) + 0.65;
        hm.position.set(s.headPos.x, hy, s.headPos.z);

        // Orient head toward direction
        const angle = Math.atan2(s.headDir.z, s.headDir.x);
        hm.rotation.y = -angle + Math.PI / 2;

        hl.position.set(s.headPos.x, hy + 1, s.headPos.z);

        // Boost pulse
        const ei = s.boosting ? 1.0 : 0.5;
        hm.material.emissiveIntensity = ei;
        hl.intensity = s.boosting ? 2.0 : 1.0;
      }

      // Body segments (skip index 0 = head is separate mesh)
      for (let i = 1; i < s.segmentCount && instanceIdx < MAX_TOTAL_SEGS; i++) {
        const seg = segs[i];
        if (!seg) continue;

        const y = getTerrainHeight(seg.x, seg.z) + 0.45;
        const scale = Math.max(0.5, 1.0 - (i / s.segmentCount) * 0.4);

        dummy.position.set(seg.x, y, seg.z);
        dummy.scale.setScalar(scale * 0.9);
        dummy.updateMatrix();
        this.bodyMesh.setMatrixAt(instanceIdx, dummy.matrix);
        this.bodyMesh.setColorAt(instanceIdx, s.color);
        instanceIdx++;
      }
    }

    this.bodyMesh.count = instanceIdx;
    this.bodyMesh.instanceMatrix.needsUpdate = true;
    if (this.bodyMesh.instanceColor) this.bodyMesh.instanceColor.needsUpdate = true;
  }
}

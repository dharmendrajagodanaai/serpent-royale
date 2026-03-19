import * as THREE from 'three';
import { getTerrainHeight } from './terrain.js';

export const SERPENT_COLORS = [
  0x00ffcc, // cyan
  0xff4444, // red
  0x44ff44, // green
  0x4488ff, // blue
  0xff8800, // orange
  0xcc44ff, // purple
  0xffff00, // yellow
  0xff44aa, // pink
];

const BASE_SPEED = 6;
const BOOST_SPEED = 12;
const TURN_SPEED = 2.8;
const SEGMENT_SPACING = 0.85;
const START_SEGMENTS = 5;
const MAX_SEGMENTS = 100;
const PATH_MAX = 3000;
const AI_TURN_SPEED = 2.2;
const MAX_TOTAL_SEGS = 800; // 8 × 100

// Bot personalities distributed across 7 bots (index 1-7)
const BOT_PERSONALITIES = ['aggressive', 'collector', 'aggressive', 'coiler', 'collector', 'aggressive', 'coiler'];

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
    this.bodyMesh.frustumCulled = false;
    this.bodyMesh.count = 0;
    this.scene.add(this.bodyMesh);
  }

  _buildHeads() {
    this.headMeshes = [];
    this.headLights = [];
    const headGeo = new THREE.SphereGeometry(0.55, 10, 8);

    // Shared eye materials
    const eyeGeo = new THREE.SphereGeometry(0.13, 6, 5);
    const eyeWhiteMat = new THREE.MeshStandardMaterial({
      color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.4,
      roughness: 0.3, metalness: 0.0
    });
    const pupilGeo = new THREE.SphereGeometry(0.07, 5, 4);
    const pupilMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.8 });

    for (let i = 0; i < 8; i++) {
      const col = new THREE.Color(SERPENT_COLORS[i]);
      const mat = new THREE.MeshStandardMaterial({
        color: col, emissive: col, emissiveIntensity: 0.6,
        roughness: 0.2, metalness: 0.6
      });
      const mesh = new THREE.Mesh(headGeo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.scene.add(mesh);

      // Eyes: local +Z = forward direction (per rotation convention in render())
      // Left eye
      const leftEye = new THREE.Mesh(eyeGeo, eyeWhiteMat);
      leftEye.position.set(-0.22, 0.18, 0.38);
      const leftPupil = new THREE.Mesh(pupilGeo, pupilMat);
      leftPupil.position.set(0, 0, 0.08);
      leftEye.add(leftPupil);
      mesh.add(leftEye);

      // Right eye
      const rightEye = new THREE.Mesh(eyeGeo, eyeWhiteMat);
      rightEye.position.set(0.22, 0.18, 0.38);
      const rightPupil = new THREE.Mesh(pupilGeo, pupilMat);
      rightPupil.position.set(0, 0, 0.08);
      rightEye.add(rightPupil);
      mesh.add(rightEye);

      this.headMeshes.push(mesh);

      // Point light on each head
      const light = new THREE.PointLight(SERPENT_COLORS[i], 1.2, 8);
      light.visible = false;
      this.scene.add(light);
      this.headLights.push(light);
    }
  }

  // playerColorIndex: which SERPENT_COLORS index the player chose
  spawnSerpents(playerIndex = 0, playerColorIndex = 0) {
    this.serpents = [];
    const count = 8;

    // Build color assignment: player gets chosen color, bots get the rest
    const colorArray = [...SERPENT_COLORS];
    if (playerColorIndex !== playerIndex) {
      [colorArray[playerIndex], colorArray[playerColorIndex]] =
        [colorArray[playerColorIndex], colorArray[playerIndex]];
    }

    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const r = 60 + Math.random() * 30;
      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;
      const dirAngle = angle + Math.PI; // Face center
      const dirX = Math.cos(dirAngle), dirZ = Math.sin(dirAngle);

      const personality = i === playerIndex ? 'player' : BOT_PERSONALITIES[i - 1] ?? 'collector';

      const serpent = {
        id: i,
        isPlayer: i === playerIndex,
        path: new SerpentPath(x, z, dirX, dirZ),
        segmentCount: START_SEGMENTS,
        headPos: { x, z },
        headDir: { x: dirX, z: dirZ },
        color: new THREE.Color(colorArray[i]),
        alive: true,
        boosting: false,
        boostDrainTimer: 0,
        zoneDamageTimer: 0,
        name: i === playerIndex ? 'YOU' : `BOT-${i}`,
        kills: 0,
        // Swept collision: previous head position
        prevHeadX: x,
        prevHeadZ: z,
        // AI state
        personality,
        wanderAngle: Math.random() * Math.PI * 2,
        wanderTimer: 0,
        targetOrb: null,
        // Aggressive/coiler target
        aiTarget: null,
        // Bot boost control
        botBoosting: false,
      };

      this.serpents.push(serpent);
      this._botWanderTime.push(Math.random() * 100);

      // Update head mesh material to match assigned color
      const col = new THREE.Color(colorArray[i]);
      this.headMeshes[i].material.color.set(col);
      this.headMeshes[i].material.emissive.set(col);
      this.headLights[i].color.set(col);

      this.headMeshes[i].visible = true;
      this.headLights[i].visible = true;
    }

    this.playerSerpent = this.serpents[playerIndex];
  }

  // Returns array of {x,z} positions where boost orbs should be dropped
  updatePlayer(dt, targetDirX, targetDirZ, boosting) {
    const s = this.playerSerpent;
    if (!s || !s.alive) return [];

    // Track previous head position for swept orb collection
    s.prevHeadX = s.headPos.x;
    s.prevHeadZ = s.headPos.z;

    const canBoost = boosting && s.segmentCount > 3;
    s.boosting = canBoost;
    const speed = canBoost ? BOOST_SPEED : BASE_SPEED;

    s.path.update(targetDirX, targetDirZ, speed, dt);
    s.headPos.x = s.path.headPos.x;
    s.headPos.z = s.path.headPos.z;
    s.headDir.x = s.path.headDir.x;
    s.headDir.z = s.path.headDir.z;

    const droppedOrbs = [];
    if (canBoost) {
      s.boostDrainTimer += dt;
      if (s.boostDrainTimer >= 1.0) {
        // Drop orb at current tail before shrinking
        const tail = s.path.segmentPositions[s.segmentCount - 1];
        if (tail) droppedOrbs.push({ x: tail.x, z: tail.z });
        s.segmentCount = Math.max(3, s.segmentCount - 1);
        s.boostDrainTimer -= 1.0;
        s.path.trimToLength(s.segmentCount);
      }
    } else {
      s.boostDrainTimer = 0;
    }
    return droppedOrbs;
  }

  // Returns array of {x,z} positions where boost orbs should be dropped
  updateBots(dt, orbManager, zoneManager) {
    const droppedOrbs = [];

    for (let i = 0; i < this.serpents.length; i++) {
      const s = this.serpents[i];
      if (s.isPlayer || !s.alive) continue;

      this._botWanderTime[i] += dt;

      // Track previous head position for swept orb collection
      s.prevHeadX = s.headPos.x;
      s.prevHeadZ = s.headPos.z;

      let targetX = s.headDir.x;
      let targetZ = s.headDir.z;
      s.botBoosting = false;

      // ── Wander component ──────────────────────────────────────────────────
      s.wanderTimer -= dt;
      if (s.wanderTimer <= 0) {
        s.wanderAngle = Math.atan2(s.headDir.z, s.headDir.x) + (Math.random() - 0.5) * 2.0;
        s.wanderTimer = 0.5 + Math.random() * 0.7;
      }
      const wx = Math.cos(s.wanderAngle);
      const wz = Math.sin(s.wanderAngle);

      // ── Personality-specific targeting ────────────────────────────────────
      if (s.personality === 'aggressive') {
        this._botAggressive(s, wx, wz, dt, (tx, tz, boost) => {
          targetX = tx; targetZ = tz;
          if (boost) s.botBoosting = true;
        });
      } else if (s.personality === 'coiler') {
        this._botCoiler(s, wx, wz, dt, (tx, tz, boost) => {
          targetX = tx; targetZ = tz;
          if (boost) s.botBoosting = true;
        });
      } else {
        // collector: strong orb-seek with wider radius
        this._botCollector(s, wx, wz, orbManager, (tx, tz) => {
          targetX = tx; targetZ = tz;
        });
      }

      // ── Zone avoidance ────────────────────────────────────────────────────
      if (zoneManager) {
        const r = Math.sqrt(s.headPos.x * s.headPos.x + s.headPos.z * s.headPos.z);
        const zr = zoneManager.currentSize * 0.5;
        if (r > zr * 0.75) {
          const weight = Math.min(1, (r - zr * 0.75) / (zr * 0.25));
          const cx = -s.headPos.x / (r + 0.001);
          const cz = -s.headPos.z / (r + 0.001);
          targetX = targetX * (1 - weight * 0.8) + cx * weight * 0.8;
          targetZ = targetZ * (1 - weight * 0.8) + cz * weight * 0.8;
          // Don't boost into zone wall
          if (weight > 0.5) s.botBoosting = false;
        }
      }

      // ── Body collision avoidance ──────────────────────────────────────────
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
          targetX = targetX * (1 - strength) + anx * strength;
          targetZ = targetZ * (1 - strength) + anz * strength;
          // Don't boost into danger
          if (strength > 0.5) s.botBoosting = false;
        }
      }

      // ── Normalize and smooth turn ─────────────────────────────────────────
      const len = Math.sqrt(targetX * targetX + targetZ * targetZ);
      if (len > 0.001) { targetX /= len; targetZ /= len; }

      const curAngle = Math.atan2(s.headDir.z, s.headDir.x);
      const tgtAngle = Math.atan2(targetZ, targetX);
      let d = tgtAngle - curAngle;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      const maxT = AI_TURN_SPEED * dt;
      const newAngle = curAngle + Math.sign(d) * Math.min(Math.abs(d), maxT);
      s.headDir.x = Math.cos(newAngle);
      s.headDir.z = Math.sin(newAngle);

      // ── Boost gate: must have enough length ───────────────────────────────
      const canBoost = s.botBoosting && s.segmentCount > 6;
      s.boosting = canBoost;
      const speed = canBoost ? BOOST_SPEED : BASE_SPEED;

      s.path.update(s.headDir.x, s.headDir.z, speed, dt);
      s.headPos.x = s.path.headPos.x;
      s.headPos.z = s.path.headPos.z;
      s.headDir.x = s.path.headDir.x;
      s.headDir.z = s.path.headDir.z;

      // ── Boost drain + orb drop ────────────────────────────────────────────
      if (canBoost) {
        s.boostDrainTimer += dt;
        if (s.boostDrainTimer >= 1.0) {
          const tail = s.path.segmentPositions[s.segmentCount - 1];
          if (tail) droppedOrbs.push({ x: tail.x, z: tail.z });
          s.segmentCount = Math.max(3, s.segmentCount - 1);
          s.boostDrainTimer -= 1.0;
          s.path.trimToLength(s.segmentCount);
        }
      } else {
        s.boostDrainTimer = 0;
      }
    }

    return droppedOrbs;
  }

  // ── Personality helpers ────────────────────────────────────────────────────

  _botAggressive(s, wx, wz, dt, setTarget) {
    // Find nearest alive target
    let target = null;
    let minDist = Infinity;
    for (const other of this.serpents) {
      if (other === s || !other.alive) continue;
      const dx = other.headPos.x - s.headPos.x;
      const dz = other.headPos.z - s.headPos.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < minDist) { minDist = d2; target = other; }
    }

    if (target && minDist < 60 * 60) {
      const dist = Math.sqrt(minDist);
      // Intercept slightly ahead of target (cut them off)
      const interceptAhead = Math.min(dist * 0.5, 14);
      const ix = target.headPos.x + target.headDir.x * interceptAhead;
      const iz = target.headPos.z + target.headDir.z * interceptAhead;

      const tdx = ix - s.headPos.x;
      const tdz = iz - s.headPos.z;
      const td = Math.sqrt(tdx * tdx + tdz * tdz);

      let tx = td > 0.001 ? tdx / td : wx;
      let tz = td > 0.001 ? tdz / td : wz;

      // Blend in a little wander when far away
      const aggroBlend = Math.min(1, 30 / (dist + 1));
      tx = tx * aggroBlend + wx * (1 - aggroBlend);
      tz = tz * aggroBlend + wz * (1 - aggroBlend);

      // Boost when within striking range and we have length to spare
      const boost = dist < 22 && s.segmentCount > 8;
      setTarget(tx, tz, boost);
    } else {
      // Fallback: wander + seek nearest orb
      setTarget(wx, wz, false);
    }
  }

  _botCoiler(s, wx, wz, dt, setTarget) {
    // Refresh target if dead or none
    if (!s.aiTarget || !s.aiTarget.alive) {
      s.aiTarget = this.serpents.find(o => o !== s && o.alive) ?? null;
    }

    if (s.aiTarget) {
      const dx = s.aiTarget.headPos.x - s.headPos.x;
      const dz = s.aiTarget.headPos.z - s.headPos.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      // Perpendicular direction (orbit)
      const perpX = -dz / (dist + 0.001);
      const perpZ = dx / (dist + 0.001);
      const towardX = dx / (dist + 0.001);
      const towardZ = dz / (dist + 0.001);

      // More perpendicular when close (orbit), more toward when far (close in)
      const orbitWeight = dist < 10 ? 0.75 : 0.2;
      const tx = towardX * (1 - orbitWeight) + perpX * orbitWeight;
      const tz = towardZ * (1 - orbitWeight) + perpZ * orbitWeight;

      // Boost when orbiting close in for the kill
      const boost = dist < 8 && s.segmentCount > 8;
      setTarget(tx, tz, boost);
    } else {
      setTarget(wx, wz, false);
    }
  }

  _botCollector(s, wx, wz, orbManager, setTarget) {
    let targetX = wx, targetZ = wz;
    let orbWeight = 0;

    if (orbManager) {
      const nearestOrb = orbManager.findNearest(s.headPos.x, s.headPos.z, 60);
      if (nearestOrb) {
        const dx = nearestOrb.x - s.headPos.x;
        const dz = nearestOrb.z - s.headPos.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        targetX = dx / d; targetZ = dz / d;
        orbWeight = Math.max(0, 1 - d / 60);
      }
    }

    const blendX = wx * (1 - orbWeight) + targetX * orbWeight;
    const blendZ = wz * (1 - orbWeight) + targetZ * orbWeight;
    setTarget(blendX, blendZ, false);
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

        // Orient head toward direction (local +Z = forward)
        const angle = Math.atan2(s.headDir.z, s.headDir.x);
        hm.rotation.y = -angle + Math.PI / 2;

        hl.position.set(s.headPos.x, hy + 1, s.headPos.z);

        // Boost pulse
        const ei = s.boosting ? 1.0 : 0.5;
        hm.material.emissiveIntensity = ei;
        hl.intensity = s.boosting ? 2.2 : 1.0;
      }

      // Body segments (skip index 0 = head is separate mesh)
      // Use scale 1.05 for slight overlap between spheres = smoother snake look
      for (let i = 1; i < s.segmentCount && instanceIdx < MAX_TOTAL_SEGS; i++) {
        const seg = segs[i];
        if (!seg) continue;

        const y = getTerrainHeight(seg.x, seg.z) + 0.45;
        const scale = Math.max(0.5, 1.0 - (i / s.segmentCount) * 0.4);

        dummy.position.set(seg.x, y, seg.z);
        dummy.scale.setScalar(scale * 1.05);
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

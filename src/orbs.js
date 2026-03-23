import * as THREE from 'three';
import {
  ORB_RADIUS, ORB_COUNT, ORB_BOB_SPEED, ORB_BOB_HEIGHT, ORB_HEIGHT_OFFSET,
  ARENA_HALF, POWER_ORB_COUNT, POWER_ORB_HEIGHT_OFFSET, POWER_ORB_RADIUS,
  POWERUP_TYPES, POWERUP_COLORS,
  CHASE_ORB_COUNT, CHASE_ORB_FLEE_RADIUS, CHASE_ORB_SPEED, CHASE_ORB_RADIUS,
  DEATH_ORB_RADIUS, DEATH_ORB_LIFETIME,
} from './constants.js';

const POWERUP_TYPE_LIST = Object.keys(POWERUP_TYPES);

export class OrbSystem {
  constructor(scene, terrain) {
    this.scene   = scene;
    this.terrain = terrain;

    this._time = 0;
    this._orbs = []; // { x, z, active, type }
    this._powerOrbs = []; // { x, z, active, kind }
    this._deathOrbs = []; // { x, z, active, color, age }

    this._dummy = new THREE.Object3D();

    // Death orbs — dropped when snakes die, biggest and brightest
    const deathGeo = new THREE.SphereGeometry(DEATH_ORB_RADIUS, 10, 8);
    const deathMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xffffff,
      emissiveIntensity: 2.5,
      roughness: 0.05,
      metalness: 0.0,
      transparent: true,
      opacity: 1.0,
    });
    this._deathMesh = new THREE.InstancedMesh(deathGeo, deathMat, 600);
    this._deathMesh.count = 0;
    scene.add(this._deathMesh);

    // Chase orbs — flee from snake heads, give 3x mass
    this._chaseOrbs = []; // { x, z, vx, vz, active }
    const chaseGeo = new THREE.SphereGeometry(CHASE_ORB_RADIUS, 8, 6);
    const chaseMat = new THREE.MeshStandardMaterial({
      color: 0x00ffaa,
      emissive: 0x00ffaa,
      emissiveIntensity: 1.8,
      roughness: 0.1,
      metalness: 0.0,
    });
    this._chaseMesh = new THREE.InstancedMesh(chaseGeo, chaseMat, CHASE_ORB_COUNT + 5);
    this._chaseMesh.count = 0;
    scene.add(this._chaseMesh);

    // Regular orbs — single InstancedMesh
    const orbGeo = new THREE.SphereGeometry(ORB_RADIUS, 7, 5);
    const orbMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xffffff,
      emissiveIntensity: 0.8,
      roughness: 0.1,
      metalness: 0.0,
    });
    this.orbMesh = new THREE.InstancedMesh(orbGeo, orbMat, ORB_COUNT + 200);
    this.orbMesh.count = 0;
    scene.add(this.orbMesh);

    // Power orbs — one mesh per type
    this._powerOrbMeshes = {};
    for (const kind of POWERUP_TYPE_LIST) {
      const geo = new THREE.OctahedronGeometry(POWER_ORB_RADIUS, 1);
      const mat = new THREE.MeshStandardMaterial({
        color: POWERUP_COLORS[kind],
        emissive: POWERUP_COLORS[kind],
        emissiveIntensity: 1.2,
        roughness: 0.1,
        metalness: 0.3,
        transparent: true,
        opacity: 0.9,
      });
      const mesh = new THREE.InstancedMesh(geo, mat, POWER_ORB_COUNT);
      mesh.count = 0;
      scene.add(mesh);
      this._powerOrbMeshes[kind] = mesh;
    }

    this._spawnInitialOrbs();
    this._spawnPowerOrbs();
    this._spawnChaseOrbs();
  }

  _randPos() {
    const r = Math.random() * (ARENA_HALF * 0.88);
    const a = Math.random() * Math.PI * 2;
    return { x: Math.cos(a) * r, z: Math.sin(a) * r };
  }

  _spawnInitialOrbs() {
    for (let i = 0; i < ORB_COUNT; i++) {
      const { x, z } = this._randPos();
      this._orbs.push({ x, z, active: true });
    }
  }

  _spawnPowerOrbs() {
    for (let i = 0; i < POWER_ORB_COUNT; i++) {
      const { x, z } = this._randPos();
      const kind = POWERUP_TYPE_LIST[Math.floor(Math.random() * POWERUP_TYPE_LIST.length)];
      this._powerOrbs.push({ x, z, active: true, kind });
    }
  }

  _spawnChaseOrbs() {
    for (let i = 0; i < CHASE_ORB_COUNT; i++) {
      const { x, z } = this._randPos();
      this._chaseOrbs.push({ x, z, vx: 0, vz: 0, active: true });
    }
  }

  _respawnChaseOrb(idx) {
    const { x, z } = this._randPos();
    this._chaseOrbs[idx] = { x, z, vx: 0, vz: 0, active: true };
  }

  /** Scatter death orbs at death position (visually distinct, high value) */
  spawnDeathOrbs(x, z, count, colorHex = 0xff4466) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist  = Math.random() * count * 0.35 + 1;
      const ox = x + Math.cos(angle) * dist;
      const oz = z + Math.sin(angle) * dist;
      this._deathOrbs.push({ x: ox, z: oz, active: true, color: colorHex, age: 0 });
    }
  }

  /** Scatter small boost trail orbs (regular orbs from boosting) */
  spawnBoostOrbs(x, z, count) {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist  = Math.random() * count * 0.35 + 1;
      const ox = x + Math.cos(angle) * dist;
      const oz = z + Math.sin(angle) * dist;
      this._orbs.push({ x: ox, z: oz, active: true });
    }
  }

  /** Spawn replacement power orb */
  _respawnPowerOrb(idx) {
    const { x, z } = this._randPos();
    const kind = POWERUP_TYPE_LIST[Math.floor(Math.random() * POWERUP_TYPE_LIST.length)];
    this._powerOrbs[idx] = { x, z, active: true, kind };
  }

  /**
   * Check if head at (hx, hz) collects any orb.
   * Returns array of { type: 'regular'|kind, idx }
   */
  checkCollection(hx, hz, collectRadius) {
    const collected = [];
    const rr = (collectRadius + ORB_RADIUS) * (collectRadius + ORB_RADIUS);

    for (let i = 0; i < this._orbs.length; i++) {
      const o = this._orbs[i];
      if (!o.active) continue;
      const dx = hx - o.x, dz = hz - o.z;
      if (dx * dx + dz * dz < rr) {
        o.active = false;
        collected.push({ type: 'regular', idx: i });
      }
    }

    const pr = (collectRadius + POWER_ORB_RADIUS) * (collectRadius + POWER_ORB_RADIUS);
    for (let i = 0; i < this._powerOrbs.length; i++) {
      const o = this._powerOrbs[i];
      if (!o.active) continue;
      const dx = hx - o.x, dz = hz - o.z;
      if (dx * dx + dz * dz < pr) {
        o.active = false;
        collected.push({ type: o.kind, idx: i });
        // Schedule respawn after 8s (handled in game)
        setTimeout(() => this._respawnPowerOrb(i), 8000);
      }
    }

    // Chase orbs
    const cr = (collectRadius + CHASE_ORB_RADIUS) * (collectRadius + CHASE_ORB_RADIUS);
    for (let i = 0; i < this._chaseOrbs.length; i++) {
      const o = this._chaseOrbs[i];
      if (!o.active) continue;
      const dx = hx - o.x, dz = hz - o.z;
      if (dx * dx + dz * dz < cr) {
        o.active = false;
        collected.push({ type: 'chase', idx: i });
        setTimeout(() => this._respawnChaseOrb(i), 10000);
      }
    }

    // Death orbs (most valuable)
    const dr = (collectRadius + DEATH_ORB_RADIUS) * (collectRadius + DEATH_ORB_RADIUS);
    for (let i = 0; i < this._deathOrbs.length; i++) {
      const o = this._deathOrbs[i];
      if (!o.active) continue;
      const dx = hx - o.x, dz = hz - o.z;
      if (dx * dx + dz * dz < dr) {
        o.active = false;
        collected.push({ type: 'death', idx: i });
      }
    }

    // Refill regular orbs if below threshold
    const activeCount = this._orbs.filter(o => o.active).length;
    if (activeCount < ORB_COUNT * 0.5) {
      const add = Math.floor((ORB_COUNT - activeCount) * 0.3);
      for (let i = 0; i < add; i++) {
        const { x, z } = this._randPos();
        this._orbs.push({ x, z, active: true });
      }
    }

    return collected;
  }

  /** Magnetic pull: return orbs near (hx, hz) within radius, move them toward head */
  magnetPull(hx, hz, radius, dt) {
    const r2 = radius * radius;
    for (const o of this._orbs) {
      if (!o.active) continue;
      const dx = hx - o.x, dz = hz - o.z;
      if (dx * dx + dz * dz < r2) {
        o.x += dx * dt * 3;
        o.z += dz * dt * 3;
      }
    }
  }

  update(dt, serpents) {
    this._time += dt;
    const bob = Math.sin(this._time * ORB_BOB_SPEED) * ORB_BOB_HEIGHT;

    let count = 0;
    for (const o of this._orbs) {
      if (!o.active) continue;
      const y = this.terrain.getHeight(o.x, o.z) + ORB_HEIGHT_OFFSET + bob;
      this._dummy.position.set(o.x, y, o.z);
      this._dummy.rotation.y = this._time * 1.5;
      this._dummy.scale.setScalar(1);
      this._dummy.updateMatrix();
      this.orbMesh.setMatrixAt(count, this._dummy.matrix);
      // Cycle hue for visual variety
      const hue = (o.x * 0.01 + o.z * 0.01 + this._time * 0.1) % 1;
      const c = new THREE.Color().setHSL(hue, 1, 0.6);
      this.orbMesh.setColorAt(count, c);
      count++;
    }
    this.orbMesh.count = count;
    this.orbMesh.instanceMatrix.needsUpdate = true;
    if (this.orbMesh.instanceColor) this.orbMesh.instanceColor.needsUpdate = true;

    // Power orbs by kind
    const kindCounts = {};
    for (const kind of POWERUP_TYPE_LIST) kindCounts[kind] = 0;

    for (const o of this._powerOrbs) {
      if (!o.active) continue;
      const k = o.kind;
      const kidx = kindCounts[k];
      const spin = this._time * 1.8;
      const y = this.terrain.getHeight(o.x, o.z) + POWER_ORB_HEIGHT_OFFSET + Math.sin(this._time * 2.5) * 0.3;
      this._dummy.position.set(o.x, y, o.z);
      this._dummy.rotation.y = spin;
      this._dummy.rotation.x = spin * 0.5;
      this._dummy.scale.setScalar(1 + Math.sin(this._time * 3) * 0.08);
      this._dummy.updateMatrix();
      this._powerOrbMeshes[k].setMatrixAt(kidx, this._dummy.matrix);
      kindCounts[k]++;
    }
    for (const kind of POWERUP_TYPE_LIST) {
      const m = this._powerOrbMeshes[kind];
      m.count = kindCounts[kind];
      m.instanceMatrix.needsUpdate = true;
    }

    // ── Chase orb physics ──
    if (serpents) {
      for (const o of this._chaseOrbs) {
        if (!o.active) continue;
        let fleeX = 0, fleeZ = 0, nearestDist = Infinity;
        for (const s of serpents) {
          if (!s.path.alive) continue;
          const dx = o.x - s.path.headPos.x;
          const dz = o.z - s.path.headPos.z;
          const d = Math.hypot(dx, dz);
          if (d < CHASE_ORB_FLEE_RADIUS && d < nearestDist && d > 0.01) {
            nearestDist = d;
            fleeX = dx / d;
            fleeZ = dz / d;
          }
        }
        if (nearestDist < CHASE_ORB_FLEE_RADIUS) {
          // Stronger impulse when head is very close
          const urgency = 1 - nearestDist / CHASE_ORB_FLEE_RADIUS;
          o.vx += fleeX * 25 * urgency * dt;
          o.vz += fleeZ * 25 * urgency * dt;
        }
        // Drag
        const drag = 1 - Math.min(1, 2 * dt);
        o.vx *= drag;
        o.vz *= drag;
        // Cap speed
        const spd = Math.hypot(o.vx, o.vz);
        if (spd > CHASE_ORB_SPEED) {
          o.vx = (o.vx / spd) * CHASE_ORB_SPEED;
          o.vz = (o.vz / spd) * CHASE_ORB_SPEED;
        }
        o.x += o.vx * dt;
        o.z += o.vz * dt;
        // Bounce off arena boundary
        const r = Math.hypot(o.x, o.z);
        if (r > ARENA_HALF * 0.88) {
          const nx = o.x / r, nz = o.z / r;
          o.vx -= nx * 6;
          o.vz -= nz * 6;
          o.x = nx * ARENA_HALF * 0.85;
          o.z = nz * ARENA_HALF * 0.85;
        }
      }
    }

    // ── Chase orb rendering ──
    const pulse = 1 + Math.sin(this._time * 4.5) * 0.22;
    let chaseCount = 0;
    for (const o of this._chaseOrbs) {
      if (!o.active) continue;
      const y = this.terrain.getHeight(o.x, o.z) + ORB_HEIGHT_OFFSET + Math.sin(this._time * 3.5 + o.x) * 0.2;
      this._dummy.position.set(o.x, y, o.z);
      this._dummy.rotation.y = this._time * 2.5;
      this._dummy.scale.setScalar(pulse);
      this._dummy.updateMatrix();
      this._chaseMesh.setMatrixAt(chaseCount, this._dummy.matrix);
      chaseCount++;
    }
    this._chaseMesh.count = chaseCount;
    this._chaseMesh.instanceMatrix.needsUpdate = true;

    // ── Death orb rendering & aging ──
    const deathPulse = 1 + Math.sin(this._time * 3) * 0.15;
    let deathCount = 0;
    for (let i = 0; i < this._deathOrbs.length; i++) {
      const o = this._deathOrbs[i];
      if (!o.active) continue;
      o.age += dt;
      // Fade out in last 5 seconds of lifetime
      if (o.age > DEATH_ORB_LIFETIME) {
        o.active = false;
        continue;
      }
      const fadeStart = DEATH_ORB_LIFETIME - 5;
      const alpha = o.age > fadeStart ? 1 - (o.age - fadeStart) / 5 : 1;
      const y = this.terrain.getHeight(o.x, o.z) + ORB_HEIGHT_OFFSET + 0.15 + Math.sin(this._time * 2 + o.x * 0.5) * 0.25;
      this._dummy.position.set(o.x, y, o.z);
      this._dummy.rotation.y = this._time * 1.2;
      this._dummy.scale.setScalar(deathPulse * alpha);
      this._dummy.updateMatrix();
      this._deathMesh.setMatrixAt(deathCount, this._dummy.matrix);
      // Color from the dead snake
      const c = new THREE.Color(o.color);
      // Brighten slightly for visibility
      c.r = Math.min(1, c.r * 1.3 + 0.15);
      c.g = Math.min(1, c.g * 1.3 + 0.15);
      c.b = Math.min(1, c.b * 1.3 + 0.15);
      this._deathMesh.setColorAt(deathCount, c);
      deathCount++;
    }
    this._deathMesh.count = deathCount;
    this._deathMesh.instanceMatrix.needsUpdate = true;
    if (this._deathMesh.instanceColor) this._deathMesh.instanceColor.needsUpdate = true;

    // Clean up expired death orbs periodically
    if (Math.random() < dt * 0.1) {
      this._deathOrbs = this._deathOrbs.filter(o => o.active);
    }
  }

  /** Get active power orbs for minimap */
  getPowerOrbs() {
    return this._powerOrbs.filter(o => o.active);
  }
}

import * as THREE from 'three';
import {
  SERPENT_BASE_SPEED, SERPENT_BOOST_SPEED, SERPENT_TURN_SPEED, SERPENT_BOOST_TURN_SPEED,
  SEGMENT_SPACING, SEGMENT_RADIUS, HEAD_RADIUS,
  START_SEGMENTS, MAX_SEGMENTS, ARENA_HALF,
  SERPENT_COLORS,
} from './constants.js';

// ─── Utility ─────────────────────────────────────────────────────────────────

function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI)  d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

// ─── SerpentPath ─────────────────────────────────────────────────────────────

export class SerpentPath {
  constructor(startX, startZ, dirAngle) {
    this.positions = []; // ring buffer of Vec3
    this.headPos = new THREE.Vector3(startX, 0, startZ);
    this.prevHeadPos = new THREE.Vector3(startX, 0, startZ); // for collision sub-step
    this.headAngle = dirAngle; // radians in XZ plane (0 = +Z)
    this.segmentCount = START_SEGMENTS;
    this.boost = false;
    this.boostDrainAccum = 0;
    this.growAccum = 0;
    this.alive = true;
    this.phased = false; // Phase power-up

    // Fill initial path
    for (let i = 0; i < MAX_SEGMENTS * 3; i++) {
      const x = startX - Math.sin(dirAngle) * i * SEGMENT_SPACING * 0.5;
      const z = startZ - Math.cos(dirAngle) * i * SEGMENT_SPACING * 0.5;
      this.positions.push(new THREE.Vector3(x, 0, z));
    }
  }

  /** targetAngle: desired head direction in XZ radians */
  update(targetAngle, dt, terrain, boost) {
    if (!this.alive) return;
    this.boost = boost;

    // Store previous head position for collision sub-step
    this.prevHeadPos.copy(this.headPos);

    const speed = boost ? SERPENT_BOOST_SPEED : SERPENT_BASE_SPEED;
    const turn  = boost ? SERPENT_BOOST_TURN_SPEED : SERPENT_TURN_SPEED;

    // Smooth rotation
    this.headAngle = lerpAngle(this.headAngle, targetAngle, turn * dt);

    // Move head
    this.headPos.x += Math.sin(this.headAngle) * speed * dt;
    this.headPos.z += Math.cos(this.headAngle) * speed * dt;

    // Clamp to arena
    this.headPos.x = Math.max(-ARENA_HALF, Math.min(ARENA_HALF, this.headPos.x));
    this.headPos.z = Math.max(-ARENA_HALF, Math.min(ARENA_HALF, this.headPos.z));

    // Terrain follow
    this.headPos.y = terrain.getHeight(this.headPos.x, this.headPos.z) + 0.5;

    // When boosting, record an extra midpoint for smoother body segment interpolation
    if (boost && this.positions.length > 0) {
      const prev = this.positions[0];
      const mid = new THREE.Vector3(
        (this.headPos.x + prev.x) * 0.5,
        (this.headPos.y + prev.y) * 0.5,
        (this.headPos.z + prev.z) * 0.5
      );
      this.positions.unshift(mid);
      if (this.positions.length > MAX_SEGMENTS * 8) this.positions.pop();
    }

    // Record current head position
    this.positions.unshift(this.headPos.clone());
    if (this.positions.length > MAX_SEGMENTS * 8) {
      this.positions.pop();
    }
  }

  /** Get position of segment i (0 = head) */
  getSegmentPos(i, terrain, out = new THREE.Vector3()) {
    const targetDist = i * SEGMENT_SPACING;
    let accumulated = 0;
    for (let j = 1; j < this.positions.length; j++) {
      const segDist = this.positions[j - 1].distanceTo(this.positions[j]);
      accumulated += segDist;
      if (accumulated >= targetDist) {
        const excess = accumulated - targetDist;
        const t = excess / Math.max(0.001, segDist);
        out.lerpVectors(this.positions[j - 1], this.positions[j], 1 - t);
        out.y = terrain.getHeight(out.x, out.z) + 0.5;
        return out;
      }
    }
    out.copy(this.positions[this.positions.length - 1]);
    out.y = terrain.getHeight(out.x, out.z) + 0.5;
    return out;
  }

  grow(n = 1) {
    this.segmentCount = Math.min(MAX_SEGMENTS, this.segmentCount + n);
  }

  shrink(n = 1) {
    this.segmentCount = Math.max(2, this.segmentCount - n);
  }
}

// ─── SerpentManager ──────────────────────────────────────────────────────────

const MAX_TOTAL = 900; // 8 serpents × ~100 segments + heads

export class SerpentManager {
  constructor(scene, terrain) {
    this.scene   = scene;
    this.terrain = terrain;
    this.serpents = [];

    this._dummy  = new THREE.Object3D();
    this._tempV  = new THREE.Vector3();

    // Shared InstancedMesh for ALL body segments
    const segGeo = new THREE.SphereGeometry(SEGMENT_RADIUS, 8, 6);
    const segMat = new THREE.MeshStandardMaterial({
      roughness: 0.3,
      metalness: 0.6,
      emissive: new THREE.Color(0x000000),
      emissiveIntensity: 0.0,
    });
    this.bodyMesh = new THREE.InstancedMesh(segGeo, segMat, MAX_TOTAL);
    this.bodyMesh.count = 0;
    this.bodyMesh.castShadow = true;
    scene.add(this.bodyMesh);

    // Glow layer — slightly larger, additive
    const glowGeo = new THREE.SphereGeometry(SEGMENT_RADIUS * 1.5, 6, 4);
    const glowMat = new THREE.MeshBasicMaterial({
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
    });
    this.glowMesh = new THREE.InstancedMesh(glowGeo, glowMat, MAX_TOTAL);
    this.glowMesh.count = 0;
    scene.add(this.glowMesh);

    // Individual head meshes (one per serpent)
    this._heads = [];
    this._headLights = [];
    this._trailParticles = [];
  }

  /** Add a serpent and return its index */
  addSerpent(x, z, dirAngle, colorHex, isPlayer = false) {
    const path  = new SerpentPath(x, z, dirAngle);
    const color = new THREE.Color(colorHex);

    const head = this._createHead(color, isPlayer);
    head.position.set(x, this.terrain.getHeight(x, z) + 0.7, z);
    this.scene.add(head);

    // Point light on head
    const light = new THREE.PointLight(colorHex, isPlayer ? 2.5 : 1.5, 18);
    head.add(light);

    // Trail particle system
    const trail = this._createTrail(color);
    this.scene.add(trail.points);

    const idx = this.serpents.length;
    this.serpents.push({ path, color, colorHex, isPlayer, head, light, trail, kills: 0 });
    this._heads.push(head);
    this._headLights.push(light);
    this._trailParticles.push(trail);
    return idx;
  }

  _createHead(color, isPlayer) {
    const group = new THREE.Group();

    // Main head sphere
    const geo = new THREE.SphereGeometry(HEAD_RADIUS, 12, 8);
    const mat = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.5,
      roughness: 0.2,
      metalness: 0.7,
    });
    const mesh = new THREE.Mesh(geo, mat);
    group.add(mesh);

    // Eyes
    const eyeGeo  = new THREE.SphereGeometry(0.1, 6, 4);
    const eyeMat  = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const pupilGeo = new THREE.SphereGeometry(0.055, 4, 3);
    const pupilMat = new THREE.MeshBasicMaterial({ color: 0x000000 });

    const lr = [-0.22, 0.22];
    for (const ex of lr) {
      const eye = new THREE.Mesh(eyeGeo, eyeMat);
      eye.position.set(ex, 0.15, HEAD_RADIUS * 0.85);
      const pupil = new THREE.Mesh(pupilGeo, pupilMat);
      pupil.position.z = 0.07;
      eye.add(pupil);
      group.add(eye);
    }

    // Crown indicator for player
    if (isPlayer) {
      const crownGeo = new THREE.ConeGeometry(0.12, 0.25, 4);
      const crownMat = new THREE.MeshBasicMaterial({ color: 0xffdd00 });
      const crown = new THREE.Mesh(crownGeo, crownMat);
      crown.position.y = HEAD_RADIUS + 0.2;
      group.add(crown);
    }

    return group;
  }

  _createTrail(color) {
    const COUNT = 60;
    const positions = new Float32Array(COUNT * 3);
    const opacities  = new Float32Array(COUNT);
    for (let i = 0; i < COUNT; i++) opacities[i] = 1 - i / COUNT;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geo.setAttribute('opacity',  new THREE.BufferAttribute(opacities,  1));
    const mat = new THREE.PointsMaterial({
      color,
      size: 0.35,
      transparent: true,
      opacity: 0.55,
      sizeAttenuation: true,
      depthWrite: false,
    });
    const points = new THREE.Points(geo, mat);
    return { points, geo, positions, count: COUNT };
  }

  _updateTrail(trail, path, terrain) {
    const { positions, count } = trail;
    const step = Math.max(1, Math.floor(path.positions.length / count));
    for (let i = 0; i < count; i++) {
      const pidx = Math.min(i * step, path.positions.length - 1);
      const p = path.positions[pidx];
      positions[i * 3]     = p.x;
      positions[i * 3 + 1] = terrain.getHeight(p.x, p.z) + 0.55;
      positions[i * 3 + 2] = p.z;
    }
    trail.geo.attributes.position.needsUpdate = true;
  }

  update(dt) {
    let instanceIndex = 0;

    for (let si = 0; si < this.serpents.length; si++) {
      const s = this.serpents[si];
      if (!s.path.alive) {
        s.head.visible = false;
        if (s.trail) s.trail.points.visible = false;
        continue;
      }

      s.head.visible = true;
      if (s.trail) s.trail.points.visible = true;

      // Update head position & orientation
      const hp = s.path.headPos;
      s.head.position.copy(hp);
      s.head.position.y = this.terrain.getHeight(hp.x, hp.z) + 0.7;

      // Orient head along movement direction
      s.head.rotation.y = -s.path.headAngle;

      // Pulse head emissive
      const pulse = Math.sin(Date.now() * 0.003 + si) * 0.2 + 0.8;
      s.head.children[0].material.emissiveIntensity = s.path.boost ? 1.0 : pulse * 0.5;

      // Update body segments in InstancedMesh
      const segCount = s.path.segmentCount;
      for (let i = 0; i < segCount && instanceIndex < MAX_TOTAL; i++) {
        s.path.getSegmentPos(i, this.terrain, this._tempV);
        const scale = i === 0
          ? 1.2
          : Math.max(0.45, 1.0 - (i / segCount) * 0.55);

        this._dummy.position.copy(this._tempV);
        this._dummy.scale.setScalar(scale);
        this._dummy.updateMatrix();

        this.bodyMesh.setMatrixAt(instanceIndex, this._dummy.matrix);
        this.bodyMesh.setColorAt(instanceIndex, s.color);

        this.glowMesh.setMatrixAt(instanceIndex, this._dummy.matrix);
        this.glowMesh.setColorAt(instanceIndex, s.color);

        instanceIndex++;
      }

      // Update trail
      this._updateTrail(s.trail, s.path, this.terrain);
    }

    this.bodyMesh.count = instanceIndex;
    this.bodyMesh.instanceMatrix.needsUpdate = true;
    if (this.bodyMesh.instanceColor) this.bodyMesh.instanceColor.needsUpdate = true;

    this.glowMesh.count = instanceIndex;
    this.glowMesh.instanceMatrix.needsUpdate = true;
    if (this.glowMesh.instanceColor) this.glowMesh.instanceColor.needsUpdate = true;
  }

  /** Return all body segment positions for a given serpent (skip=head segments to ignore) */
  getBodySegments(serpentIdx, skipHead = 3) {
    const s = this.serpents[serpentIdx];
    if (!s || !s.path.alive) return [];
    const result = [];
    const sc = s.path.segmentCount;
    for (let i = skipHead; i < sc; i++) {
      const v = new THREE.Vector3();
      s.path.getSegmentPos(i, this.terrain, v);
      result.push(v);
    }
    return result;
  }

  removeSerpent(idx) {
    const s = this.serpents[idx];
    if (!s) return;
    s.path.alive = false;
    s.head.visible = false;
    if (s.trail) s.trail.points.visible = false;
    s.light.intensity = 0;
  }
}

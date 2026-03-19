import * as THREE from 'three';
import { HASH_CELL, HEAD_RADIUS, SEGMENT_RADIUS } from './constants.js';

// Spatial hash for fast collision detection
class SpatialHash {
  constructor(cellSize) {
    this.cellSize = cellSize;
    this._map = new Map();
  }

  _key(x, z) {
    const cx = Math.floor(x / this.cellSize);
    const cz = Math.floor(z / this.cellSize);
    return (cx & 0xffff) * 65536 + (cz & 0xffff);
  }

  clear() { this._map.clear(); }

  insert(x, z, data) {
    const k = this._key(x, z);
    if (!this._map.has(k)) this._map.set(k, []);
    this._map.get(k).push(data);
  }

  query(x, z, radius) {
    const results = [];
    const cells = Math.ceil(radius / this.cellSize);
    for (let dx = -cells; dx <= cells; dx++) {
      for (let dz = -cells; dz <= cells; dz++) {
        const cx = Math.floor(x / this.cellSize) + dx;
        const cz = Math.floor(z / this.cellSize) + dz;
        const k  = (cx & 0xffff) * 65536 + (cz & 0xffff);
        const bucket = this._map.get(k);
        if (bucket) results.push(...bucket);
      }
    }
    return results;
  }
}

export class CollisionSystem {
  constructor() {
    this._hash = new SpatialHash(HASH_CELL);
    this._tempV = new THREE.Vector3();
    this._killEvents = [];
  }

  /** Build spatial hash from all body segments */
  buildHash(serpents, terrain) {
    this._hash.clear();
    for (let si = 0; si < serpents.length; si++) {
      const s = serpents[si];
      if (!s.path.alive) continue;
      const skip = 2; // reduced from 4 — catches near-head segments of OTHER snakes
      for (let i = skip; i < s.path.segmentCount; i++) {
        s.path.getSegmentPos(i, terrain, this._tempV);
        this._hash.insert(this._tempV.x, this._tempV.z, {
          serpentIdx: si,
          segIdx: i,
          pos: this._tempV.clone(),
        });
      }
    }
  }

  /**
   * Check head-to-body collisions with sub-step to prevent tunneling.
   * Returns array of kill events: { attackerIdx, victimIdx }
   */
  checkHeadBody(serpents, terrain, powerups) {
    this._killEvents.length = 0;
    const collideRadius = HEAD_RADIUS + SEGMENT_RADIUS;
    const r2 = collideRadius * collideRadius;

    for (let ai = 0; ai < serpents.length; ai++) {
      const attacker = serpents[ai];
      if (!attacker.path.alive) continue;
      if (powerups && powerups.isPhased(ai)) continue; // phase power-up

      const hx = attacker.path.headPos.x;
      const hz = attacker.path.headPos.z;

      // Sub-step check: current pos + midpoint toward previous pos (prevents tunneling)
      const subPositions = [{ x: hx, z: hz }];
      const prev = attacker.path.prevHeadPos;
      if (prev) {
        subPositions.push(
          { x: (hx + prev.x) * 0.5, z: (hz + prev.z) * 0.5 },
          { x: (hx * 0.25 + prev.x * 0.75), z: (hz * 0.25 + prev.z * 0.75) }
        );
      }

      let killed = false;
      for (const sp of subPositions) {
        if (killed) break;
        const candidates = this._hash.query(sp.x, sp.z, collideRadius + 1);
        for (const c of candidates) {
          if (c.serpentIdx === ai) continue; // no self-collision
          const victim = serpents[c.serpentIdx];
          if (!victim.path.alive) continue;

          const dx = sp.x - c.pos.x;
          const dz = sp.z - c.pos.z;
          if (dx * dx + dz * dz < r2) {
            this._killEvents.push({ attackerIdx: ai, victimIdx: c.serpentIdx });
            killed = true;
            break;
          }
        }
      }
    }
    return this._killEvents;
  }

  /**
   * Head-to-head collision: when two heads are within HEAD_RADIUS*2, both die.
   * Returns array of { idxA, idxB }
   */
  checkHeadHead(serpents) {
    const results = [];
    const collideR2 = (HEAD_RADIUS * 2) * (HEAD_RADIUS * 2);

    for (let i = 0; i < serpents.length; i++) {
      const a = serpents[i];
      if (!a.path.alive) continue;
      for (let j = i + 1; j < serpents.length; j++) {
        const b = serpents[j];
        if (!b.path.alive) continue;
        const dx = a.path.headPos.x - b.path.headPos.x;
        const dz = a.path.headPos.z - b.path.headPos.z;
        if (dx * dx + dz * dz < collideR2) {
          results.push({ idxA: i, idxB: j });
        }
      }
    }
    return results;
  }

  /**
   * Basic encirclement detection — runs less frequently.
   * Returns array of { encircledIdx, coilerIdx }
   */
  checkEncirclement(serpents, terrain) {
    const results = [];
    for (let ci = 0; ci < serpents.length; ci++) {
      const coiler = serpents[ci];
      if (!coiler.path.alive || coiler.path.segmentCount < 18) continue;

      // Build polygon of coiler body in XZ
      const poly = [];
      for (let i = 0; i < coiler.path.segmentCount; i += 2) {
        const v = new THREE.Vector3();
        coiler.path.getSegmentPos(i, terrain, v);
        poly.push([v.x, v.z]);
      }

      // Check if head ~= tail (closed loop)
      const hx = coiler.path.headPos.x, hz = coiler.path.headPos.z;
      const tail = poly[poly.length - 1];
      const loopDist = Math.hypot(hx - tail[0], hz - tail[1]);
      if (loopDist > coiler.path.segmentCount * 0.4) continue;

      // Check if any opponent head inside polygon
      for (let ti = 0; ti < serpents.length; ti++) {
        if (ti === ci) continue;
        const target = serpents[ti];
        if (!target.path.alive) continue;
        const tx = target.path.headPos.x, tz = target.path.headPos.z;
        if (pointInPolygon(tx, tz, poly)) {
          results.push({ encircledIdx: ti, coilerIdx: ci });
        }
      }
    }
    return results;
  }
}

// ─── Point in polygon (winding number) ──────────────────────────────────────

function pointInPolygon(px, py, poly) {
  let winding = 0;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const [ax, ay] = poly[i];
    const [bx, by] = poly[(i + 1) % n];
    if (ay <= py) {
      if (by > py && cross2D(ax, ay, bx, by, px, py) > 0) winding++;
    } else {
      if (by <= py && cross2D(ax, ay, bx, by, px, py) < 0) winding--;
    }
  }
  return winding !== 0;
}

function cross2D(ax, ay, bx, by, px, py) {
  return (bx - ax) * (py - ay) - (by - ay) * (px - ax);
}

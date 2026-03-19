// Head-to-body collision detection with spatial hashing

const CELL_SIZE = 4.0;
const HEAD_RADIUS = 0.55;
const SEG_RADIUS = 0.42;
const COLLISION_DIST = HEAD_RADIUS + SEG_RADIUS;

function cellKey(cx, cz) {
  return (cx & 0xffff) | ((cz & 0xffff) << 16);
}

export class CollisionSystem {
  constructor() {
    this._grid = new Map();
  }

  // Build spatial hash from ALL body segments (including front segments of other snakes)
  _buildGrid(serpents) {
    const grid = this._grid;
    grid.clear();

    for (const s of serpents) {
      if (!s.alive) continue;
      const segs = s.path.segmentPositions;
      // FIX: start from i=0 so other snakes' front segments are detectable
      for (let i = 0; i < s.segmentCount; i++) {
        const seg = segs[i];
        if (!seg) continue;
        const cx = Math.floor(seg.x / CELL_SIZE);
        const cz = Math.floor(seg.z / CELL_SIZE);
        const key = cellKey(cx, cz);
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push({ x: seg.x, z: seg.z, serpent: s, segIdx: i });
      }
    }
  }

  // Returns array of { victim, killer } pairs — head hits another snake's body
  checkHeadBody(serpents) {
    this._buildGrid(serpents);
    const grid = this._grid;
    const kills = [];
    const distSq = COLLISION_DIST * COLLISION_DIST;

    for (const attacker of serpents) {
      if (!attacker.alive) continue;
      const hx = attacker.headPos.x;
      const hz = attacker.headPos.z;
      const cx = Math.floor(hx / CELL_SIZE);
      const cz = Math.floor(hz / CELL_SIZE);

      // Check 3×3 neighborhood
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          const key = cellKey(cx + dx, cz + dz);
          const cell = grid.get(key);
          if (!cell) continue;

          for (const entry of cell) {
            // Skip own body entirely (no self-collision)
            if (entry.serpent === attacker) continue;
            const ex = hx - entry.x;
            const ez = hz - entry.z;
            if (ex * ex + ez * ez < distSq) {
              if (!kills.some(k => k.victim === attacker)) {
                kills.push({ victim: attacker, killer: entry.serpent });
              }
            }
          }
        }
      }
    }

    return kills;
  }

  // Returns array of { victim, killer } for head-to-head collisions (both die)
  checkHeadHead(serpents) {
    const kills = [];
    const distSq = (HEAD_RADIUS * 2) * (HEAD_RADIUS * 2);

    for (let i = 0; i < serpents.length; i++) {
      const a = serpents[i];
      if (!a.alive) continue;
      for (let j = i + 1; j < serpents.length; j++) {
        const b = serpents[j];
        if (!b.alive) continue;
        const dx = a.headPos.x - b.headPos.x;
        const dz = a.headPos.z - b.headPos.z;
        if (dx * dx + dz * dz < distSq) {
          if (!kills.some(k => k.victim === a)) kills.push({ victim: a, killer: b });
          if (!kills.some(k => k.victim === b)) kills.push({ victim: b, killer: a });
        }
      }
    }

    return kills;
  }
}

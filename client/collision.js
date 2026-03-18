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

  // Build spatial hash from all serpent body segments
  _buildGrid(serpents) {
    const grid = this._grid;
    grid.clear();

    for (const s of serpents) {
      if (!s.alive) continue;
      const segs = s.path.segmentPositions;
      // Skip first few segments near head to avoid false positives
      for (let i = 3; i < s.segmentCount; i++) {
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

  // Returns array of { victim, killer } pairs
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
            if (entry.serpent === attacker) continue; // no self-collision
            const ex = hx - entry.x;
            const ez = hz - entry.z;
            if (ex * ex + ez * ez < distSq) {
              // Check we haven't already killed this attacker this frame
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
}

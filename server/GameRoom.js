import { Room } from 'colyseus';
import { Schema, MapSchema, ArraySchema, defineTypes } from '@colyseus/schema';

// ─── Constants ────────────────────────────────────────────────────────────────

const ARENA_RADIUS   = 95;
const BASE_SPEED     = 6;
const BOOST_SPEED    = 12;
const TURN_SPEED     = 2.8;
const AI_TURN_SPEED  = 2.2;
const SEGMENT_SPACING = 0.85;
const START_SEGMENTS = 5;
const MAX_SEGMENTS   = 100;
const MAX_SENT_SEGS  = 40;   // cap segment positions sent per tick
const TOTAL_SLOTS    = 8;
const ORB_COUNT      = 120;  // regular orbs on server
const CHASE_ORB_COUNT = 10;
const COLLECT_R2     = 2.0 * 2.0;
const CHASE_COLLECT_R2 = 1.8 * 1.8;
const HEAD_R         = 0.55;
const SEG_R          = 0.42;
const COLL_R2        = (HEAD_R + SEG_R) ** 2;
const HEAD_HEAD_R2   = (HEAD_R * 2) ** 2;
const CELL_SIZE      = 4.0;
const COUNTDOWN_SEC  = 3;

const ZONE_PHASES = [
  { size: 200, duration: 30 },
  { size: 160, duration: 30 },
  { size: 120, duration: 30 },
  { size: 80,  duration: 30 },
  { size: 50,  duration: 30 },
  { size: 25,  duration: 30 },
  { size: 10,  duration: 60 },
];

const BOT_NAMES = ['VIPER', 'COBRA', 'ASP', 'BOA', 'MAMBA', 'PYTHON', 'ADDER', 'KRAIT'];
const PERSONALITIES = ['aggressive', 'collector', 'coiler'];

// ─── Schema ───────────────────────────────────────────────────────────────────

class PlayerState extends Schema {
  constructor() {
    super();
    this.x           = 0;
    this.z           = 0;
    this.angle       = 0;
    this.segmentCount = START_SEGMENTS;
    this.alive       = true;
    this.boosting    = false;
    this.colorIdx    = 0;
    this.name        = '';
    this.isBot       = false;
    this.kills       = 0;
    this.slotIndex   = 0;
    this.segmentsJson = '[]';
  }
}
defineTypes(PlayerState, {
  x: 'float32', z: 'float32', angle: 'float32',
  segmentCount: 'int16', alive: 'boolean', boosting: 'boolean',
  colorIdx: 'int8', name: 'string', isBot: 'boolean',
  kills: 'int16', slotIndex: 'int8', segmentsJson: 'string',
});

class OrbState extends Schema {
  constructor() {
    super();
    this.x = 0; this.z = 0;
    this.active  = true;
    this.orbType = 0;   // 0=normal 1=chase 2=death
    this.color   = 0x44ff88;
  }
}
defineTypes(OrbState, {
  x: 'float32', z: 'float32',
  active: 'boolean', orbType: 'uint8', color: 'uint32',
});

class GameRoomState extends Schema {
  constructor() {
    super();
    this.phase         = 'waiting';
    this.matchTime     = 0;
    this.zoneRadius    = ZONE_PHASES[0].size * 0.5;
    this.aliveCount    = 0;
    this.countdownTimer = COUNTDOWN_SEC;
    this.players       = new MapSchema();
    this.orbs          = new ArraySchema();
  }
}
defineTypes(GameRoomState, {
  phase: 'string', matchTime: 'float32', zoneRadius: 'float32',
  aliveCount: 'int8', countdownTimer: 'float32',
  players: { map: PlayerState },
  orbs: [OrbState],
});

// ─── Server-side path ────────────────────────────────────────────────────────

class ServerPath {
  constructor(x, z, angle) {
    this.headX = x; this.headZ = z;
    this.angle = angle;
    this.dirX = Math.sin(angle);
    this.dirZ = Math.cos(angle);
    this.positions = [];
    this.distAccum = 0;
    this._segCache = null;
    // Seed path behind start so segments exist immediately
    for (let i = 30; i >= 0; i--) {
      this.positions.push({ x: x - this.dirX * i * 0.4, z: z - this.dirZ * i * 0.4 });
    }
  }

  update(dt, targetAngle, speed, turnSpd) {
    let diff = targetAngle - this.angle;
    while (diff >  Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    this.angle += Math.sign(diff) * Math.min(Math.abs(diff), turnSpd * dt);
    this.dirX = Math.sin(this.angle);
    this.dirZ = Math.cos(this.angle);

    const step = speed * dt;
    this.headX += this.dirX * step;
    this.headZ += this.dirZ * step;

    // Soft clamp — hard kill at ARENA_RADIUS is handled in _update
    const r = Math.sqrt(this.headX * this.headX + this.headZ * this.headZ);
    if (r > ARENA_RADIUS + 2) {
      this.headX = (this.headX / r) * ARENA_RADIUS;
      this.headZ = (this.headZ / r) * ARENA_RADIUS;
    }

    this.distAccum += step;
    if (this.distAccum >= 0.4) {
      this.positions.push({ x: this.headX, z: this.headZ });
      if (this.positions.length > 3000) this.positions.shift();
      this.distAccum -= 0.4;
    }
    this._segCache = null;
  }

  buildSegmentCache(count) {
    if (this._segCache && this._segCache.length === count) return this._segCache;

    const result = [{ x: this.headX, z: this.headZ }];
    const len = this.positions.length;
    let segIdx = 1, accumulated = 0;

    for (let i = len - 1; i > 0 && segIdx < count; i--) {
      const ax = this.positions[i].x,   az = this.positions[i].z;
      const bx = this.positions[i-1].x, bz = this.positions[i-1].z;
      const dx = bx - ax, dz = bz - az;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < 0.0001) continue;
      const prev = accumulated;
      accumulated += dist;
      while (segIdx < count && segIdx * SEGMENT_SPACING <= accumulated) {
        const t = (segIdx * SEGMENT_SPACING - prev) / dist;
        result.push({ x: ax + dx * t, z: az + dz * t });
        segIdx++;
      }
    }

    const tail = result[result.length - 1] ?? { x: this.headX, z: this.headZ };
    while (result.length < count) result.push({ x: tail.x, z: tail.z });

    this._segCache = result;
    return result;
  }

  trimToLength(segCount) {
    const needed = Math.floor(segCount * SEGMENT_SPACING / 0.4) + 100;
    if (this.positions.length > needed) this.positions.splice(0, this.positions.length - needed);
  }
}

// ─── Server AI ───────────────────────────────────────────────────────────────

class ServerAI {
  constructor(personality) {
    this.personality = personality;
    this.wanderAngle = Math.random() * Math.PI * 2;
    this.wanderTimer = 0;
    this.cachedAngle = Math.random() * Math.PI * 2;
    this.reactionTimer = 0;
    this.reactionInterval = 0.1 + Math.random() * 0.15;
    this.wantsBoost = false;
  }

  update(me, allSerpents, orbData, zoneRadius, dt) {
    this.reactionTimer += dt;
    this.wantsBoost = false;
    if (this.reactionTimer < this.reactionInterval) return this.cachedAngle;
    this.reactionTimer = 0;

    const hx = me.path.headX, hz = me.path.headZ;

    // 1. Zone flee
    const r = Math.sqrt(hx * hx + hz * hz);
    if (r > zoneRadius - 15) {
      this.cachedAngle = Math.atan2(-hx, -hz);
      return this.cachedAngle;
    }

    // 2. Body avoidance
    for (const other of allSerpents) {
      if (other === me || !other.alive) continue;
      const segs = other.segmentCache;
      if (!segs) continue;
      const n = Math.min(other.segmentCount, 12);
      for (let i = 0; i < n; i++) {
        const seg = segs[i];
        if (!seg) continue;
        const dx = hx - seg.x, dz = hz - seg.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < 25 && d2 > 0.01) {
          this.cachedAngle = Math.atan2(dx, dz);
          return this.cachedAngle;
        }
      }
    }

    // 3. Flee from much larger threats
    for (const other of allSerpents) {
      if (other === me || !other.alive) continue;
      if (other.segmentCount < me.segmentCount * 1.5) continue;
      const dx = hx - other.path.headX, dz = hz - other.path.headZ;
      if (dx * dx + dz * dz < 15 * 15) {
        this.cachedAngle = Math.atan2(dx, dz);
        this.wantsBoost = true;
        return this.cachedAngle;
      }
    }

    // 4. Personality behaviour
    if (this.personality === 'aggressive') {
      let closest = null, minD2 = 60 * 60;
      for (const other of allSerpents) {
        if (other === me || !other.alive) continue;
        const dx = other.path.headX - hx, dz = other.path.headZ - hz;
        const d2 = dx * dx + dz * dz;
        if (d2 < minD2) { minD2 = d2; closest = other; }
      }
      if (closest) {
        const dist = Math.sqrt(minD2);
        const ahead = Math.min(dist * 0.5, 14);
        const ix = closest.path.headX + closest.path.dirX * ahead;
        const iz = closest.path.headZ + closest.path.dirZ * ahead;
        this.cachedAngle = Math.atan2(ix - hx, iz - hz);
        this.wantsBoost = dist < 20 && me.segmentCount > 8;
        return this.cachedAngle;
      }
    } else if (this.personality === 'coiler' && me.aiTarget && me.aiTarget.alive) {
      const dx = me.aiTarget.path.headX - hx, dz = me.aiTarget.path.headZ - hz;
      const dist = Math.sqrt(dx * dx + dz * dz) + 0.001;
      const perpX = -dz / dist, perpZ = dx / dist;
      const toX = dx / dist, toZ = dz / dist;
      const orbitW = dist < 10 ? 0.75 : 0.2;
      this.cachedAngle = Math.atan2(toX * (1 - orbitW) + perpX * orbitW, toZ * (1 - orbitW) + perpZ * orbitW);
      this.wantsBoost = dist < 8 && me.segmentCount > 8;
      return this.cachedAngle;
    }

    // 5. Seek nearest orb
    let bestOrb = null, bestD2 = 35 * 35;
    for (const orb of orbData) {
      if (!orb.active) continue;
      const dx = orb.x - hx, dz = orb.z - hz;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) { bestD2 = d2; bestOrb = orb; }
    }
    if (bestOrb) {
      this.cachedAngle = Math.atan2(bestOrb.x - hx, bestOrb.z - hz);
      return this.cachedAngle;
    }

    // 6. Wander with center bias
    this.wanderTimer -= dt;
    if (this.wanderTimer <= 0) {
      this.wanderAngle = me.path.angle + (Math.random() - 0.5) * 2.0;
      this.wanderTimer = 0.5 + Math.random() * 0.7;
    }
    if (r > ARENA_RADIUS * 0.6) {
      const toC = Math.atan2(-hx, -hz);
      let d = toC - this.wanderAngle;
      while (d >  Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.wanderAngle += d * 0.3;
    }
    this.cachedAngle = this.wanderAngle;
    return this.cachedAngle;
  }
}

// ─── Helper: create serpent ───────────────────────────────────────────────────

function makeSerpent(sessionId, slotIndex, colorIdx, name, isBot) {
  const angle = (slotIndex / TOTAL_SLOTS) * Math.PI * 2;
  const r = 50 + Math.random() * 30;
  const x = Math.cos(angle) * r, z = Math.sin(angle) * r;
  const startAngle = angle + Math.PI; // face center

  return {
    sessionId, slotIndex, colorIdx, name, isBot,
    alive: true, boosting: false,
    segmentCount: START_SEGMENTS,
    kills: 0,
    zoneDamageTimer: 0,
    boostDrainTimer: 0,
    path: new ServerPath(x, z, startAngle),
    inputAngle: startAngle,
    inputBoost: false,
    ai: isBot ? new ServerAI(PERSONALITIES[slotIndex % PERSONALITIES.length]) : null,
    aiTarget: null,
    segmentCache: null,
  };
}

// ─── Helper: spatial hash key (works for negative coords) ────────────────────

function cellKey(cx, cz) {
  return (cx & 0xffff) | ((cz & 0xffff) << 16);
}

// ─── Game Room ────────────────────────────────────────────────────────────────

export class GameRoom extends Room {

  onCreate(_options) {
    this.setState(new GameRoomState());

    this._serpents      = new Map();  // id → serpent
    this._usedSlots     = new Set();
    this._orbData       = [];         // internal orb objects
    this._matchPhase    = 'waiting';
    this._countdownTimer = COUNTDOWN_SEC;
    this._zonePhase     = 0;
    this._zonePhaseTimer = 0;
    this._zoneCurrentSize = ZONE_PHASES[0].size;
    this._zoneTargetSize  = ZONE_PHASES[0].size;

    this.onMessage('input', (client, msg) => {
      const s = this._serpents.get(client.sessionId);
      if (s && s.alive) {
        if (typeof msg.angle === 'number') s.inputAngle = msg.angle;
        s.inputBoost = !!msg.boost;
      }
    });

    this.setSimulationInterval((dtMs) => this._tick(dtMs), 50); // 20 hz
  }

  onJoin(client, options) {
    const slot = this._nextSlot();
    if (slot === -1) { client.leave(1000, 'Room full'); return; }

    const colorIdx = typeof options?.colorIdx === 'number' ? options.colorIdx % TOTAL_SLOTS : slot;
    const name = String(options?.name ?? `P-${client.sessionId.substr(0,4)}`).substring(0, 16).toUpperCase();

    const s = makeSerpent(client.sessionId, slot, colorIdx, name, false);
    this._serpents.set(client.sessionId, s);
    this._usedSlots.add(slot);

    const ps = new PlayerState();
    ps.slotIndex = slot; ps.colorIdx = colorIdx; ps.name = name;
    ps.isBot = false; ps.x = s.path.headX; ps.z = s.path.headZ; ps.alive = true;
    this.state.players.set(client.sessionId, ps);

    if (this._matchPhase === 'waiting') {
      this._initOrbs();
      this._fillBots();
      this._startCountdown();
    }
  }

  onLeave(client, _consented) {
    const s = this._serpents.get(client.sessionId);
    if (s) {
      s.alive = false;
      this._usedSlots.delete(s.slotIndex);
      this._serpents.delete(client.sessionId);
    }
    this.state.players.delete(client.sessionId);
  }

  // ─── Internal helpers ──────────────────────────────────────────────────────

  _nextSlot() {
    for (let i = 0; i < TOTAL_SLOTS; i++) if (!this._usedSlots.has(i)) return i;
    return -1;
  }

  _fillBots() {
    for (let i = 0; i < TOTAL_SLOTS; i++) {
      if (this._usedSlots.has(i)) continue;
      const id   = `bot-${i}`;
      const name = BOT_NAMES[i % BOT_NAMES.length];
      const s    = makeSerpent(id, i, i, name, true);
      this._serpents.set(id, s);
      this._usedSlots.add(i);

      const ps = new PlayerState();
      ps.slotIndex = i; ps.colorIdx = i; ps.name = name;
      ps.isBot = true; ps.x = s.path.headX; ps.z = s.path.headZ; ps.alive = true;
      this.state.players.set(id, ps);
    }
    // Give coiler bots a target
    const all = [...this._serpents.values()];
    for (const bot of this._serpents.values()) {
      if (bot.ai?.personality === 'coiler') {
        const others = all.filter(x => x !== bot && x.alive);
        if (others.length) bot.aiTarget = others[Math.floor(Math.random() * others.length)];
      }
    }
  }

  _initOrbs() {
    this._orbData = [];
    this.state.orbs.splice(0);

    for (let i = 0; i < ORB_COUNT; i++)       this._addOrbInternal(this._randOrb(0, 0x44ff88));
    for (let i = 0; i < CHASE_ORB_COUNT; i++) this._addOrbInternal(this._randOrb(1, 0x00ffaa));
  }

  _randOrb(type, color) {
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 85;
    return { x: Math.cos(a) * r, z: Math.sin(a) * r, active: true, type, color, vx: 0, vz: 0 };
  }

  _addOrbInternal(orb) {
    this._orbData.push(orb);
    const os = new OrbState();
    os.x = orb.x; os.z = orb.z; os.active = true; os.orbType = orb.type; os.color = orb.color;
    this.state.orbs.push(os);
    return this._orbData.length - 1;
  }

  _startCountdown() {
    this._matchPhase     = 'countdown';
    this._countdownTimer = COUNTDOWN_SEC;
    this.state.phase     = 'countdown';
    this.state.countdownTimer = COUNTDOWN_SEC;
  }

  _beginMatch() {
    this._matchPhase = 'playing';
    this.state.phase = 'playing';
    this.state.matchTime = 0;
    this._zonePhase      = 0;
    this._zonePhaseTimer = 0;
    this._zoneCurrentSize = ZONE_PHASES[0].size;
    this._zoneTargetSize  = ZONE_PHASES[0].size;
    this.state.zoneRadius = this._zoneCurrentSize * 0.5;
  }

  // ─── Simulation tick ───────────────────────────────────────────────────────

  _tick(dtMs) {
    const dt = Math.min(dtMs / 1000, 0.1);
    if (this._matchPhase === 'countdown') {
      this._countdownTimer -= dt;
      this.state.countdownTimer = Math.max(0, this._countdownTimer);
      if (this._countdownTimer <= 0) this._beginMatch();
    } else if (this._matchPhase === 'playing') {
      this._updateGame(dt);
    }
  }

  _updateGame(dt) {
    this.state.matchTime += dt;
    const all = [...this._serpents.values()];

    // Build segment caches (needed for AI + collision)
    for (const s of all) {
      if (s.alive) s.segmentCache = s.path.buildSegmentCache(s.segmentCount);
    }

    // AI
    const zr = this.state.zoneRadius;
    for (const s of all) {
      if (!s.alive || !s.isBot) continue;
      s.inputAngle = s.ai.update(s, all, this._orbData, zr, dt);
      s.inputBoost = s.ai.wantsBoost && s.segmentCount > 6;
    }

    // Move
    for (const s of all) {
      if (!s.alive) continue;
      const boost = s.inputBoost && s.segmentCount > 3;
      s.boosting = boost;
      s.path.update(dt, s.inputAngle, boost ? BOOST_SPEED : BASE_SPEED, s.isBot ? AI_TURN_SPEED : TURN_SPEED);

      if (boost) {
        s.boostDrainTimer += dt;
        if (s.boostDrainTimer >= 1.0) {
          s.boostDrainTimer -= 1.0;
          s.segmentCount = Math.max(3, s.segmentCount - 1);
          s.path.trimToLength(s.segmentCount);
          const tail = s.path.buildSegmentCache(s.segmentCount);
          const tp = tail[tail.length - 1];
          if (tp) this._dropOrb(tp.x, tp.z, 0xffaa22, 2);
        }
      } else {
        s.boostDrainTimer = 0;
      }
    }

    // Arena boundary kill
    for (const s of all) {
      if (!s.alive) continue;
      const r2 = s.path.headX ** 2 + s.path.headZ ** 2;
      if (r2 > ARENA_RADIUS ** 2) this._die(s, null);
    }

    // Orbs
    this._updateOrbs(dt, all);

    // Zone damage
    this._updateZone(dt, all);

    // Collision
    this._checkCollisions(all);

    // Rebuild caches after movement for accurate state sync
    for (const s of all) {
      if (s.alive) s.segmentCache = s.path.buildSegmentCache(s.segmentCount);
    }

    // Schema sync
    this._syncState();

    // Win check
    const alive = all.filter(s => s.alive);
    if (alive.length <= 1) {
      this._matchPhase = 'gameover';
      this.state.phase = 'gameover';
      this.broadcast('gameover', {
        winnerName: alive[0]?.name ?? null,
        winnerSlot: alive[0]?.slotIndex ?? null,
      });
      // Disconnect after a delay so clients see final state
      setTimeout(() => { try { this.disconnect(); } catch(_e) {} }, 3000);
    }
  }

  _updateOrbs(dt, serpents) {
    // Chase orb physics
    for (const orb of this._orbData) {
      if (!orb.active || orb.type !== 1) continue;
      let fx = 0, fz = 0, nd = Infinity;
      for (const s of serpents) {
        if (!s.alive) continue;
        const dx = orb.x - s.path.headX, dz = orb.z - s.path.headZ;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d < 15 && d < nd && d > 0.01) { nd = d; fx = dx / d; fz = dz / d; }
      }
      if (nd < 15) {
        const urg = 1 - nd / 15;
        orb.vx += fx * 30 * urg * dt;
        orb.vz += fz * 30 * urg * dt;
      }
      orb.vx *= Math.max(0, 1 - 2.5 * dt);
      orb.vz *= Math.max(0, 1 - 2.5 * dt);
      const spd = Math.sqrt(orb.vx ** 2 + orb.vz ** 2);
      if (spd > 5) { orb.vx = orb.vx / spd * 5; orb.vz = orb.vz / spd * 5; }
      orb.x += orb.vx * dt; orb.z += orb.vz * dt;
      const cr = Math.sqrt(orb.x ** 2 + orb.z ** 2);
      if (cr > 88) {
        const nx = orb.x / cr, nz = orb.z / cr;
        orb.vx -= nx * 8; orb.vz -= nz * 8;
        orb.x = nx * 85; orb.z = nz * 85;
      }
    }

    // Collection
    for (const s of serpents) {
      if (!s.alive) continue;
      for (let i = 0; i < this._orbData.length; i++) {
        const orb = this._orbData[i];
        if (!orb.active) continue;
        const dx = s.path.headX - orb.x, dz = s.path.headZ - orb.z;
        const d2 = dx * dx + dz * dz;
        const thresh = orb.type === 1 ? CHASE_COLLECT_R2 : COLLECT_R2;
        if (d2 < thresh) {
          orb.active = false;
          const mass = orb.type === 1 ? 3 : orb.type === 2 ? 5 : 1;
          s.segmentCount = Math.min(MAX_SEGMENTS, s.segmentCount + mass);
          if (i < this.state.orbs.length) this.state.orbs[i].active = false;
          // Respawn normal orbs
          if (orb.type === 0 && Math.random() < 0.7) {
            const no = this._randOrb(0, 0x44ff88);
            orb.x = no.x; orb.z = no.z; orb.active = true;
            if (i < this.state.orbs.length) {
              this.state.orbs[i].x = no.x; this.state.orbs[i].z = no.z;
              this.state.orbs[i].active = true;
            }
          }
        }
      }
    }
  }

  _dropOrb(x, z, color, type = 2) {
    // Reuse an inactive slot first
    for (let i = 0; i < this._orbData.length; i++) {
      if (!this._orbData[i].active) {
        this._orbData[i] = { x, z, active: true, type, color, vx: 0, vz: 0 };
        if (i < this.state.orbs.length) {
          const os = this.state.orbs[i];
          os.x = x; os.z = z; os.active = true; os.orbType = type; os.color = color;
        }
        return;
      }
    }
    // Add new if under cap
    if (this._orbData.length < ORB_COUNT + CHASE_ORB_COUNT + 300) {
      this._addOrbInternal({ x, z, active: true, type, color, vx: 0, vz: 0 });
    }
  }

  _updateZone(dt, serpents) {
    const phase = ZONE_PHASES[this._zonePhase];
    if (!phase) return;
    this._zonePhaseTimer += dt;
    if (this._zonePhaseTimer >= phase.duration) {
      this._zonePhase = Math.min(this._zonePhase + 1, ZONE_PHASES.length - 1);
      this._zonePhaseTimer = 0;
      this._zoneTargetSize = ZONE_PHASES[this._zonePhase].size;
    }
    this._zoneCurrentSize += (this._zoneTargetSize - this._zoneCurrentSize) * 0.025;
    this.state.zoneRadius = this._zoneCurrentSize * 0.5;

    for (const s of serpents) {
      if (!s.alive) continue;
      const dist = Math.sqrt(s.path.headX ** 2 + s.path.headZ ** 2);
      if (dist > this.state.zoneRadius) {
        s.zoneDamageTimer += dt;
        if (s.zoneDamageTimer >= 1.0) {
          s.zoneDamageTimer -= 1.0;
          s.segmentCount = Math.max(1, s.segmentCount - 1);
          if (s.segmentCount <= 1) this._die(s, null);
        }
      } else {
        s.zoneDamageTimer = 0;
      }
    }
  }

  _checkCollisions(serpents) {
    const grid = new Map();
    for (const s of serpents) {
      if (!s.alive) continue;
      const segs = s.segmentCache; if (!segs) continue;
      for (let i = 0; i < s.segmentCount && i < segs.length; i++) {
        const seg = segs[i];
        const cx = Math.floor(seg.x / CELL_SIZE), cz = Math.floor(seg.z / CELL_SIZE);
        const key = cellKey(cx, cz);
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key).push({ x: seg.x, z: seg.z, serpent: s });
      }
    }

    const kills = [];
    for (const attacker of serpents) {
      if (!attacker.alive) continue;
      const hx = attacker.path.headX, hz = attacker.path.headZ;
      const cx = Math.floor(hx / CELL_SIZE), cz = Math.floor(hz / CELL_SIZE);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          const cell = grid.get(cellKey(cx + dx, cz + dz));
          if (!cell) continue;
          for (const e of cell) {
            if (e.serpent === attacker) continue;
            const ex = hx - e.x, ez = hz - e.z;
            if (ex * ex + ez * ez < COLL_R2 && !kills.some(k => k.victim === attacker)) {
              kills.push({ victim: attacker, killer: e.serpent });
            }
          }
        }
      }
    }

    // Head-to-head
    for (let i = 0; i < serpents.length; i++) {
      const a = serpents[i]; if (!a.alive) continue;
      for (let j = i + 1; j < serpents.length; j++) {
        const b = serpents[j]; if (!b.alive) continue;
        const dx = a.path.headX - b.path.headX, dz = a.path.headZ - b.path.headZ;
        if (dx * dx + dz * dz < HEAD_HEAD_R2) {
          if (!kills.some(k => k.victim === a)) kills.push({ victim: a, killer: b });
          if (!kills.some(k => k.victim === b)) kills.push({ victim: b, killer: a });
        }
      }
    }

    for (const { victim, killer } of kills) {
      if (victim.alive) this._die(victim, killer);
    }
  }

  _die(serpent, killer) {
    if (!serpent.alive) return;
    serpent.alive = false;

    // Scatter death orbs along body
    const segs = serpent.segmentCache;
    if (segs) {
      const count = Math.min(serpent.segmentCount, segs.length);
      for (let i = 0; i < count; i += 3) {
        const seg = segs[i]; if (!seg) continue;
        this._dropOrb(
          seg.x + (Math.random() - 0.5) * 2,
          seg.z + (Math.random() - 0.5) * 2,
          0xff6644, 2
        );
      }
    }

    if (killer) {
      killer.kills++;
      const ks = this.state.players.get(killer.sessionId);
      if (ks) ks.kills = killer.kills;
    }

    this.broadcast('kill', {
      victimName: serpent.name,
      victimSlot: serpent.slotIndex,
      killerName: killer?.name ?? null,
      killerSlot: killer?.slotIndex ?? null,
    });
  }

  _syncState() {
    let aliveCount = 0;
    for (const [id, s] of this._serpents) {
      const ps = this.state.players.get(id);
      if (!ps) continue;

      ps.x    = s.path.headX;
      ps.z    = s.path.headZ;
      ps.angle = s.path.angle;
      ps.segmentCount = s.segmentCount;
      ps.alive    = s.alive;
      ps.boosting = s.boosting;
      ps.kills    = s.kills;

      if (s.alive) aliveCount++;

      // Encode segment positions (capped for bandwidth)
      const segs = s.segmentCache;
      if (segs && segs.length) {
        const n = Math.min(segs.length, MAX_SENT_SEGS);
        const arr = [];
        for (let i = 0; i < n; i++) arr.push({ x: +segs[i].x.toFixed(2), z: +segs[i].z.toFixed(2) });
        ps.segmentsJson = JSON.stringify(arr);
      }
    }

    this.state.aliveCount = aliveCount;

    // Sync chase orb positions
    let oi = 0;
    for (const orb of this._orbData) {
      if (oi >= this.state.orbs.length) break;
      if (orb.type === 1 && this.state.orbs[oi]) {
        this.state.orbs[oi].x = +orb.x.toFixed(2);
        this.state.orbs[oi].z = +orb.z.toFixed(2);
      }
      oi++;
    }
  }
}

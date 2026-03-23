import * as THREE from 'three';
import { SERPENT_BASE_SPEED, ARENA_HALF, AI_SEEK_RADIUS, AI_AVOID_RADIUS, START_SEGMENTS, MAX_SEGMENTS } from './constants.js';

const AI_STATES = {
  SEEK_ORB:    'SEEK_ORB',
  AVOID_BODY:  'AVOID_BODY',
  FLEE_ZONE:   'FLEE_ZONE',
  CHASE_HEAD:  'CHASE_HEAD',
  COIL:        'COIL',
  WANDER:      'WANDER',
};

// ── Difficulty scaling tiers ─────────────────────────────────────────────────
// As the player grows, the world gets harder. This maps player size → difficulty
// multiplier (0 = passive newbie world, 1 = full slither.io aggression).
function computeDifficultyScale(playerSegments) {
  // Normalize player size: 0 at start, 1 at ~60% of max
  const t = Math.max(0, (playerSegments - START_SEGMENTS) / (MAX_SEGMENTS * 0.6 - START_SEGMENTS));
  return Math.min(1, t);
}

export class AIController {
  constructor(serpentIdx) {
    this.serpentIdx = serpentIdx;
    this.state = AI_STATES.SEEK_ORB;
    this.targetX = 0;
    this.targetZ = 0;
    this.wanderAngle = Math.random() * Math.PI * 2;
    this.stateTimer = 0;
    this.reactionTimer = 0;
    this._baseReactionInterval = 0.1 + Math.random() * 0.15; // 100-250ms base
    this.reactionInterval = this._baseReactionInterval;
    this._cachedAngle = Math.random() * Math.PI * 2;

    // Base personality: 0 = defensive, 1 = aggressive
    // This is the bot's innate tendency — difficulty scaling amplifies it
    this._baseAggression = Math.random();
    this.aggression = this._baseAggression;
    this.wantsBoost = false;
    this.boostOrbTimer = 0;

    // Behavior role: ~30% of bots are "hunters" who scale up faster
    this.isHunter = Math.random() < 0.3;
  }

  /**
   * Compute desired movement angle for this AI.
   * @param {Object} mySerpent - the serpent object for this AI
   * @param {Array} allSerpents - all serpent objects
   * @param {Object} orbSystem - OrbSystem
   * @param {Object} zoneManager - ZoneManager (or boundary)
   * @param {number} dt
   * @param {number} playerSegments - current player snake segment count
   * @returns {number} desired angle in XZ radians
   */
  update(mySerpent, allSerpents, orbSystem, zoneManager, dt, playerSegments = START_SEGMENTS) {
    if (!mySerpent.path.alive) return this._cachedAngle;

    this.stateTimer  += dt;
    this.reactionTimer += dt;
    this.wantsBoost = false;

    // ── Dynamic difficulty based on player size ──
    const diff = computeDifficultyScale(playerSegments);

    // Scale aggression: at low difficulty, bots are mostly passive
    // Hunters ramp up faster than regular bots
    const hunterBonus = this.isHunter ? 0.25 : 0;
    this.aggression = Math.min(1, this._baseAggression * (0.3 + diff * 0.7) + diff * hunterBonus);

    // Scale reaction time: faster reactions at higher difficulty
    // Low diff: 150-350ms, High diff: 80-200ms
    this.reactionInterval = this._baseReactionInterval * (1.2 - diff * 0.5);

    // Only recalculate at reaction interval
    if (this.reactionTimer < this.reactionInterval) return this._cachedAngle;
    this.reactionTimer = 0;

    const me = mySerpent.path;
    const hx = me.headPos.x;
    const hz = me.headPos.z;
    const mySize = me.segmentCount;

    // ── Priority 1: flee zone if outside or close to edge ──
    const distToEdge = zoneManager.distanceToEdge(hx, hz);
    if (distToEdge < 15) {
      const toCenter = Math.atan2(-hz, -hx);
      this._cachedAngle = toCenter;
      this.state = AI_STATES.FLEE_ZONE;
      return this._cachedAngle;
    }

    // ── Priority 2: avoid nearby serpent bodies ──
    // At higher difficulty, bots avoid from further away (better spatial awareness)
    const effectiveAvoidRadius = AI_AVOID_RADIUS + diff * 3;
    let bestAvoidAngle = null;
    let minBodyDist = Infinity;
    for (let si = 0; si < allSerpents.length; si++) {
      if (si === this.serpentIdx) continue;
      const other = allSerpents[si];
      if (!other.path.alive) continue;
      for (let i = 2; i < other.path.segmentCount; i += 2) {
        const sv = new THREE.Vector3();
        other.path.getSegmentPos(i, { getHeight: () => 0 }, sv);
        const dx = hx - sv.x, dz = hz - sv.z;
        const d = Math.hypot(dx, dz);
        if (d < effectiveAvoidRadius && d < minBodyDist) {
          minBodyDist = d;
          bestAvoidAngle = Math.atan2(dx, dz);
        }
      }
    }
    if (bestAvoidAngle !== null) {
      this._cachedAngle = bestAvoidAngle;
      this.state = AI_STATES.AVOID_BODY;
      return this._cachedAngle;
    }

    // ── Priority 2.5: flee from significantly larger threats ──
    // At low difficulty, bots barely flee; at high difficulty, they're smart about it
    const fleeThresholdRatio = 1.8 - diff * 0.5; // low diff: 1.8x bigger triggers flee; high diff: 1.3x
    for (let si = 0; si < allSerpents.length; si++) {
      if (si === this.serpentIdx) continue;
      const threat = allSerpents[si];
      if (!threat.path.alive) continue;
      const sizeRatio = threat.path.segmentCount / Math.max(1, mySize);
      if (sizeRatio < fleeThresholdRatio) continue;
      const dx = hx - threat.path.headPos.x;
      const dz = hz - threat.path.headPos.z;
      const d = Math.hypot(dx, dz);
      const fleeRadius = 10 + mySize * 0.2 + diff * 5;
      if (d < fleeRadius) {
        this._cachedAngle = Math.atan2(dx, dz);
        this.wantsBoost = diff > 0.3 || this.aggression > 0.5; // smarter flee at higher diff
        this.state = AI_STATES.AVOID_BODY;
        return this._cachedAngle;
      }
    }

    // ── Priority 3: COIL (encircle smaller opponents) ──
    // At low difficulty, almost no bots coil. At high difficulty, aggressive bots coil actively.
    const coilAggressionThreshold = 0.75 - diff * 0.35; // low diff: need 0.75 aggr; high diff: need 0.40
    const coilSizeThreshold = Math.max(15, 35 - Math.floor(diff * 15 + this.aggression * 8));
    if (mySize >= coilSizeThreshold && this.aggression > coilAggressionThreshold) {
      for (let si = 0; si < allSerpents.length; si++) {
        if (si === this.serpentIdx) continue;
        const target = allSerpents[si];
        if (!target.path.alive) continue;
        if (target.path.segmentCount >= mySize) continue;
        const dx = target.path.headPos.x - hx;
        const dz = target.path.headPos.z - hz;
        const dist = Math.hypot(dx, dz);
        const coilRange = 12 + (mySize - coilSizeThreshold) * 0.3 + diff * 5;
        if (dist < coilRange) {
          const angleToTarget = Math.atan2(dx, dz);
          // Higher difficulty → tighter orbit (closer to perpendicular cutoff)
          const orbitOffset = (Math.PI / 2) - diff * 0.3;
          this._cachedAngle = angleToTarget + orbitOffset;
          this.state = AI_STATES.COIL;
          this.wantsBoost = this.aggression > 0.6 && dist > 6;
          return this._cachedAngle;
        }
      }
    }

    // ── Priority 4: CHASE_HEAD (cut off smaller opponents) ──
    // At low difficulty, only the most aggressive bots chase. At high difficulty, most do.
    const chaseAggressionThreshold = 0.6 - diff * 0.4; // low diff: need 0.6 aggr; high diff: need 0.2
    const chaseSizeThreshold = Math.max(10, 25 - Math.floor(diff * 12 + this.aggression * 5));
    if (mySize > chaseSizeThreshold && this.aggression > chaseAggressionThreshold) {
      let closestEnemy = null;
      let closestDist  = AI_SEEK_RADIUS * (1.0 + diff * 0.8); // larger seek range at higher diff

      for (let si = 0; si < allSerpents.length; si++) {
        if (si === this.serpentIdx) continue;
        const target = allSerpents[si];
        if (!target.path.alive) continue;
        // At higher difficulty, bots chase even near-equal size opponents
        const chaseSizeRatio = 0.9 + diff * 0.08; // low diff: chase < 0.9x; high diff: chase < 0.98x
        if (target.path.segmentCount >= mySize * chaseSizeRatio) continue;
        const dx = target.path.headPos.x - hx;
        const dz = target.path.headPos.z - hz;
        const dist = Math.hypot(dx, dz);
        if (dist < closestDist) {
          closestDist  = dist;
          closestEnemy = target;
        }
      }

      if (closestEnemy) {
        // Predict intercept: aim ahead of their heading
        // Higher difficulty → better prediction (longer look-ahead)
        const lookAhead = 8 + mySize * 0.2 + diff * 8;
        const eAngle = closestEnemy.path.headAngle;
        const interceptX = closestEnemy.path.headPos.x + Math.sin(eAngle) * lookAhead;
        const interceptZ = closestEnemy.path.headPos.z + Math.cos(eAngle) * lookAhead;
        this._cachedAngle = Math.atan2(interceptX - hx, interceptZ - hz);
        this.state = AI_STATES.CHASE_HEAD;
        const boostRange = AI_SEEK_RADIUS * (0.3 + this.aggression * 0.5 + diff * 0.2);
        this.wantsBoost = closestDist < boostRange;
        return this._cachedAngle;
      }
    }

    // ── Leaderboard hunter behavior ──
    // Top-3 bots (by size) actively hunt other large snakes when difficulty is moderate+
    if (diff > 0.35 && this.isHunter && mySize > 30) {
      let bestTarget = null;
      let bestScore  = -1;
      for (let si = 0; si < allSerpents.length; si++) {
        if (si === this.serpentIdx) continue;
        const target = allSerpents[si];
        if (!target.path.alive) continue;
        // Hunt large snakes (but smaller than us)
        if (target.path.segmentCount < 25 || target.path.segmentCount >= mySize) continue;
        const dx = target.path.headPos.x - hx;
        const dz = target.path.headPos.z - hz;
        const dist = Math.hypot(dx, dz);
        if (dist > AI_SEEK_RADIUS * 2) continue;
        // Score: prefer bigger prey that's closer
        const score = target.path.segmentCount / (dist + 5);
        if (score > bestScore) {
          bestScore  = score;
          bestTarget = target;
        }
      }
      if (bestTarget) {
        const lookAhead = 10 + diff * 6;
        const eAngle = bestTarget.path.headAngle;
        const interceptX = bestTarget.path.headPos.x + Math.sin(eAngle) * lookAhead;
        const interceptZ = bestTarget.path.headPos.z + Math.cos(eAngle) * lookAhead;
        this._cachedAngle = Math.atan2(interceptX - hx, interceptZ - hz);
        this.state = AI_STATES.CHASE_HEAD;
        this.wantsBoost = true;
        return this._cachedAngle;
      }
    }

    // ── Priority 5: seek nearest orb (prefer death orbs > chase orbs > normal) ──
    if (orbSystem && orbSystem._orbs) {
      let bestDist = AI_SEEK_RADIUS * AI_SEEK_RADIUS;
      let bestOrb  = null;

      // At higher difficulty, bots prioritize high-value orbs more effectively
      // Check death orbs first (highest value)
      if (orbSystem._deathOrbs) {
        const deathOrbBonus = 1.0 + diff * 0.5; // scale effective distance for death orbs
        for (const o of orbSystem._deathOrbs) {
          if (!o.active) continue;
          const dx = o.x - hx, dz = o.z - hz;
          const d2 = (dx * dx + dz * dz) / (deathOrbBonus * deathOrbBonus);
          if (d2 < bestDist) { bestDist = d2; bestOrb = o; }
        }
      }

      // Chase orbs (second priority)
      if (orbSystem._chaseOrbs) {
        const chaseOrbBonus = 1.0 + diff * 0.3;
        for (const o of orbSystem._chaseOrbs) {
          if (!o.active) continue;
          const dx = o.x - hx, dz = o.z - hz;
          const d2 = (dx * dx + dz * dz) / (chaseOrbBonus * chaseOrbBonus);
          if (d2 < bestDist) { bestDist = d2; bestOrb = o; }
        }
      }

      // Regular orbs
      for (const o of orbSystem._orbs) {
        if (!o.active) continue;
        const dx = o.x - hx, dz = o.z - hz;
        const d2 = dx * dx + dz * dz;
        if (d2 < bestDist) { bestDist = d2; bestOrb = o; }
      }

      if (bestOrb) {
        this._cachedAngle = Math.atan2(bestOrb.x - hx, bestOrb.z - hz);
        this.state = AI_STATES.SEEK_ORB;
        // At higher difficulty, bots boost toward high-value orbs
        if (diff > 0.5 && bestOrb.mass && bestOrb.mass >= 3) {
          this.wantsBoost = Math.random() < diff * 0.3;
        }
        return this._cachedAngle;
      }
    }

    // ── Priority 6: wander ──
    const wanderJitter = 0.3 + this.aggression * 0.5;
    this.wanderAngle += (Math.random() - 0.5) * wanderJitter;
    const dist = Math.hypot(hx, hz);
    if (dist > ARENA_HALF * 0.75) {
      const toCenterAngle = Math.atan2(-hx, -hz);
      const d = toCenterAngle - this.wanderAngle;
      const delta = ((d + Math.PI) % (Math.PI * 2)) - Math.PI;
      this.wanderAngle += delta * 0.3;
    }
    this._cachedAngle = this.wanderAngle;
    this.state = AI_STATES.WANDER;
    return this._cachedAngle;
  }
}

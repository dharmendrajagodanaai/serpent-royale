import * as THREE from 'three';
import { SERPENT_BASE_SPEED, ARENA_HALF, AI_SEEK_RADIUS, AI_AVOID_RADIUS } from './constants.js';

const AI_STATES = {
  SEEK_ORB:    'SEEK_ORB',
  AVOID_BODY:  'AVOID_BODY',
  FLEE_ZONE:   'FLEE_ZONE',
  CHASE_HEAD:  'CHASE_HEAD',
  COIL:        'COIL',
  WANDER:      'WANDER',
};

export class AIController {
  constructor(serpentIdx) {
    this.serpentIdx = serpentIdx;
    this.state = AI_STATES.SEEK_ORB;
    this.targetX = 0;
    this.targetZ = 0;
    this.wanderAngle = Math.random() * Math.PI * 2;
    this.stateTimer = 0;
    this.reactionTimer = 0;
    this.reactionInterval = 0.1 + Math.random() * 0.15; // 100-250ms reaction
    this._cachedAngle = Math.random() * Math.PI * 2;

    // Personality: 0 = defensive (flee more), 1 = aggressive (chase more)
    this.aggression = Math.random();
    this.wantsBoost = false;    // read by main.js each frame
    this.boostOrbTimer = 0;     // tracks time since last boost orb drop
  }

  /**
   * Compute desired movement angle for this AI.
   * @param {Object} mySerpent - the serpent object for this AI
   * @param {Array} allSerpents - all serpent objects
   * @param {Object} orbSystem - OrbSystem
   * @param {Object} zoneManager - ZoneManager
   * @param {number} dt
   * @returns {number} desired angle in XZ radians
   */
  update(mySerpent, allSerpents, orbSystem, zoneManager, dt) {
    if (!mySerpent.path.alive) return this._cachedAngle;

    this.stateTimer  += dt;
    this.reactionTimer += dt;
    this.wantsBoost = false;

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
        if (d < AI_AVOID_RADIUS && d < minBodyDist) {
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
    for (let si = 0; si < allSerpents.length; si++) {
      if (si === this.serpentIdx) continue;
      const threat = allSerpents[si];
      if (!threat.path.alive) continue;
      // Only flee from serpents clearly bigger than us (scales with our own size)
      const sizeRatio = threat.path.segmentCount / Math.max(1, mySize);
      if (sizeRatio < 1.4) continue;
      const dx = hx - threat.path.headPos.x;
      const dz = hz - threat.path.headPos.z;
      const d = Math.hypot(dx, dz);
      const fleeRadius = 12 + mySize * 0.2; // larger bots stay scared slightly further
      if (d < fleeRadius) {
        this._cachedAngle = Math.atan2(dx, dz);
        this.wantsBoost = true; // boost to escape large predator
        this.state = AI_STATES.AVOID_BODY;
        return this._cachedAngle;
      }
    }

    // ── Priority 3: COIL — if large enough and opponent is very close, encircle them ──
    // Larger/more aggressive bots start coiling at a lower size threshold
    const coilThreshold = Math.max(20, 30 - Math.floor(this.aggression * 12));
    if (mySize >= coilThreshold && this.aggression > 0.45) {
      for (let si = 0; si < allSerpents.length; si++) {
        if (si === this.serpentIdx) continue;
        const target = allSerpents[si];
        if (!target.path.alive) continue;
        if (target.path.segmentCount >= mySize) continue; // only coil smaller
        const dx = target.path.headPos.x - hx;
        const dz = target.path.headPos.z - hz;
        const dist = Math.hypot(dx, dz);
        // Larger bots extend their coil/trap radius proportionally
        const coilRange = 15 + (mySize - coilThreshold) * 0.3;
        if (dist < coilRange) {
          const angleToTarget = Math.atan2(dx, dz);
          this._cachedAngle = angleToTarget + Math.PI / 2; // tangent orbit
          this.state = AI_STATES.COIL;
          this.wantsBoost = this.aggression > 0.7 && dist > 8;
          return this._cachedAngle;
        }
      }
    }

    // ── Priority 4: CHASE_HEAD — if big enough, cut off a smaller opponent ──
    // More aggressive / larger bots pursue at lower size thresholds
    const chaseThreshold = Math.max(15, 20 - Math.floor(this.aggression * 8));
    if (mySize > chaseThreshold && this.aggression > 0.3) {
      let closestEnemy = null;
      let closestDist  = AI_SEEK_RADIUS * 1.5;

      for (let si = 0; si < allSerpents.length; si++) {
        if (si === this.serpentIdx) continue;
        const target = allSerpents[si];
        if (!target.path.alive) continue;
        if (target.path.segmentCount >= mySize * 0.9) continue; // only chase clearly smaller
        const dx = target.path.headPos.x - hx;
        const dz = target.path.headPos.z - hz;
        const dist = Math.hypot(dx, dz);
        if (dist < closestDist) {
          closestDist  = dist;
          closestEnemy = target;
        }
      }

      if (closestEnemy) {
        // Predict intercept: aim ahead of their heading to cut them off
        const lookAhead = 12 + mySize * 0.3;
        const eAngle = closestEnemy.path.headAngle;
        const interceptX = closestEnemy.path.headPos.x + Math.sin(eAngle) * lookAhead;
        const interceptZ = closestEnemy.path.headPos.z + Math.cos(eAngle) * lookAhead;
        this._cachedAngle = Math.atan2(interceptX - hx, interceptZ - hz);
        this.state = AI_STATES.CHASE_HEAD;
        // Bigger/more-aggressive bots boost more freely during the chase
        const boostRange = AI_SEEK_RADIUS * (0.4 + this.aggression * 0.6);
        this.wantsBoost = closestDist < boostRange;
        return this._cachedAngle;
      }
    }

    // ── Priority 5: seek nearest orb (prefer chase orbs — 3x value) ──
    if (orbSystem && orbSystem._orbs) {
      let bestDist = AI_SEEK_RADIUS * AI_SEEK_RADIUS;
      let bestOrb  = null;
      // Check chase orbs first (higher value, smaller effective seek radius is fine)
      if (orbSystem._chaseOrbs) {
        for (const o of orbSystem._chaseOrbs) {
          if (!o.active) continue;
          const dx = o.x - hx, dz = o.z - hz;
          const d2 = dx * dx + dz * dz;
          if (d2 < bestDist) { bestDist = d2; bestOrb = o; }
        }
      }
      for (const o of orbSystem._orbs) {
        if (!o.active) continue;
        const dx = o.x - hx, dz = o.z - hz;
        const d2 = dx * dx + dz * dz;
        if (d2 < bestDist) { bestDist = d2; bestOrb = o; }
      }
      if (bestOrb) {
        this._cachedAngle = Math.atan2(bestOrb.x - hx, bestOrb.z - hz);
        this.state = AI_STATES.SEEK_ORB;
        return this._cachedAngle;
      }
    }

    // ── Priority 6: wander ──
    // Aggressive bots wander more erratically, defensive bots move smoothly
    const wanderJitter = 0.3 + this.aggression * 0.5;
    this.wanderAngle += (Math.random() - 0.5) * wanderJitter;
    // Bias toward arena center if drifting too far
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

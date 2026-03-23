import { POWERUP_TYPES, POWERUP_DURATIONS, POWERUP_COLORS } from './constants.js';
import * as THREE from 'three';

export class PowerupSystem {
  constructor() {
    // Map: serpentIdx → { kind, timeLeft, color }
    this._active = new Map();
  }

  apply(serpentIdx, kind) {
    const prev = this._active.get(serpentIdx);
    // Refresh or replace
    this._active.set(serpentIdx, {
      kind,
      timeLeft: POWERUP_DURATIONS[kind] ?? 5,
      color: POWERUP_COLORS[kind],
    });
  }

  hasEffect(serpentIdx, kind) {
    const e = this._active.get(serpentIdx);
    return e && e.kind === kind && e.timeLeft > 0;
  }

  getEffect(serpentIdx) {
    return this._active.get(serpentIdx) || null;
  }

  update(dt) {
    for (const [idx, effect] of this._active) {
      effect.timeLeft -= dt;
      if (effect.timeLeft <= 0) {
        this._active.delete(idx);
      }
    }
  }

  clear(serpentIdx) {
    this._active.delete(serpentIdx);
  }

  /** Apply frenzy visual: return speed multiplier */
  getSpeedMult(serpentIdx) {
    if (this.hasEffect(serpentIdx, POWERUP_TYPES.FRENZY)) return 3.0;
    return 1.0;
  }

  /** Does this serpent skip boost drain? */
  skipBoostDrain(serpentIdx) {
    return this.hasEffect(serpentIdx, POWERUP_TYPES.FRENZY);
  }

  /** Is this serpent phased (no collision)? */
  isPhased(serpentIdx) {
    return this.hasEffect(serpentIdx, POWERUP_TYPES.PHASE);
  }

  /** Does this serpent have magnet? */
  hasMagnet(serpentIdx) {
    return this.hasEffect(serpentIdx, POWERUP_TYPES.MAGNET);
  }

  /** Does this serpent have venom (reverses collision) */
  hasVenom(serpentIdx) {
    return this.hasEffect(serpentIdx, POWERUP_TYPES.VENOM);
  }

  /** Get tint color overlay for HUD */
  getHUDColor(serpentIdx) {
    const e = this._active.get(serpentIdx);
    if (!e) return null;
    return { kind: e.kind, timeLeft: e.timeLeft, duration: POWERUP_DURATIONS[e.kind], color: e.color };
  }
}

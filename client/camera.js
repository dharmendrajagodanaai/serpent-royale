import * as THREE from 'three';
import { getTerrainHeight } from './terrain.js';

export class CameraController {
  constructor(camera) {
    this.camera = camera;
    this._targetPos = new THREE.Vector3();
    this._lookAt = new THREE.Vector3();
    this._currentLook = new THREE.Vector3();
    this._deathPos = new THREE.Vector3();
    this._deathOrbitAngle = 0;
    this._deadMode = false;

    // Scroll wheel zoom: 0.5x – 2x of base distances
    this._zoomFactor = 1.0;
    this._targetZoom = 1.0;
    window.addEventListener('wheel', e => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.12 : -0.12;
      this._targetZoom = Math.max(0.5, Math.min(2.0, this._targetZoom + delta));
    }, { passive: false });
  }

  // Called when player dies — begin orbiting around death position
  setDeathMode(x, z) {
    this._deathPos.set(x, 0, z);
    this._deathOrbitAngle = Math.atan2(
      this.camera.position.z - z,
      this.camera.position.x - x
    );
    this._deadMode = true;
  }

  update(serpent, dt) {
    if (this._deadMode) {
      // Slowly orbit around death position
      this._deathOrbitAngle += dt * 0.35;
      const r = 20;
      const h = 12;
      const tx = this._deathPos.x + Math.cos(this._deathOrbitAngle) * r;
      const tz = this._deathPos.z + Math.sin(this._deathOrbitAngle) * r;
      this._targetPos.set(tx, h, tz);
      this.camera.position.lerp(this._targetPos, 0.04);
      this._currentLook.lerp(this._deathPos, 0.08);
      this.camera.lookAt(this._currentLook);
      return;
    }

    if (!serpent || !serpent.alive) return;

    // Smooth zoom interpolation
    this._zoomFactor += (this._targetZoom - this._zoomFactor) * Math.min(1, dt * 5);
    const zoom = this._zoomFactor;

    const hx = serpent.headPos.x;
    const hz = serpent.headPos.z;
    const dx = serpent.headDir.x;
    const dz = serpent.headDir.z;

    // Chase camera: behind and above head (scale distances by zoom)
    const backDist = (serpent.boosting ? 14 : 11) * zoom;
    const heightOff = (serpent.boosting ? 9 : 7.5) * zoom;
    const lookAheadDist = 5;

    const bx = hx - dx * backDist;
    const bz = hz - dz * backDist;
    const terrainY = getTerrainHeight(bx, bz);

    this._targetPos.set(bx, terrainY + heightOff, bz);

    // Smooth camera movement
    const lerpSpeed = serpent.boosting ? 0.12 : 0.08;
    this.camera.position.lerp(this._targetPos, lerpSpeed);

    // Look ahead
    this._lookAt.set(
      hx + dx * lookAheadDist,
      getTerrainHeight(hx, hz) + 1.2,
      hz + dz * lookAheadDist
    );
    this._currentLook.lerp(this._lookAt, 0.15);
    this.camera.lookAt(this._currentLook);
  }

  // Hard reset (used on spawn)
  reset(serpent) {
    this._deadMode = false;
    if (!serpent) return;
    const hx = serpent.headPos.x;
    const hz = serpent.headPos.z;
    const dx = serpent.headDir.x;
    const dz = serpent.headDir.z;
    const bx = hx - dx * 11;
    const bz = hz - dz * 11;
    this.camera.position.set(bx, getTerrainHeight(bx, bz) + 8, bz);
    this._currentLook.set(hx, getTerrainHeight(hx, hz) + 1, hz);
    this.camera.lookAt(this._currentLook);
  }
}

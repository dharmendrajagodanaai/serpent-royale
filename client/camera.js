import * as THREE from 'three';
import { getTerrainHeight } from './terrain.js';

export class CameraController {
  constructor(camera) {
    this.camera = camera;
    this._targetPos = new THREE.Vector3();
    this._lookAt = new THREE.Vector3();
    this._currentLook = new THREE.Vector3();
  }

  update(serpent, dt) {
    if (!serpent || !serpent.alive) return;

    const hx = serpent.headPos.x;
    const hz = serpent.headPos.z;
    const dx = serpent.headDir.x;
    const dz = serpent.headDir.z;

    // Chase camera: behind and above head
    const backDist = serpent.boosting ? 14 : 11;
    const heightOff = serpent.boosting ? 9 : 7.5;
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

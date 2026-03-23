import * as THREE from 'three';
import { CAMERA_HEIGHT, CAMERA_DISTANCE, CAMERA_LERP, CAMERA_FOV, CAMERA_BOOST_FOV } from './constants.js';

export class CameraController {
  constructor(renderer) {
    const aspect = window.innerWidth / window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(CAMERA_FOV, aspect, 0.5, 1200);
    this.camera.position.set(0, CAMERA_HEIGHT, CAMERA_DISTANCE);
    this.camera.lookAt(0, 0, 0);

    this._targetPos = new THREE.Vector3();
    this._currentPos = new THREE.Vector3(0, CAMERA_HEIGHT, CAMERA_DISTANCE);
    this._currentLook = new THREE.Vector3();
    this._targetLook = new THREE.Vector3();
    this._fov = CAMERA_FOV;

    // Scroll wheel zoom: 0.5x – 2x of defaults
    this._zoomFactor = 1.0;
    this._targetZoom = 1.0;
    window.addEventListener('wheel', e => {
      e.preventDefault();
      const delta = e.deltaY > 0 ? 0.12 : -0.12;
      this._targetZoom = Math.max(0.5, Math.min(2.0, this._targetZoom + delta));
    }, { passive: false });

    window.addEventListener('resize', () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
    });
  }

  update(dt, headPos, headAngle, boosting, terrain) {
    if (!headPos) return;

    // Smooth zoom interpolation
    this._zoomFactor += (this._targetZoom - this._zoomFactor) * Math.min(1, dt * 5);
    const zoom = this._zoomFactor;

    // Camera sits behind and above head
    const sinA = Math.sin(headAngle);
    const cosA = Math.cos(headAngle);

    this._targetPos.set(
      headPos.x - sinA * CAMERA_DISTANCE * zoom,
      headPos.y + CAMERA_HEIGHT * zoom,
      headPos.z - cosA * CAMERA_DISTANCE * zoom,
    );

    // Clamp camera height to terrain + min height
    const camTerrainY = terrain ? terrain.getHeight(this._targetPos.x, this._targetPos.z) : 0;
    this._targetPos.y = Math.max(camTerrainY + 6, this._targetPos.y);

    this._targetLook.set(
      headPos.x + sinA * 8,
      headPos.y + 1,
      headPos.z + cosA * 8,
    );

    // Smooth follow
    const lerpFactor = Math.min(1, CAMERA_LERP * dt);
    this._currentPos.lerp(this._targetPos, lerpFactor);
    this._currentLook.lerp(this._targetLook, lerpFactor * 1.2);

    this.camera.position.copy(this._currentPos);
    this.camera.lookAt(this._currentLook);

    // FOV adjustment for boost
    const targetFov = boosting ? CAMERA_BOOST_FOV : CAMERA_FOV;
    this._fov += (targetFov - this._fov) * Math.min(1, dt * 4);
    this.camera.fov = this._fov;
    this.camera.updateProjectionMatrix();
  }
}

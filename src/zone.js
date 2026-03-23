import * as THREE from 'three';
import { ZONE_PHASES, ZONE_RADIUS_START } from './constants.js';

export class ZoneManager {
  constructor(scene) {
    this.scene = scene;
    this.phases = ZONE_PHASES;
    this.phaseIndex = 0;
    this.phaseTimer = 0;
    this.currentRadius = ZONE_RADIUS_START;
    this.targetRadius = ZONE_RADIUS_START;
    this.shrinking = false;
    this.center = new THREE.Vector2(0, 0);
    this.active = false;
    this.totalTime = 0;

    this._wall = this._createWall();
    scene.add(this._wall);

    this._floor = this._createFloor();
    scene.add(this._floor);

    // Update scale immediately
    this._updateScale();
  }

  start() {
    this.active = true;
    this.phaseIndex = 0;
    this.phaseTimer = 0;
    this.currentRadius = ZONE_RADIUS_START;
    this.targetRadius = ZONE_RADIUS_START;
    this.totalTime = 0;
    this._updateScale();
  }

  update(dt) {
    this._wall.material.uniforms.time.value += dt;
    if (!this.active) return;

    this.totalTime += dt;
    this.phaseTimer += dt;
    const phase = this.phases[this.phaseIndex];
    if (!phase) return;

    const progress = this.phaseTimer / phase.duration;

    if (this.phaseTimer >= phase.duration) {
      this.phaseTimer = 0;
      this.phaseIndex++;
      const next = this.phases[this.phaseIndex];
      if (next) this.targetRadius = next.size / 2;
      this.shrinking = true;
    }

    // Smooth shrink toward target
    if (Math.abs(this.currentRadius - this.targetRadius) > 0.05) {
      this.currentRadius += (this.targetRadius - this.currentRadius) * Math.min(1, dt * 1.5);
    } else {
      this.currentRadius = this.targetRadius;
    }

    this._updateScale();
  }

  _updateScale() {
    const r = this.currentRadius;
    this._wall.scale.set(r, 1, r);
    this._floor.scale.set(r, r, 1);
  }

  isInZone(x, z) {
    const dx = x - this.center.x;
    const dz = z - this.center.y;
    return Math.sqrt(dx * dx + dz * dz) < this.currentRadius;
  }

  distanceToEdge(x, z) {
    const dx = x - this.center.x;
    const dz = z - this.center.y;
    return this.currentRadius - Math.sqrt(dx * dx + dz * dz);
  }

  getPhaseInfo() {
    const phase = this.phases[this.phaseIndex];
    return {
      phase: this.phaseIndex,
      timeLeft: phase ? phase.duration - this.phaseTimer : 0,
      totalTime: this.totalTime,
      radius: this.currentRadius,
      shrinking: this.shrinking,
    };
  }

  _createWall() {
    // Tall cylinder open on top and bottom
    const geo = new THREE.CylinderGeometry(1, 1, 35, 72, 4, true);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        time:    { value: 0 },
        color:   { value: new THREE.Color(1.0, 0.18, 0.28) },
        opacity: { value: 0.22 },
      },
      vertexShader: ZONE_VERT,
      fragmentShader: ZONE_FRAG,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = 12; // center vertically
    return mesh;
  }

  _createFloor() {
    // Safe zone floor circle
    const geo = new THREE.CircleGeometry(1, 72);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x002211,
      transparent: true,
      opacity: 0.08,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.05;
    return mesh;
  }
}

const ZONE_VERT = /* glsl */`
  varying vec2 vUv;
  varying vec3 vPos;
  void main() {
    vUv  = uv;
    vPos = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const ZONE_FRAG = /* glsl */`
  uniform float time;
  uniform vec3  color;
  uniform float opacity;
  varying vec2  vUv;
  varying vec3  vPos;

  void main() {
    // Vertical scan lines
    float scanSpeed = time * 2.5;
    float scan = sin(vUv.y * 60.0 + scanSpeed) * 0.5 + 0.5;
    scan = pow(scan, 3.0);

    // Edge glow (top and bottom fade)
    float topEdge = smoothstep(1.0, 0.85, vUv.y);
    float botEdge = smoothstep(0.0, 0.15, vUv.y);
    float edgeMask = topEdge * botEdge;

    // Pulsing brightness
    float pulse = sin(time * 1.8) * 0.3 + 0.7;

    // Hexagonal flicker along horizontal
    float hex = sin(vUv.x * 80.0 + time * 3.0) * 0.5 + 0.5;
    float brightness = (0.4 + scan * 0.4 + hex * 0.15) * pulse;

    float alpha = opacity * edgeMask * (0.6 + brightness * 0.4);
    gl_FragColor = vec4(color * brightness, alpha);
  }
`;

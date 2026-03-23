import * as THREE from 'three';
import { ARENA_RADIUS } from './constants.js';

/**
 * Fixed circular boundary — replaces the old shrinking zone.
 * Renders a glowing energy wall at ARENA_RADIUS.
 */
export class BoundaryManager {
  constructor(scene) {
    this.scene = scene;
    this.radius = ARENA_RADIUS;

    // Glowing wall cylinder
    this._wall = this._createWall();
    scene.add(this._wall);

    // Warning floor ring near edge
    this._warningRing = this._createWarningRing();
    scene.add(this._warningRing);
  }

  update(dt) {
    this._wall.material.uniforms.time.value += dt;
    this._warningRing.material.uniforms.time.value += dt;
  }

  isInBounds(x, z) {
    return (x * x + z * z) < this.radius * this.radius;
  }

  distanceToEdge(x, z) {
    return this.radius - Math.sqrt(x * x + z * z);
  }

  _createWall() {
    const geo = new THREE.CylinderGeometry(this.radius, this.radius, 40, 96, 6, true);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        time:    { value: 0 },
        color:   { value: new THREE.Color(0.0, 0.65, 1.0) }, // electric cyan-blue
        opacity: { value: 0.25 },
      },
      vertexShader: WALL_VERT,
      fragmentShader: WALL_FRAG,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.y = 15;
    return mesh;
  }

  _createWarningRing() {
    // Flat ring on the ground near the boundary edge
    const innerR = this.radius - 15;
    const outerR = this.radius + 2;
    const geo = new THREE.RingGeometry(innerR, outerR, 96);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        time:   { value: 0 },
        innerR: { value: innerR },
        outerR: { value: outerR },
      },
      vertexShader: RING_VERT,
      fragmentShader: RING_FRAG,
      transparent: true,
      depthWrite: false,
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.08;
    return mesh;
  }
}

// ─── Wall Shaders ──────────────────────────────────────────────────────────

const WALL_VERT = /* glsl */`
  varying vec2 vUv;
  varying vec3 vPos;
  void main() {
    vUv  = uv;
    vPos = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const WALL_FRAG = /* glsl */`
  uniform float time;
  uniform vec3  color;
  uniform float opacity;
  varying vec2  vUv;
  varying vec3  vPos;

  void main() {
    // Vertical scan lines
    float scanSpeed = time * 2.0;
    float scan = sin(vUv.y * 50.0 + scanSpeed) * 0.5 + 0.5;
    scan = pow(scan, 2.5);

    // Edge glow (top and bottom fade)
    float topEdge = smoothstep(1.0, 0.8, vUv.y);
    float botEdge = smoothstep(0.0, 0.2, vUv.y);
    float edgeMask = topEdge * botEdge;

    // Pulsing brightness
    float pulse = sin(time * 1.5) * 0.25 + 0.75;

    // Hexagonal flicker along horizontal
    float hex = sin(vUv.x * 120.0 + time * 2.5) * 0.5 + 0.5;

    // Horizontal wave bands
    float wave = sin(vUv.y * 20.0 - time * 3.0) * 0.5 + 0.5;
    wave = pow(wave, 4.0);

    float brightness = (0.3 + scan * 0.35 + hex * 0.15 + wave * 0.2) * pulse;
    float alpha = opacity * edgeMask * (0.5 + brightness * 0.5);

    // Add emissive glow near center height
    float centerGlow = 1.0 - abs(vUv.y - 0.35) * 2.0;
    centerGlow = max(0.0, centerGlow);
    alpha += centerGlow * 0.08 * pulse;

    gl_FragColor = vec4(color * brightness * 1.5, alpha);
  }
`;

// ─── Warning Ring Shaders ──────────────────────────────────────────────────

const RING_VERT = /* glsl */`
  varying vec2 vWorldXZ;
  void main() {
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldXZ = worldPos.xz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const RING_FRAG = /* glsl */`
  uniform float time;
  uniform float innerR;
  uniform float outerR;

  varying vec2 vWorldXZ;

  void main() {
    float dist = length(vWorldXZ);
    // Gradient: transparent at inner edge, glowing at outer edge
    float t = clamp((dist - innerR) / (outerR - innerR), 0.0, 1.0);
    float pulse = sin(time * 2.0 + dist * 0.3) * 0.3 + 0.7;

    vec3 col = vec3(0.0, 0.5, 0.9) * pulse;
    float alpha = t * t * 0.18 * pulse;

    gl_FragColor = vec4(col, alpha);
  }
`;

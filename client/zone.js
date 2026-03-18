import * as THREE from 'three';

const PHASES = [
  { size: 200, duration: 30 },
  { size: 160, duration: 30 },
  { size: 120, duration: 30 },
  { size: 80,  duration: 30 },
  { size: 50,  duration: 30 },
  { size: 25,  duration: 30 },
  { size: 10,  duration: 60 },
];

export class ZoneManager {
  constructor(scene) {
    this.scene = scene;
    this.currentPhase = 0;
    this.currentSize = PHASES[0].size;
    this.targetSize = PHASES[0].size;
    this.phaseTimer = 0;
    this.center = { x: 0, z: 0 };
    this._buildWall();
    this._buildFloor();
  }

  _buildWall() {
    const geo = new THREE.CylinderGeometry(1, 1, 35, 80, 3, true);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
      uniforms: {
        time: { value: 0 },
        color: { value: new THREE.Color(1.0, 0.15, 0.25) },
        opacity: { value: 0.18 }
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float time;
        uniform vec3 color;
        uniform float opacity;
        varying vec2 vUv;
        void main() {
          float scanline = sin(vUv.y * 60.0 - time * 4.0) * 0.4 + 0.6;
          float topEdge = smoothstep(0.0, 0.08, vUv.y);
          float botEdge = smoothstep(1.0, 0.92, vUv.y);
          float edge = topEdge * botEdge;
          float brightness = scanline * edge;
          // Horizontal shimmer
          float shimmer = sin(vUv.x * 40.0 + time * 8.0) * 0.05 + 0.95;
          gl_FragColor = vec4(color * brightness * shimmer, opacity * edge * (brightness * 0.5 + 0.5));
        }
      `
    });
    this.wallMesh = new THREE.Mesh(geo, mat);
    this.wallMesh.position.y = 10;
    this.scene.add(this.wallMesh);
    this.wallMat = mat;

    // Outer glow ring (flat circle on ground)
    const ringGeo = new THREE.RingGeometry(0.9, 1.05, 80);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xff3040, transparent: true, opacity: 0.5, side: THREE.DoubleSide
    });
    this.ringMesh = new THREE.Mesh(ringGeo, ringMat);
    this.ringMesh.position.y = 0.1;
    this.scene.add(this.ringMesh);
  }

  _buildFloor() {
    // Transparent circle showing safe zone floor
    const geo = new THREE.CircleGeometry(1, 80);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({
      color: 0x001122,
      transparent: true, opacity: 0.0
    });
    this.floorMesh = new THREE.Mesh(geo, mat);
    this.floorMesh.position.y = -0.05;
    this.scene.add(this.floorMesh);
  }

  get timeUntilNextPhase() {
    const phase = PHASES[this.currentPhase];
    return phase ? Math.max(0, phase.duration - this.phaseTimer) : 0;
  }

  get phaseIndex() { return this.currentPhase; }
  get phaseDuration() { return PHASES[this.currentPhase]?.duration ?? 30; }

  isInZone(x, z) {
    const dx = x - this.center.x;
    const dz = z - this.center.z;
    return Math.sqrt(dx * dx + dz * dz) < this.currentSize * 0.5;
  }

  update(dt) {
    const phase = PHASES[this.currentPhase];
    if (!phase) return;

    this.phaseTimer += dt;
    if (this.phaseTimer >= phase.duration) {
      this.currentPhase = Math.min(this.currentPhase + 1, PHASES.length - 1);
      this.phaseTimer = 0;
      this.targetSize = PHASES[this.currentPhase].size;
    }

    // Smooth shrink
    this.currentSize += (this.targetSize - this.currentSize) * 0.025;

    const r = this.currentSize * 0.5;
    // Update wall geometry scale
    this.wallMesh.scale.set(r, 1, r);
    this.ringMesh.scale.set(r, 1, r);
    this.floorMesh.scale.set(r, 1, r);

    this.wallMat.uniforms.time.value += dt;

    // Pulse opacity based on how close next phase is
    const ratio = this.phaseTimer / phase.duration;
    const pulse = ratio > 0.8 ? 0.18 + Math.sin(this.wallMat.uniforms.time.value * 6) * 0.08 : 0.12;
    this.wallMat.uniforms.opacity.value = pulse;
  }
}

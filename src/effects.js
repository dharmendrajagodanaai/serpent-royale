import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass }     from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass }     from 'three/addons/postprocessing/ShaderPass.js';
import { SMAAPass }       from 'three/addons/postprocessing/SMAAPass.js';

const VIGNETTE_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    offset:   { value: 0.88 },
    darkness: { value: 1.1 },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float offset;
    uniform float darkness;
    varying vec2 vUv;
    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      vec2 uv = (vUv - 0.5) * 2.0;
      float vignette = 1.0 - smoothstep(offset, offset * 1.4, length(uv));
      gl_FragColor = vec4(mix(color.rgb * (1.0 - darkness * 0.12), color.rgb, vignette), color.a);
    }
  `,
};

// ─── Particle explosion ───────────────────────────────────────────────────────

class DeathExplosion {
  constructor(scene, x, y, z, color, count) {
    this.scene = scene;
    this.alive = true;
    this.age   = 0;
    this.duration = 1.5;

    const positions  = new Float32Array(count * 3);
    const velocities = [];

    for (let i = 0; i < count; i++) {
      positions[i * 3]     = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
      velocities.push(new THREE.Vector3(
        (Math.random() - 0.5) * 18,
        Math.random() * 10 + 3,
        (Math.random() - 0.5) * 18,
      ));
    }

    this.velocities = velocities;
    this.count = count;
    this.posArray = positions;

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    this.geo = geo;

    const mat = new THREE.PointsMaterial({
      color,
      size: 0.5,
      transparent: true,
      opacity: 1.0,
      sizeAttenuation: true,
      depthWrite: false,
    });
    this.mat = mat;
    this.points = new THREE.Points(geo, mat);
    scene.add(this.points);
  }

  update(dt) {
    this.age += dt;
    const t = this.age / this.duration;
    this.mat.opacity = 1 - t;

    for (let i = 0; i < this.count; i++) {
      const v = this.velocities[i];
      this.posArray[i * 3]     += v.x * dt;
      this.posArray[i * 3 + 1] += (v.y - 12 * this.age) * dt; // gravity
      this.posArray[i * 3 + 2] += v.z * dt;
      v.x *= 0.98; v.z *= 0.98; // drag
    }
    this.geo.attributes.position.needsUpdate = true;

    if (this.age >= this.duration) {
      this.scene.remove(this.points);
      this.alive = false;
    }
  }
}

// ─── Skybox (procedural starfield) ───────────────────────────────────────────

function createSkybox(scene) {
  const starCount = 3000;
  const positions = new Float32Array(starCount * 3);
  const colors    = new Float32Array(starCount * 3);

  for (let i = 0; i < starCount; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi   = Math.acos(2 * Math.random() - 1);
    const r     = 500 + Math.random() * 300;
    positions[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = Math.abs(r * Math.cos(phi)); // above horizon
    positions[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);

    const brightness = 0.6 + Math.random() * 0.4;
    const tint = Math.random();
    colors[i * 3]     = tint > 0.7 ? brightness * 0.8 : brightness;
    colors[i * 3 + 1] = tint > 0.85 ? brightness * 0.8 : brightness;
    colors[i * 3 + 2] = tint < 0.3 ? brightness * 0.7 : brightness;
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('color',    new THREE.BufferAttribute(colors, 3));
  const mat = new THREE.PointsMaterial({
    vertexColors: true,
    size: 1.2,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
  });
  scene.add(new THREE.Points(geo, mat));
}

// ─── EffectsManager ──────────────────────────────────────────────────────────

export class EffectsManager {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    this.scene    = scene;
    this.camera   = camera;

    this._explosions = [];

    // Composer
    const size = renderer.getSize(new THREE.Vector2());
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));

    const bloom = new UnrealBloomPass(
      new THREE.Vector2(size.x, size.y),
      0.85,   // strength
      0.55,   // radius
      0.42,   // threshold
    );
    this.composer.addPass(bloom);
    this.bloom = bloom;

    const smaa = new SMAAPass(size.x, size.y);
    this.composer.addPass(smaa);

    const vignette = new ShaderPass(VIGNETTE_SHADER);
    this.composer.addPass(vignette);

    // Skybox
    createSkybox(scene);

    window.addEventListener('resize', () => {
      const w = window.innerWidth, h = window.innerHeight;
      this.composer.setSize(w, h);
      bloom.setSize(w, h);
      smaa.setSize(w, h);
    });
  }

  spawnDeathExplosion(x, y, z, color, count = 60) {
    this._explosions.push(new DeathExplosion(this.scene, x, y, z, color, count));
  }

  update(dt) {
    for (let i = this._explosions.length - 1; i >= 0; i--) {
      this._explosions[i].update(dt);
      if (!this._explosions[i].alive) this._explosions.splice(i, 1);
    }
  }

  render() {
    this.composer.render();
  }
}

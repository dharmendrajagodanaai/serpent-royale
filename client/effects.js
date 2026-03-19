import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

// ─── Post-processing ─────────────────────────────────────────────────────────

const VignetteShader = {
  uniforms: { tDiffuse: { value: null }, intensity: { value: 0.6 } },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float intensity;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 uv = vUv - 0.5;
      float d = dot(uv, uv);
      float v = 1.0 - d * intensity * 3.2;
      gl_FragColor = vec4(c.rgb * clamp(v, 0.0, 1.0), c.a);
    }
  `
};

export function buildComposer(renderer, scene, camera) {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  const bloom = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    0.9,   // strength
    0.4,   // radius
    0.6    // threshold
  );
  composer.addPass(bloom);

  const vignette = new ShaderPass(VignetteShader);
  composer.addPass(vignette);

  return composer;
}

// ─── Death Particles ─────────────────────────────────────────────────────────

const MAX_PARTICLE_SYSTEMS = 16;
const PARTICLES_PER_EXPLOSION = 40;

export class ParticleSystem {
  constructor(scene) {
    this.scene = scene;
    this._explosions = [];
  }

  spawnExplosion(x, y, z, color = 0xff4422) {
    const count = PARTICLES_PER_EXPLOSION;
    const positions = new Float32Array(count * 3);
    const velocities = [];

    for (let i = 0; i < count; i++) {
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;

      const angle = Math.random() * Math.PI * 2;
      const elev = (Math.random() - 0.3) * Math.PI;
      const speed = 3 + Math.random() * 8;
      velocities.push({
        x: Math.cos(angle) * Math.cos(elev) * speed,
        y: Math.sin(elev) * speed + 2,
        z: Math.sin(angle) * Math.cos(elev) * speed
      });
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color, size: 0.4, transparent: true, opacity: 1.0,
      depthWrite: false // prevent particles from occluding game objects
    });
    const points = new THREE.Points(geo, mat);
    this.scene.add(points);

    this._explosions.push({
      points, positions, velocities,
      color: new THREE.Color(color),
      life: 1.5, maxLife: 1.5
    });

    // Limit active explosions
    if (this._explosions.length > MAX_PARTICLE_SYSTEMS) {
      const old = this._explosions.shift();
      this.scene.remove(old.points);
    }
  }

  update(dt) {
    for (let i = this._explosions.length - 1; i >= 0; i--) {
      const ex = this._explosions[i];
      ex.life -= dt;

      if (ex.life <= 0) {
        this.scene.remove(ex.points);
        ex.points.geometry.dispose();
        this._explosions.splice(i, 1);
        continue;
      }

      const alpha = ex.life / ex.maxLife;
      ex.points.material.opacity = alpha;
      ex.points.material.size = 0.35 * (0.5 + alpha * 0.5);

      const pos = ex.positions;
      for (let j = 0; j < ex.velocities.length; j++) {
        const v = ex.velocities[j];
        pos[j * 3] += v.x * dt;
        pos[j * 3 + 1] += v.y * dt;
        pos[j * 3 + 2] += v.z * dt;
        v.y -= 9.8 * dt; // gravity
      }
      ex.points.geometry.attributes.position.needsUpdate = true;
    }
  }
}

// ─── Trail system ─────────────────────────────────────────────────────────────

export class TrailSystem {
  constructor(scene, maxTrails = 8, pointsPerTrail = 30) {
    this.scene = scene;
    this.trails = [];
    this.maxPoints = pointsPerTrail;
    this._glowColor = new THREE.Color();

    for (let i = 0; i < maxTrails; i++) {
      const pts = [];
      for (let j = 0; j < pointsPerTrail; j++) pts.push(new THREE.Vector3());

      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const mat = new THREE.LineBasicMaterial({
        color: 0x00ffcc, transparent: true, opacity: 0.3,
        depthWrite: false // prevent transparent trails from occluding objects
      });
      const line = new THREE.Line(geo, mat);
      line.frustumCulled = false; // trail spans map; prevent culling
      line.visible = false;
      this.scene.add(line);
      this.trails.push({ line, pts, color: 0x00ffcc });
    }
  }

  update(serpents) {
    // BUG 6 fix: use serpent.id as trail index to avoid mismatches after death
    const used = new Set();
    for (const s of serpents) {
      const idx = s.id;
      if (idx >= this.trails.length) continue;
      const trail = this.trails[idx];

      if (!s.alive) {
        trail.line.visible = false;
        continue;
      }

      trail.line.visible = true;
      if (s.boosting) {
        // Brighter glow trail when boosting
        this._glowColor.copy(s.color).lerp(new THREE.Color(1, 1, 1), 0.45);
        trail.line.material.color.set(this._glowColor);
        trail.line.material.opacity = 0.82;
      } else {
        trail.line.material.color.set(s.color);
        trail.line.material.opacity = 0.2;
      }
      used.add(idx);

      // Fill trail points from path
      const pathLen = s.path.positions.length;
      for (let j = 0; j < this.maxPoints; j++) {
        const pi = pathLen - 1 - j;
        if (pi >= 0) {
          const p = s.path.positions[pi];
          trail.pts[j].set(p.x, 0.3, p.z);
        } else {
          trail.pts[j].copy(trail.pts[j - 1] || trail.pts[0]);
        }
      }

      trail.line.geometry.setFromPoints(trail.pts);
    }

    // Hide trails not assigned to any alive serpent
    for (let i = 0; i < this.trails.length; i++) {
      if (!used.has(i)) this.trails[i].line.visible = false;
    }
  }
}

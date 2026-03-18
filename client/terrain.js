import * as THREE from 'three';

// ─── Value Noise / FBM ──────────────────────────────────────────────────────

function hash(x, y) {
  let h = Math.imul(x * 374761393 + y * 668265263, 1) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 0xffffffff;
}

function smoothstep(t) { return t * t * (3 - 2 * t); }

function valueNoise(x, y) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const ux = smoothstep(fx), uy = smoothstep(fy);
  const a = hash(ix, iy);
  const b = hash(ix + 1, iy);
  const c = hash(ix, iy + 1);
  const d = hash(ix + 1, iy + 1);
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

function fbm(x, y, octaves = 5) {
  let value = 0, amp = 0.5, freq = 1, max = 0;
  for (let i = 0; i < octaves; i++) {
    value += valueNoise(x * freq, y * freq) * amp;
    max += amp; amp *= 0.5; freq *= 2.1;
  }
  return value / max;
}

// Public height function — used by camera, serpent, etc.
export function getTerrainHeight(x, z) {
  // Flat center area (arena), then hills at edges
  const nx = x / 80, nz = z / 80;
  const base = fbm(nx + 3.7, nz + 1.3, 5);
  const detail = valueNoise(x / 20 + 1.1, z / 20 + 2.2) * 0.3;
  // Flatten arena center
  const d = Math.sqrt(x * x + z * z) / 120;
  const flatten = 1 - Math.exp(-d * d * 4);
  return (base + detail * 0.4 - 0.5) * 14 * flatten;
}

// ─── Terrain Mesh ───────────────────────────────────────────────────────────

export class Terrain {
  constructor(scene) {
    this.scene = scene;
    this._buildMesh();
    this._buildSkybox();
    this._buildFogParticles();
  }

  _buildMesh() {
    const size = 240, segs = 120;
    const geo = new THREE.PlaneGeometry(size, size, segs, segs);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);

    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const y = getTerrainHeight(x, z);
      pos.setY(i, y);

      // Color gradient: dark base, teal-highlighted high points
      const t = Math.max(0, Math.min(1, (y + 6) / 12));
      const r = 0.03 + t * 0.04;
      const g = 0.06 + t * 0.12;
      const b = 0.10 + t * 0.18;
      colors[i * 3] = r; colors[i * 3 + 1] = g; colors[i * 3 + 2] = b;
    }

    geo.computeVertexNormals();
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mat = new THREE.ShaderMaterial({
      vertexColors: true,
      uniforms: {
        time: { value: 0 }
      },
      vertexShader: `
        varying vec3 vColor;
        varying vec3 vWorldPos;
        varying vec3 vNormal;
        void main() {
          vColor = color;
          vWorldPos = (modelMatrix * vec4(position, 1.0)).xyz;
          vNormal = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform float time;
        varying vec3 vColor;
        varying vec3 vWorldPos;
        varying vec3 vNormal;

        // Hexagonal grid
        vec2 hexCoord(vec2 p) {
          float q = (2.0/3.0) * p.x;
          float r = (-1.0/3.0) * p.x + (sqrt(3.0)/3.0) * p.y;
          return vec2(q, r);
        }
        float hexDist(vec2 p) {
          p = abs(p);
          return max(dot(p, normalize(vec2(1.0, 1.732051))), p.x);
        }
        vec4 hexGrid(vec2 p, float scale) {
          p *= scale;
          vec2 r = vec2(1.0, 1.7320508);
          vec2 h = r * 0.5;
          vec2 a = mod(p, r) - h;
          vec2 b = mod(p - h, r) - h;
          vec2 gv = dot(a,a) < dot(b,b) ? a : b;
          float d = hexDist(gv);
          float edge = 1.0 - smoothstep(0.43, 0.47, d);
          return vec4(gv, d, edge);
        }

        void main() {
          // Hex grid overlay
          vec4 hx = hexGrid(vWorldPos.xz, 0.3);
          float grid = hx.w * 0.25;

          // Subtle animated pulse along grid edges
          float pulse = sin(time * 0.8 + length(vWorldPos.xz) * 0.05) * 0.5 + 0.5;

          // Lighting
          vec3 light = normalize(vec3(0.5, 1.0, 0.3));
          float diff = max(dot(vNormal, light), 0.0) * 0.5 + 0.15;

          // Arena boundary indicator (soft red ring at zone edge - handled in zone.js)
          vec3 baseCol = vColor * (diff + 0.1);
          vec3 gridCol = vec3(0.0, 0.4, 0.6) * grid * pulse;

          gl_FragColor = vec4(baseCol + gridCol, 1.0);
        }
      `
    });

    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.receiveShadow = true;
    this.scene.add(this.mesh);
    this.mat = mat;
  }

  _buildSkybox() {
    const geo = new THREE.SphereGeometry(490, 32, 32);
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      vertexShader: `
        varying vec3 vPos;
        void main() { vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: `
        varying vec3 vPos;
        float hash3(vec3 p) {
          return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453);
        }
        void main() {
          vec3 dir = normalize(vPos);
          // Gradient sky
          float t = dir.y * 0.5 + 0.5;
          vec3 sky = mix(vec3(0.0, 0.02, 0.08), vec3(0.0, 0.0, 0.02), t);

          // Stars
          vec3 starUV = dir * 120.0;
          vec3 starCell = floor(starUV);
          vec3 starFrac = fract(starUV);
          float star = hash3(starCell);
          float brightness = step(0.972, star) * (1.0 - length(starFrac - 0.5) * 3.0);
          brightness = max(0.0, brightness);

          // Twinkle
          float twinkle = hash3(starCell + vec3(0.1)) * 2.0 - 1.0;
          brightness *= 0.7 + 0.3 * twinkle;

          gl_FragColor = vec4(sky + vec3(brightness), 1.0);
        }
      `
    });
    this.skybox = new THREE.Mesh(geo, mat);
    this.scene.add(this.skybox);
  }

  _buildFogParticles() {
    // Void particles at terrain boundary edges
    const count = 300;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = 115 + Math.random() * 20;
      positions[i * 3] = Math.cos(angle) * r;
      positions[i * 3 + 1] = -5 + Math.random() * 10;
      positions[i * 3 + 2] = Math.sin(angle) * r;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0x003344, size: 3, transparent: true, opacity: 0.4
    });
    this.edgeFog = new THREE.Points(geo, mat);
    this.scene.add(this.edgeFog);
  }

  update(time) {
    this.mat.uniforms.time.value = time;
  }
}

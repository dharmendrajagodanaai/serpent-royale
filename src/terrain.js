import * as THREE from 'three';
import { terrainHeight } from './noise.js';
import { ARENA_SIZE, ARENA_RADIUS, TERRAIN_SEGMENTS } from './constants.js';

const VERT = TERRAIN_SEGMENTS + 1;

export class Terrain {
  constructor(scene) {
    this.scene = scene;
    this.size = ARENA_SIZE;
    this.segments = TERRAIN_SEGMENTS;

    // Pre-compute height grid for CPU queries
    this._heights = new Float32Array(VERT * VERT);
    this._buildHeightGrid();

    this._mesh = this._createMesh();
    scene.add(this._mesh);

    // Void plane far below
    const voidGeo = new THREE.PlaneGeometry(2000, 2000);
    const voidMat = new THREE.MeshBasicMaterial({ color: 0x000005 });
    const voidPlane = new THREE.Mesh(voidGeo, voidMat);
    voidPlane.rotation.x = -Math.PI / 2;
    voidPlane.position.y = -12;
    scene.add(voidPlane);

    // Fog particles at edges
    this._addEdgeFog(scene);
  }

  _buildHeightGrid() {
    for (let j = 0; j < VERT; j++) {
      for (let i = 0; i < VERT; i++) {
        const x = (i / this.segments - 0.5) * this.size;
        const z = (j / this.segments - 0.5) * this.size;
        this._heights[j * VERT + i] = terrainHeight(x, z);
      }
    }
  }

  /** Bilinear-interpolated height query */
  getHeight(x, z) {
    const u = (x / this.size + 0.5) * this.segments;
    const v = (z / this.size + 0.5) * this.segments;
    const i0 = Math.max(0, Math.min(this.segments - 1, Math.floor(u)));
    const j0 = Math.max(0, Math.min(this.segments - 1, Math.floor(v)));
    const i1 = i0 + 1;
    const j1 = j0 + 1;
    const fu = u - i0;
    const fv = v - j0;
    const h00 = this._heights[j0 * VERT + i0];
    const h10 = this._heights[j0 * VERT + i1];
    const h01 = this._heights[j1 * VERT + i0];
    const h11 = this._heights[j1 * VERT + i1];
    return h00 * (1 - fu) * (1 - fv)
         + h10 * fu * (1 - fv)
         + h01 * (1 - fu) * fv
         + h11 * fu * fv;
  }

  _createMesh() {
    const geo = new THREE.PlaneGeometry(this.size, this.size, this.segments, this.segments);
    geo.rotateX(-Math.PI / 2);

    // Apply heights
    const pos = geo.attributes.position.array;
    for (let j = 0; j < VERT; j++) {
      for (let i = 0; i < VERT; i++) {
        const idx = (j * VERT + i) * 3;
        pos[idx + 1] = this._heights[j * VERT + i];
      }
    }
    geo.attributes.position.needsUpdate = true;
    geo.computeVertexNormals();

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        time: { value: 0 },
        arenaRadius: { value: ARENA_RADIUS },
      },
      vertexShader: TERRAIN_VERT,
      fragmentShader: TERRAIN_FRAG,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;
    mesh.name = 'terrain';
    return mesh;
  }

  _addEdgeFog(scene) {
    const count = 400;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const r = ARENA_RADIUS - 10 + Math.random() * 30;
      positions[i * 3]     = Math.cos(angle) * r;
      positions[i * 3 + 1] = Math.random() * 6 - 1;
      positions[i * 3 + 2] = Math.sin(angle) * r;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0x001122,
      size: 8,
      transparent: true,
      opacity: 0.6,
      sizeAttenuation: true,
      depthWrite: false,
    });
    scene.add(new THREE.Points(geo, mat));
  }

  update(dt) {
    this._mesh.material.uniforms.time.value += dt;
  }
}

// ─── Shaders ────────────────────────────────────────────────────────────────

const TERRAIN_VERT = /* glsl */`
  varying vec2 vWorld;
  varying float vHeight;
  varying vec3 vNormal;

  void main() {
    vWorld = position.xz;
    vHeight = position.y;
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const TERRAIN_FRAG = /* glsl */`
  uniform float time;
  uniform float arenaRadius;
  varying vec2 vWorld;
  varying float vHeight;
  varying vec3 vNormal;

  // Hex grid distance
  float hexGrid(vec2 p, float scale) {
    p /= scale;
    // Axial skew
    vec2 q;
    q.x = p.x * 0.86602540378; // cos(30°) = sqrt(3)/2
    q.y = p.y + p.x * 0.5;
    vec2 cell = floor(q);
    vec2 f = fract(q) - 0.5;
    // Hex distance: max of 3 axis-aligned distances
    float d1 = abs(f.x);
    float d2 = abs(f.y);
    float d3 = abs(f.x + f.y);
    return max(max(d1, d2), d3);
  }

  void main() {
    float distFromCenter = length(vWorld);

    // Discard fragments outside arena boundary (circular clip)
    if (distFromCenter > arenaRadius + 5.0) discard;

    // Base terrain color: dark mossy green, lighter on peaks
    vec3 lowCol  = vec3(0.05, 0.12, 0.08);
    vec3 midCol  = vec3(0.08, 0.18, 0.12);
    vec3 highCol = vec3(0.12, 0.25, 0.16);
    float h = clamp(vHeight / 3.5, 0.0, 1.0);
    vec3 terrainCol = mix(mix(lowCol, midCol, h * 2.0), highCol, max(0.0, h * 2.0 - 1.0));

    // Hex grid overlay (two scales for visual interest)
    float hex1 = hexGrid(vWorld, 6.0);
    float hex2 = hexGrid(vWorld, 18.0);
    float hexLine1 = 1.0 - smoothstep(0.88, 0.94, hex1);
    float hexLine2 = 1.0 - smoothstep(0.92, 0.96, hex2);
    float hexGlow = max(hexLine1 * 0.5, hexLine2 * 0.25);

    // Pulse the grid subtly
    float pulse = sin(time * 0.6) * 0.5 + 0.5;
    vec3 gridCol = vec3(0.0, 0.5, 0.35) * (0.4 + pulse * 0.2);
    vec3 color = mix(terrainCol, terrainCol + gridCol, hexGlow);

    // Diffuse lighting
    vec3 lightDir = normalize(vec3(0.6, 1.0, 0.4));
    float diff = max(dot(normalize(vNormal), lightDir), 0.0) * 0.5 + 0.5;
    color *= diff;

    // Gentle emissive glow at edges of hex lines
    color += gridCol * hexGlow * 0.15;

    // Edge darkening (circular boundary)
    float edgeNorm = distFromCenter / arenaRadius;
    float edgeDark = smoothstep(0.75, 1.0, edgeNorm);
    color = mix(color, vec3(0.0, 0.01, 0.03), edgeDark * 0.85);

    // Cyan tint near boundary
    float edgeTint = smoothstep(0.85, 1.0, edgeNorm);
    color += vec3(0.0, 0.08, 0.15) * edgeTint * pulse;

    gl_FragColor = vec4(color, 1.0);
  }
`;

// Fast hash-based value noise — identical algorithm usable in both JS and GLSL
// Returns values in [0, 1]

function fract(x) {
  return x - Math.floor(x);
}

function hash2(x, y) {
  // Same constants as GLSL version
  const h = Math.sin(x * 127.1 + y * 311.7) * 43758.5453123;
  return fract(h);
}

function valueNoise(x, y) {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = fract(x);
  const fy = fract(y);
  // Smoothstep
  const ux = fx * fx * (3 - 2 * fx);
  const uy = fy * fy * (3 - 2 * fy);

  const a = hash2(ix,     iy    );
  const b = hash2(ix + 1, iy    );
  const c = hash2(ix,     iy + 1);
  const d = hash2(ix + 1, iy + 1);

  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

// Fractional Brownian Motion — layered noise
export function fbm(x, y, octaves = 4) {
  let value = 0;
  let amplitude = 0.5;
  let frequency = 1;
  let max = 0;
  for (let i = 0; i < octaves; i++) {
    value += valueNoise(x * frequency, y * frequency) * amplitude;
    max += amplitude;
    amplitude *= 0.5;
    frequency *= 2.0;
  }
  return value / max;
}

// Terrain height at world coordinates x, z
export function terrainHeight(x, z) {
  const s = 0.05; // base scale
  let h = 0;
  h += valueNoise(x * s,       z * s      ) * 3.0;
  h += valueNoise(x * s * 2.5, z * s * 2.5) * 1.0;
  h += valueNoise(x * s * 6,   z * s * 6  ) * 0.3;
  // Flatten edges near arena boundary
  const edgeFade = Math.max(0, 1 - Math.pow(Math.hypot(x, z) / 95, 4));
  return h * edgeFade;
}

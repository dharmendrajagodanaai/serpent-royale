// ─── Skin definitions ────────────────────────────────────────────────────────

export const SKINS = [
  // ── Solid (5) ──────────────────────────────────────────────────────────────
  { id: 'solid-cyan',   name: 'Cyan',   category: 'Solid', colors: [0x00ffff] },
  { id: 'solid-red',    name: 'Red',    category: 'Solid', colors: [0xff2244] },
  { id: 'solid-orange', name: 'Orange', category: 'Solid', colors: [0xff7700] },
  { id: 'solid-green',  name: 'Green',  category: 'Solid', colors: [0x00ff44] },
  { id: 'solid-purple', name: 'Purple', category: 'Solid', colors: [0xcc00ff] },

  // ── Striped (4) ────────────────────────────────────────────────────────────
  { id: 'stripe-candy', name: 'Candy', category: 'Striped', colors: [0xff2244, 0xffffff] },
  { id: 'stripe-wasp',  name: 'Wasp',  category: 'Striped', colors: [0x1144ff, 0xffee00] },
  { id: 'stripe-viper', name: 'Viper', category: 'Striped', colors: [0x00cc44, 0x111a11] },
  { id: 'stripe-neon',  name: 'Neon',  category: 'Striped', colors: [0xff44aa, 0xcc00ff] },

  // ── Flag-inspired (3) ─────────────────────────────────────────────────────
  { id: 'flag-usa',    name: 'USA',    category: 'Flag', colors: [0xff2244, 0xffffff, 0x1144ff] },
  { id: 'flag-brazil', name: 'Brazil', category: 'Flag', colors: [0x009c3b, 0xffdf00, 0x009c3b] },
  { id: 'flag-japan',  name: 'Japan',  category: 'Flag', colors: [0xffffff, 0xcc0000, 0xffffff] },

  // ── Themed (4) ────────────────────────────────────────────────────────────
  { id: 'galaxy', name: 'Galaxy', category: 'Themed', colors: [0x0d0d3b, 0x4422aa, 0x8833ff, 0x2244cc] },
  { id: 'lava',   name: 'Lava',   category: 'Themed', colors: [0xff2200, 0xff6600, 0xffaa00, 0xff3300] },
  { id: 'ocean',  name: 'Ocean',  category: 'Themed', colors: [0x006688, 0x0099bb, 0x00ccee, 0x007799] },
  { id: 'toxic',  name: 'Toxic',  category: 'Themed', colors: [0x33ff00, 0x88ff22, 0x00ff66, 0x44cc00] },
];

export const DEFAULT_SKIN_ID = 'solid-cyan';

export function getSkinById(id) {
  return SKINS.find(s => s.id === id) ?? SKINS[0];
}

export function getRandomSkin() {
  return SKINS[Math.floor(Math.random() * SKINS.length)];
}

/** Convert a 0xRRGGBB number to CSS hex string '#rrggbb' */
export function colorToCss(hex) {
  return '#' + hex.toString(16).padStart(6, '0');
}

/** Build a CSS background value from a skin (gradient for multi-color, flat for single) */
export function skinToCssGradient(skin) {
  if (skin.colors.length === 1) {
    return colorToCss(skin.colors[0]);
  }
  // Repeat stops so stripes look like stripes (not a smooth blend)
  const stops = [];
  const n = skin.colors.length;
  for (let i = 0; i < n; i++) {
    const start = Math.round((i / n) * 100);
    const end   = Math.round(((i + 1) / n) * 100);
    stops.push(`${colorToCss(skin.colors[i])} ${start}%`);
    stops.push(`${colorToCss(skin.colors[i])} ${end}%`);
  }
  return `linear-gradient(90deg, ${stops.join(', ')})`;
}

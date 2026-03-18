# 🐍 SERPENT ROYALE — Technical PRD
## 3D Snake Battle Royale for Vibe Coding Game Jam 2026

**Version:** 1.0 | **Author:** @research | **Date:** 2026-03-18
**Project:** VibeCodedGame-LevelIO | **Due:** March 31, 2026

---

## 1. Game Design Document

### 1.1 Core Concept
SERPENT ROYALE is a modern 3D reimagining of Snake meets Battle Royale. Up to 16 players control glowing serpents on a shrinking 3D arena. Eat orbs to grow longer, encircle opponents to eliminate them, and survive as the arena contracts. Last serpent alive wins. Think Slither.io elevated to stunning 3D with a battle royale shrinking zone.

### 1.2 What Makes It Different from Slither.io
- **3D terrain** — serpents slither over rolling hills and valleys, elevation matters
- **Battle royale zone** — arena shrinks over time, forcing confrontation
- **3D coiling** — encircle enemies in 3D space, serpents can go over/under each other on hills
- **Power orbs** — special abilities beyond just growing longer
- **Rounds with winners** — not infinite sessions, clear 3-5 minute matches
- **Visual spectacle** — neon serpents with particle trails on stylized terrain

### 1.3 Core Mechanics

**Movement:**
- Mouse controls direction (serpent head follows cursor direction)
- W/↑ or Left-click to boost speed (2x, drains length — lose 1 segment/sec)
- Serpent automatically moves forward at 6 units/sec base speed
- Boost speed: 12 units/sec
- Serpent body follows head path with smooth interpolation
- Body segments are evenly spaced along the path history
- Serpent follows terrain elevation via raycast

**Growing:**
- Eat scattered orbs on terrain to grow longer (+1 segment per orb)
- Eliminated players drop all their segments as orbs
- Starting length: 5 segments
- Maximum length: 100 segments (practical cap)
- Longer serpent = more intimidating but harder to maneuver

**Combat / Elimination:**
- **Head-to-body collision:** If your HEAD touches another serpent's BODY, you die
- **Encirclement kill:** If you create a closed loop around an opponent with your body, they're eliminated (the signature move)
- Self-collision is OFF (your head can touch your own body safely)
- On death: all segments scatter as collectible orbs
- Boost into turns to coil tightly for encirclement kills

**Battle Royale Zone:**
- Arena starts at 200x200 units
- Zone shrinks every 30 seconds (6 phases)
- Phase 1 (0:00-0:30): Full arena, 200x200
- Phase 2 (0:30-1:00): 160x160
- Phase 3 (1:00-1:30): 120x120
- Phase 4 (1:30-2:00): 80x80
- Phase 5 (2:00-2:30): 50x50
- Phase 6 (2:30-3:00): 25x25 — chaos zone
- Outside the zone: take 1 damage/sec (lose 1 segment/sec)
- Zone boundary: visible glowing wall/dome that contracts
- If tied after 3:30, zone becomes 10x10 (instant pressure)

**Scoring:**
- Win = 1st place (last alive)
- Points: 1st=10, 2nd=7, 3rd=5, 4th=3, 5th-8th=1
- Kill bonuses: +2 points per elimination
- Longest serpent bonus: +3 points if you had most segments when you died
- Leaderboard tracks wins, total kills, best length across sessions

### 1.4 Controls
| Input | Action |
|-------|--------|
| Mouse move | Steer serpent (head follows cursor direction) |
| Left-click / W | Boost speed (drains length) |
| Space | Quick 180° U-turn |
| Tab | Scoreboard |
| R | Ready up / Rematch |

### 1.5 Power Orbs (Special Collectibles)
Spawn rarely on the map (2-3 active at a time, marked on minimap):

| Orb | Color | Effect | Duration |
|-----|-------|--------|----------|
| 🔴 **Frenzy** | Red | 3x speed, no length drain | 4 sec |
| 🔵 **Phase** | Blue | Pass through other serpent bodies | 5 sec |
| 🟢 **Magnet** | Green | Nearby orbs fly toward you | 8 sec |
| 🟡 **Split** | Yellow | Your serpent splits into 2 halves (each playable by AI, rejoin after 6s) | 6 sec |
| 🟣 **Venom** | Purple | Your body becomes lethal to touch (reversed: THEY die hitting your body) | 5 sec |

### 1.6 Visual Style
- **Serpents:** Glowing segmented bodies with neon outlines, pulsing glow effect
- **Terrain:** Low-poly stylized ground with subtle hexagonal grid pattern
- **Zone:** Translucent energy wall with particle edge effect (like Fortnite storm but neon)
- **Orbs:** Small glowing spheres scattered across terrain, gentle bobbing animation
- **Death:** Serpent explodes into individual orb segments that scatter outward
- **Background:** Dark void below terrain edges, starfield above
- **Lighting:** Dramatic rim lighting on serpents, ambient glow from terrain

### 1.7 Session Flow
1. Open URL → instant load
2. Lobby: see connected players (auto-start at 4+ players after 10s countdown)
3. All serpents spawn at random positions near arena edges
4. 3-2-1 countdown → GO
5. Play until 1 serpent remains (or 3:30 time limit)
6. Results screen → "Play Again" (auto-queue for next match)
7. Continuous matchmaking — no downtime between games

---

## 2. Technical Architecture

### 2.1 Client Stack
```
Framework:     Vanilla JS + Three.js r162+
Build:         Vite
Renderer:      Three.js WebGLRenderer (WebGL2)
Physics:       Custom (no engine — only head-to-body raycasts needed)
Networking:    WebSocket (binary ArrayBuffer protocol)
Audio:         Web Audio API (procedural) + tiny base64 effects
Deploy:        Cloudflare Pages (static) + game server on Railway/Fly.io
```

### 2.2 Server Stack
```
Runtime:       Node.js 20+ with ws library
Game Loop:     Fixed 20 tick/sec server-authoritative
State:         In-memory per-room state
Matchmaking:   Simple queue → auto-fill rooms of 8-16 players
Deploy:        Railway.app or Fly.io
```

### 2.3 Scene Graph
```
Scene
├── Terrain
│   ├── Ground (PlaneGeometry with Simplex noise height + hex grid shader)
│   └── EdgeFog (void particles at terrain boundaries)
├── Serpents[] (per serpent)
│   ├── Head (SphereGeometry with eyes + glow)
│   ├── Body Segments (InstancedMesh — shared geometry for all segments)
│   ├── Trail Particles (GPU particle ribbon behind each serpent)
│   └── PointLight (per-head glow)
├── Orbs (InstancedMesh — all collectible orbs in single draw call)
├── PowerOrbs (InstancedMesh — special ability orbs)
├── Zone
│   ├── ZoneWall (CylinderGeometry with animated shader)
│   ├── ZoneFloor (circle plane showing safe area)
│   └── DamageOverlay (screen red flash when outside zone)
├── Lighting
│   ├── DirectionalLight (main)
│   ├── AmbientLight (fill)
│   └── HemisphereLight (sky vs ground)
├── Skybox (procedural star field shader)
├── PostProcessing
│   ├── UnrealBloomPass (serpent glow, orb glow, zone glow)
│   ├── SMAAPass
│   └── VignetteShader
└── UI (HTML overlay)
    ├── Kill feed
    ├── Minimap (canvas 2D with zone circle)
    ├── Player count alive
    ├── Segment count
    ├── Zone timer
    └── Results screen
```

### 2.4 Serpent Rendering System

**The core visual challenge:** Rendering 16 serpents with up to 100 segments each = up to 1,600 body segments. Must be efficient.

**Solution: InstancedMesh with path-based positioning**

```javascript
// All body segments across all serpents share ONE InstancedMesh
const segmentGeo = new THREE.SphereGeometry(0.4, 8, 6); // Low-poly sphere
const segmentMat = new THREE.MeshStandardMaterial({ 
  color: 0xffffff,
  emissive: 0x000000 // Set per-instance via color attribute
});
const MAX_TOTAL_SEGMENTS = 1600; // 16 players × 100 max each
const bodyMesh = new THREE.InstancedMesh(segmentGeo, segmentMat, MAX_TOTAL_SEGMENTS);

// Per-instance attributes
const instanceColors = new Float32Array(MAX_TOTAL_SEGMENTS * 3);
bodyMesh.instanceColor = new THREE.InstancedBufferAttribute(instanceColors, 3);

// Update loop: position each segment along its serpent's path
function updateSerpentRendering(serpents) {
  let instanceIndex = 0;
  const dummy = new THREE.Object3D();
  
  for (const serpent of serpents) {
    const { path, color, segmentCount } = serpent;
    
    for (let i = 0; i < segmentCount; i++) {
      // Position along path with smooth interpolation
      const t = i / segmentCount;
      const pos = getPathPosition(path, t);
      
      // Scale: head segments slightly larger, tail tapers
      const scale = i === 0 ? 1.2 : Math.max(0.5, 1.0 - (i / segmentCount) * 0.5);
      
      dummy.position.copy(pos);
      // Raycast down to terrain for Y position
      dummy.position.y = getTerrainHeight(pos.x, pos.z) + 0.5;
      dummy.scale.setScalar(scale);
      dummy.updateMatrix();
      
      bodyMesh.setMatrixAt(instanceIndex, dummy.matrix);
      bodyMesh.setColorAt(instanceIndex, color);
      instanceIndex++;
    }
  }
  
  bodyMesh.count = instanceIndex;
  bodyMesh.instanceMatrix.needsUpdate = true;
  bodyMesh.instanceColor.needsUpdate = true;
}
```

**Result: ALL serpent bodies rendered in 1 draw call.** Even 1,600 segments = 1 draw call.

### 2.5 Serpent Path System

```javascript
// Server tracks each serpent as a path of positions
class SerpentPath {
  constructor(startPos, segmentCount) {
    this.positions = []; // Ring buffer of head positions
    this.maxPositions = 2000; // Enough history for max-length serpent
    this.segmentSpacing = 0.8; // Distance between segments
    this.segmentCount = segmentCount;
    this.headPos = startPos.clone();
    this.headDir = new THREE.Vector2(0, -1); // Forward direction (XZ plane)
  }
  
  update(targetDir, speed, dt) {
    // Smoothly rotate head toward target direction
    const turnSpeed = 4.0; // radians/sec
    const currentAngle = Math.atan2(this.headDir.y, this.headDir.x);
    const targetAngle = Math.atan2(targetDir.y, targetDir.x);
    const newAngle = lerpAngle(currentAngle, targetAngle, turnSpeed * dt);
    this.headDir.set(Math.cos(newAngle), Math.sin(newAngle));
    
    // Move head forward
    this.headPos.x += this.headDir.x * speed * dt;
    this.headPos.z += this.headDir.y * speed * dt;
    
    // Record position in path
    this.positions.push(this.headPos.clone());
    if (this.positions.length > this.maxPositions) {
      this.positions.shift();
    }
  }
  
  // Get position of segment N (0 = head)
  getSegmentPosition(index) {
    const targetDist = index * this.segmentSpacing;
    let accumulated = 0;
    
    // Walk backward through path to find the right position
    for (let i = this.positions.length - 1; i > 0; i--) {
      const segDist = this.positions[i].distanceTo(this.positions[i - 1]);
      accumulated += segDist;
      if (accumulated >= targetDist) {
        // Interpolate between these two path points
        const overshoot = accumulated - targetDist;
        const t = overshoot / segDist;
        return this.positions[i].clone().lerp(this.positions[i - 1], 1 - t);
      }
    }
    return this.positions[0].clone(); // Fallback: tail
  }
}
```

### 2.6 Collision Detection

```javascript
// Two types of collision: head-to-body and encirclement

// 1. HEAD-TO-BODY COLLISION (fast, runs every tick)
function checkHeadBodyCollisions(serpents) {
  for (const attacker of serpents) {
    if (!attacker.alive) continue;
    const headPos = attacker.headPos;
    const headRadius = 0.5;
    
    for (const target of serpents) {
      if (target === attacker || !target.alive) continue;
      
      // Check against each body segment (skip head = index 0)
      for (let i = 2; i < target.segmentCount; i++) { // Start at 2 to avoid near-head false positives
        const segPos = target.path.getSegmentPosition(i);
        const dist = headPos.distanceTo(segPos);
        if (dist < headRadius + 0.4) { // 0.4 = segment radius
          // KILL: attacker's head hit target's body
          eliminateSerpent(attacker, target); // attacker dies, target gets credit
          break;
        }
      }
    }
  }
}

// 2. ENCIRCLEMENT CHECK (expensive, runs every 500ms)
// Uses winding number algorithm on the XZ plane
function checkEncirclements(serpents) {
  for (const coiler of serpents) {
    if (!coiler.alive || coiler.segmentCount < 15) continue; // Need length to coil
    
    // Get body positions projected to XZ as a polygon
    const polygon = [];
    for (let i = 0; i < coiler.segmentCount; i++) {
      const pos = coiler.path.getSegmentPosition(i);
      polygon.push([pos.x, pos.z]);
    }
    
    // Check if the polygon forms a closed-ish loop
    const headToTailDist = polygon[0].distanceTo(polygon[polygon.length - 1]);
    if (headToTailDist > coiler.segmentSpacing * 3) continue; // Not a closed loop
    
    // Check if any opponent's head is inside the polygon
    for (const target of serpents) {
      if (target === coiler || !target.alive) continue;
      if (pointInPolygon(target.headPos.x, target.headPos.z, polygon)) {
        eliminateSerpent(target, coiler); // Target is encircled, coiler gets credit
      }
    }
  }
}
```

**Optimization:** Head-to-body uses spatial hashing (grid cells of 5x5 units). Only check segments in same or adjacent cells as the head. Reduces from O(N*M) to O(N*~8).

### 2.7 Battle Royale Zone System

```javascript
class ZoneManager {
  constructor() {
    this.phases = [
      { size: 200, duration: 30000 }, // Phase 1: 30s
      { size: 160, duration: 30000 }, // Phase 2: 30s
      { size: 120, duration: 30000 }, // Phase 3: 30s
      { size: 80,  duration: 30000 }, // Phase 4: 30s
      { size: 50,  duration: 30000 }, // Phase 5: 30s
      { size: 25,  duration: 30000 }, // Phase 6: 30s (final)
      { size: 10,  duration: 60000 }, // Phase 7: emergency shrink
    ];
    this.currentPhase = 0;
    this.currentSize = 200;
    this.targetSize = 200;
    this.center = { x: 0, z: 0 };
    this.shrinkTimer = 0;
  }
  
  update(dt) {
    this.shrinkTimer += dt;
    const phase = this.phases[this.currentPhase];
    if (!phase) return;
    
    if (this.shrinkTimer >= phase.duration) {
      this.currentPhase++;
      this.shrinkTimer = 0;
      if (this.phases[this.currentPhase]) {
        this.targetSize = this.phases[this.currentPhase].size;
      }
    }
    
    // Smoothly shrink zone
    this.currentSize = lerp(this.currentSize, this.targetSize, 0.02);
  }
  
  isInZone(x, z) {
    const dx = x - this.center.x;
    const dz = z - this.center.z;
    return Math.sqrt(dx * dx + dz * dz) < this.currentSize / 2;
  }
  
  // Zone visual: animated cylinder with shader
  createZoneMesh() {
    const geo = new THREE.CylinderGeometry(1, 1, 30, 64, 1, true);
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      side: THREE.DoubleSide,
      uniforms: {
        time: { value: 0 },
        color: { value: new THREE.Color(1.0, 0.2, 0.3) },
        opacity: { value: 0.15 }
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
          float scanline = sin(vUv.y * 40.0 + time * 3.0) * 0.3 + 0.7;
          float edge = smoothstep(0.0, 0.1, vUv.y) * smoothstep(1.0, 0.9, vUv.y);
          gl_FragColor = vec4(color * scanline, opacity * edge);
        }
      `
    });
    return new THREE.Mesh(geo, mat);
  }
}
```

---

## 3. Multiplayer Architecture

### 3.1 Network Model: Server-Authoritative with Client Interpolation

```
┌─────────────┐     WebSocket (binary)     ┌──────────────────┐
│   Client 1  │◄─────────────────────────►│                  │
│ (rendering  │                           │   Game Server    │
│  + interp)  │     WebSocket (binary)     │  (authoritative  │
├─────────────┤◄─────────────────────────►│   snake physics  │
│   Client 2  │                           │   + collision)   │
│             │           ...             │                  │
├─────────────┤◄─────────────────────────►│  20 Hz tick      │
│   Client 16 │                           │  8-16 players    │
└─────────────┘                           └──────────────────┘
```

### 3.2 Protocol (Binary ArrayBuffer)

```
Client → Server (sent at 20Hz):
  [0x01 INPUT] [tick:u32] [dirX:f32] [dirZ:f32] [boost:u8]
  Total: 14 bytes per message

Server → Client (sent at 20Hz):
  [0x10 STATE] [tick:u32] [zoneSize:f32] [aliveCount:u8]
    per serpent: [id:u8] [headX:f32] [headZ:f32] [dir:f32] [segments:u16] [state:u8]
    = 16 bytes per serpent
  
  [0x11 TRAIL] [serpentId:u8] [pointCount:u16] [points:f32[]]
    Sent periodically (every 1s) for full path sync
    Incremental: only new points since last sync
  
  [0x12 KILL] [killerId:u8] [victimId:u8] [method:u8] = 4 bytes
  
  [0x13 ORB_SPAWN] [count:u16] [positions:f32[]] = batch orb updates
  
  [0x14 MATCH_STATE] [phase:u8] [timer:f32] [playerScores:...]
  
  [0x15 POWERUP] [action:u8] [orbId:u8] [x:f32] [z:f32] [kind:u8]
```

**Key optimization for serpents:** Don't send all body positions every tick. Send only head position + direction. Client reconstructs body by replaying the path locally. Full path sync every 1 second corrects drift.

**Bandwidth per player:**
- Upstream: 14 bytes × 20/sec = 280 bytes/sec (~0.3 KB/s)
- Downstream: ~50 bytes × 20/sec + periodic path sync = ~2 KB/s
- Total: ~2.3 KB/s per player — very lightweight

### 3.3 Client-Side Rendering Strategy

```
For LOCAL player:
  - Immediate input response (no lag)
  - Predict head position locally
  - Server corrects if delta > 1.0 unit (smooth lerp correction)

For REMOTE players:
  - Buffer last 3 server ticks (150ms delay)
  - Interpolate head position between buffered states
  - Body follows head naturally (path reconstruction)
  - On desync: full path resync from server (1/sec)

For ORBS:
  - Server sends batch orb updates
  - Client renders from state (no prediction needed)
  - Pickup is server-authoritative (prevent double-pickup)
```

### 3.4 Matchmaking & Lobby

```
Flow:
1. Player opens URL → WebSocket connects
2. Server queues player → waits for 4-16 players
3. Auto-start countdown at 4+ players (15 seconds)
4. More players can join during countdown (up to 16)
5. Match starts → play until 1 alive or time limit
6. Results screen (5 seconds) → auto-queue for next match
7. Players can leave anytime; new match fills from queue

Room capacity: 8-16 players
Match duration: 2-4 minutes
Queue timeout: 30 seconds (start with bots if <4 players)
```

---

## 4. Asset Requirements (ALL Procedural)

| Asset | Approach | Size |
|-------|----------|------|
| Terrain | PlaneGeometry + Simplex noise + hex grid shader | Procedural |
| Serpent bodies | InstancedMesh SphereGeometry (1 draw call for ALL segments) | ~200 triangles shared |
| Serpent heads | SphereGeometry + eye decals (shader) | ~300 triangles each |
| Orbs | InstancedMesh small sphere | ~50 triangles shared |
| Zone wall | CylinderGeometry + animated shader | Procedural |
| Particles | BufferGeometry points (death explosions, trails) | Procedural |
| Skybox | Star field shader (procedural) | 0 bytes |
| Audio | Web Audio API procedural + 4-5 base64 micro-effects | ~30 KB |

**Total download: ~250 KB** (JS bundle + tiny audio)

### Audio Design (Procedural)
```
- Slither ambient: filtered noise modulated by speed
- Orb pickup: ascending bell tone (Web Audio oscillator)
- Boost: whoosh (filtered noise burst)
- Kill: bass impact + sparkle (low sine + high noise)
- Zone warning: pulsing alarm (square wave, increasing frequency)
- Death: descending glass break (granular synthesis)
- Victory: triumphant chord (major triad arpeggiated)
```

---

## 5. Performance Budget

| Metric | Target | Approach |
|--------|--------|----------|
| **Initial load** | <2 seconds | Bundle <250KB, zero external assets |
| **Frame rate** | 60 FPS | InstancedMesh for ALL body segments (1 draw call) |
| **Draw calls** | <20 | Bodies=1, orbs=1, terrain=1, zone=1, heads=16, particles=1 |
| **Triangles** | <100K visible | Low-poly spheres (8×6 segments), simple terrain |
| **Memory** | <120 MB | Path history bounded (2000 points/serpent), orb pooling |
| **Network** | <3 KB/s per player | Binary protocol, head-only sync + periodic path correction |
| **Physics** | <3ms per tick | Spatial hashing, skip encirclement check on short serpents |

### Critical Performance Notes
1. **InstancedMesh is the key** — 16 serpents × 100 segments = 1,600 objects rendered in 1 draw call
2. **Path reconstruction > sending all positions** — only send head, client rebuilds body
3. **Spatial hashing for collision** — divide arena into 5×5 unit cells, only check neighboring cells
4. **Encirclement check is expensive** — run only every 500ms, only for serpents >15 segments, skip if no nearby enemies
5. **Orb pooling** — max 500 orbs on map, reuse objects when collected/despawned

---

## 6. 12-Day Development Timeline

| Day | Milestone | Deliverables |
|-----|-----------|-------------|
| **1** | Setup + terrain | Vite + Three.js scaffold, procedural terrain with hex grid shader, camera |
| **2** | Serpent movement | Single serpent: mouse steering, path following, body segments via InstancedMesh |
| **3** | Serpent polish | Speed boost, terrain following, head with eyes, particle trail, smooth turning |
| **4** | Orbs + growth | Orb spawning (InstancedMesh), orb collection, serpent growth, length display |
| **5** | Multiplayer basics | WebSocket server, player join/leave, head position sync, binary protocol |
| **6** | Multiplayer gameplay | Head-to-body collision (server-side), death → orb scatter, respawn |
| **7** | Battle royale zone | Zone shrinking system, zone wall shader, outside-zone damage, zone timer UI |
| **8** | Encirclement + kills | Encirclement detection (winding number), kill feed, score system |
| **9** | Visual polish | Bloom post-processing, neon serpent glow, death particles, zone effects |
| **10** | Match flow + UI | Lobby, countdown, results screen, minimap, scoreboard, audio |
| **11** | Power orbs + testing | Power orb spawning + effects (frenzy, phase, magnet, venom), load testing |
| **12** | Final polish + deploy | Bug fixes, balance tuning (zone timing, boost cost), deploy, submission |

---

## 7. MVP vs Stretch Goals

### MVP (Must ship by Day 10)
- [ ] Procedural 3D terrain with visual style
- [ ] Mouse-steered serpent with body segments (InstancedMesh)
- [ ] Orb collection + growth
- [ ] Speed boost (drains length)
- [ ] Head-to-body collision → elimination
- [ ] WebSocket multiplayer (8-16 players)
- [ ] Battle royale shrinking zone
- [ ] Death → scatter orbs
- [ ] Scoreboard + kill feed
- [ ] Bloom post-processing
- [ ] Match flow (lobby → game → results)

### Stretch Goals
- [ ] Encirclement kills (winding number detection)
- [ ] Power orbs (frenzy, phase, magnet, venom)
- [ ] Procedural audio
- [ ] Minimap with zone circle
- [ ] U-turn ability
- [ ] Death replay (brief slow-mo)
- [ ] Spectator mode for eliminated players
- [ ] Bot AI (fill empty slots)

### Won't Do (Post-Jam)
- Custom snake skins
- Account system / persistence
- Team mode
- Mobile touch controls (mouse is essential)

---

## 8. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Serpent body rendering performance | Low | High | InstancedMesh handles 1,600 segments in 1 draw call — tested pattern |
| Path sync desync between client/server | Medium | Medium | Periodic full path resync (1/sec), head-only prediction between syncs |
| Encirclement detection false positives | Medium | Medium | Conservative threshold, require serpent length >15, closed-loop distance check |
| Zone balance (too fast/slow) | Medium | Low | Tunable constants, test with different player counts |
| Mouse steering feels weird | Medium | High | Invest Day 2-3 in tuning turn speed, test extensively. Fallback: WASD turning |
| >12 players degrades performance | Low | Medium | Spatial hashing keeps collision O(1), InstancedMesh keeps rendering O(1) |
| Tie conditions (everyone dies to zone) | Low | Low | Last player alive wins even if in zone. If simultaneous: most segments wins |

---

## 9. File Structure
```
serpent-royale/
├── client/
│   ├── index.html
│   ├── main.js                 # Three.js init, game loop, state
│   ├── serpent.js              # Serpent path, rendering, InstancedMesh
│   ├── terrain.js              # Procedural terrain + hex grid shader
│   ├── zone.js                 # Battle royale zone (shrink, wall, damage)
│   ├── orbs.js                 # Orb system (InstancedMesh, collection)
│   ├── powerups.js             # Power orb effects
│   ├── collision.js            # Client-side prediction (visual only)
│   ├── network.js              # WebSocket client, binary protocol
│   ├── camera.js               # Chase camera (follow head)
│   ├── effects.js              # Post-processing, particles
│   ├── audio.js                # Procedural audio synthesis
│   ├── ui.js                   # HUD, scoreboard, minimap, lobby
│   ├── shaders/
│   │   ├── terrain.frag        # Hex grid terrain
│   │   ├── zone.frag           # Zone wall animation
│   │   ├── serpent-glow.frag   # Neon serpent body glow
│   │   └── sky.frag            # Star field
│   └── vite.config.js
├── server/
│   ├── index.js                # Server entry, WebSocket
│   ├── game.js                 # Game loop, match lifecycle
│   ├── serpent.js              # Server serpent state + path
│   ├── collision.js            # Head-body + encirclement (authoritative)
│   ├── zone.js                 # Zone shrink logic
│   ├── orbs.js                 # Orb spawning + collection
│   ├── protocol.js             # Binary encode/decode
│   ├── lobby.js                # Matchmaking, room management
│   └── package.json
├── shared/
│   ├── constants.js            # Shared game constants
│   ├── noise.js                # Simplex noise (terrain seed)
│   └── protocol.js             # Message type IDs
└── README.md
```

---

## 10. Deployment Plan

### Client: Cloudflare Pages
- Free tier, global CDN
- `vite build` → `dist/`
- Custom domain

### Server: Railway.app
- Free tier available, easy WebSocket support
- Single instance handles 10+ concurrent rooms
- Auto-deploy from Git

### Expected Load
- 10 rooms × 16 players = 160 concurrent max (game jam scale)
- Single 2-core instance handles this
- ~3 KB/s × 160 = ~480 KB/s total bandwidth (trivial)

### Total Infrastructure Cost: $0 (free tiers)

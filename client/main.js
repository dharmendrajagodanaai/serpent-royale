import * as THREE from 'three';
import { Terrain } from './terrain.js';
import { SerpentManager, SERPENT_COLORS, TOTAL_SERPENTS } from './serpent.js';
import { OrbManager } from './orbs.js';
import { ZoneManager } from './zone.js';
import { CollisionSystem } from './collision.js';
import { CameraController } from './camera.js';
import { buildComposer, ParticleSystem, TrailSystem } from './effects.js';
import { Audio } from './audio.js';
import {
  addKillFeed, clearKillFeed, updateHUD, updateMinimap, updateLeaderboard,
  showHUD, showCountdown, showStartScreen,
  showResults, showDamageOverlay, showAliveBanner,
  showKilledBy,
} from './ui.js';

// ─── Game State ───────────────────────────────────────────────────────────────

const STATE = { START: 0, COUNTDOWN: 1, PLAYING: 2, DEAD: 3, GAMEOVER: 4 };
let gameState = STATE.START;
let countdownTimer = 0;
let countdownStep = 3;
const ARENA_RADIUS = 95; // hard circular kill boundary (separate from battle royale zone)

let matchTime = 0;
let globalTime = 0;
let playerStats = { kills: 0, maxLength: 5, placement: TOTAL_SERPENTS };
let damageFlash = 0;
let zoneWarnCooldown = 0;
let prevAliveCount = 8;
let playerOutsideZone = false; // track for damage flash fade rate

// ─── Three.js Setup ───────────────────────────────────────────────────────────

const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
document.getElementById('canvas-container').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x000408, 0.008);

const camera = new THREE.PerspectiveCamera(65, window.innerWidth / window.innerHeight, 0.1, 600);
camera.position.set(0, 25, 50);
camera.lookAt(0, 0, 0);

// Lighting
const ambient = new THREE.AmbientLight(0x112233, 0.8);
const dirLight = new THREE.DirectionalLight(0x8888ff, 1.2);
dirLight.position.set(50, 80, 30);
const hemi = new THREE.HemisphereLight(0x002244, 0x001122, 0.5);

function addLights() {
  scene.add(ambient);
  scene.add(dirLight);
  scene.add(hemi);
}
addLights();

// ─── Game Systems ─────────────────────────────────────────────────────────────

let terrain, serpentManager, orbManager, zoneManager, collisionSystem;
let cameraController, particles, trails, composer;
let systemsReady = false;

function initSystems() {
  terrain = new Terrain(scene);
  serpentManager = new SerpentManager(scene);
  orbManager = new OrbManager(scene);
  zoneManager = new ZoneManager(scene);
  collisionSystem = new CollisionSystem();
  cameraController = new CameraController(camera);
  particles = new ParticleSystem(scene);
  trails = new TrailSystem(scene, TOTAL_SERPENTS, 35);
  composer = buildComposer(renderer, scene, camera);

  // Boundary ring — hard kill boundary, separate from battle royale zone
  {
    const pts = [];
    const N = 128;
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI * 2;
      pts.push(Math.cos(a) * ARENA_RADIUS, 2.5, Math.sin(a) * ARENA_RADIUS);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    scene.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xff3300 })));
  }

  systemsReady = true;
}

function resetSystems() {
  // Remove all current scene children
  while (scene.children.length > 0) scene.remove(scene.children[0]);
  addLights();
  clearKillFeed(); // BUG 3 fix
  initSystems();
}

// ─── Input ────────────────────────────────────────────────────────────────────

const mouse = { x: 0, y: 0 };
let isBoosting = false;
const raycaster = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.5);
const mouseWorld = new THREE.Vector3();
let inputDirX = 0, inputDirZ = -1;

function updateMouseDirection() {
  if (!serpentManager) return;
  raycaster.setFromCamera(mouse, camera);
  raycaster.ray.intersectPlane(groundPlane, mouseWorld);

  const player = serpentManager.playerSerpent;
  if (!player || !player.alive) return;

  const dx = mouseWorld.x - player.headPos.x;
  const dz = mouseWorld.z - player.headPos.z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  if (dist > 0.5) {
    inputDirX = dx / dist;
    inputDirZ = dz / dist;
  }
}

document.addEventListener('mousemove', (e) => {
  mouse.x = (e.clientX / window.innerWidth) * 2 - 1;
  mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
});

document.addEventListener('mousedown', (e) => {
  if (e.button === 0 && gameState === STATE.PLAYING) {
    isBoosting = true;
    Audio.boost();
  }
});
document.addEventListener('mouseup', () => { isBoosting = false; });

const keys = {};
document.addEventListener('keydown', (e) => {
  if (keys[e.code]) return;
  keys[e.code] = true;

  if ((e.code === 'KeyW' || e.code === 'ArrowUp') && gameState === STATE.PLAYING) {
    isBoosting = true;
    Audio.boost();
  }

  if (e.code === 'Space' && gameState === STATE.PLAYING) {
    const p = serpentManager?.playerSerpent;
    if (p && p.alive) {
      p.path.headDir.x = -p.path.headDir.x;
      p.path.headDir.z = -p.path.headDir.z;
      inputDirX = p.path.headDir.x;
      inputDirZ = p.path.headDir.z;
    }
  }
});
document.addEventListener('keyup', (e) => {
  keys[e.code] = false;
  if (e.code === 'KeyW' || e.code === 'ArrowUp') isBoosting = false;
});

renderer.domElement.addEventListener('contextmenu', e => e.preventDefault());

// ─── Game Flow ────────────────────────────────────────────────────────────────

function startGame() {
  Audio.init();
  showStartScreen(false);
  gameState = STATE.COUNTDOWN;
  countdownStep = 3;
  countdownTimer = 0;
  showCountdown(3);
  Audio.countdown();
}

function beginMatch() {
  matchTime = 0;
  playerStats = { kills: 0, maxLength: 5, placement: TOTAL_SERPENTS, timeSurvived: 0 };
  prevAliveCount = TOTAL_SERPENTS;
  damageFlash = 0;
  zoneWarnCooldown = 0;
  playerOutsideZone = false;
  inputDirX = 0; inputDirZ = -1;

  serpentManager.spawnSerpents(0);
  orbManager.init();
  cameraController.reset(serpentManager.playerSerpent);

  showCountdown(null);
  showHUD(true);
  Audio.go();
  Audio.slitherStart();
  gameState = STATE.PLAYING;
}

function handleDeath(serpent, killer) {
  if (!serpent.alive) return;

  // Build segment cache for scatter (in case render hasn't run yet this frame)
  serpent.path.buildSegmentCache(serpent.segmentCount);

  // Scatter orbs from this serpent's body
  orbManager.scatter(serpent);

  // Death particles
  particles.spawnExplosion(
    serpent.headPos.x, 0.8, serpent.headPos.z,
    SERPENT_COLORS[serpent.id]
  );

  // Kill the serpent
  serpentManager.killSerpent(serpent);

  // Kill feed
  const killerName = killer?.name ?? null;
  const killerColor = killer ? SERPENT_COLORS[killer.id] : 0xffffff;
  addKillFeed(killerName, serpent.name, killerColor, SERPENT_COLORS[serpent.id]);

  if (killer) {
    killer.kills = (killer.kills || 0) + 1;
    if (killer.isPlayer) {
      playerStats.kills++;
      Audio.kill();
    }
  }

  if (serpent.isPlayer) {
    gameState = STATE.DEAD;
    Audio.death();
    Audio.slitherStop();
    damageFlash = 1.0;
    playerStats.placement = serpentManager.aliveCount + 1;
    playerStats.maxLength = Math.max(playerStats.maxLength, serpent.segmentCount);
    playerStats.timeSurvived = matchTime;

    // BUG 7 fix: orbit camera around death position
    cameraController.setDeathMode(serpent.headPos.x, serpent.headPos.z);

    // Show killer name overlay
    if (killer) {
      showKilledBy(killer.name, SERPENT_COLORS[killer.id]);
    }

    setTimeout(() => {
      showResults(false, { ...playerStats, total: TOTAL_SERPENTS });
      gameState = STATE.GAMEOVER;
    }, 2000);
  }
}

function checkWinCondition() {
  const alive = serpentManager.aliveCount;

  if (alive < prevAliveCount) {
    prevAliveCount = alive;
    if (alive <= 3 && alive > 1) {
      showAliveBanner(`${alive} SERPENTS REMAIN!`);
    }
  }

  if (alive <= 1) {
    const survivor = serpentManager.serpents.find(s => s.alive);
    if (survivor?.isPlayer) {
      playerStats.placement = 1;
      playerStats.maxLength = Math.max(playerStats.maxLength, survivor.segmentCount);
      Audio.victory();
      Audio.slitherStop();
      showAliveBanner('YOU WIN!');
      gameState = STATE.DEAD; // prevent re-trigger
      setTimeout(() => {
        showResults(true, { ...playerStats, timeSurvived: matchTime, total: TOTAL_SERPENTS });
        gameState = STATE.GAMEOVER;
      }, 2500);
    } else if (gameState === STATE.PLAYING) {
      gameState = STATE.DEAD;
    }
  }
}

// ─── Main Loop ────────────────────────────────────────────────────────────────

let lastTime = performance.now();
// BUG 4 fix: guard against starting multiple tick loops
let tickLoopRunning = false;

function tick(now) {
  requestAnimationFrame(tick);
  const dt = Math.min((now - lastTime) / 1000, 0.05);
  lastTime = now;
  globalTime += dt;

  if (gameState === STATE.COUNTDOWN) {
    updateCountdown(dt);
  } else if (gameState === STATE.PLAYING || gameState === STATE.DEAD) {
    updateGame(dt);
  }

  terrain?.update(globalTime);
  particles?.update(dt);

  if (systemsReady) trails?.update(serpentManager?.serpents ?? []);

  if (composer) composer.render();
  else renderer.render(scene, camera);
}

function startTickLoop() {
  // BUG 4 fix: only start one tick loop
  if (tickLoopRunning) return;
  tickLoopRunning = true;
  lastTime = performance.now();
  requestAnimationFrame(tick);
}

function updateCountdown(dt) {
  countdownTimer += dt;
  if (countdownTimer >= 1.0) {
    countdownTimer -= 1.0;
    countdownStep--;
    if (countdownStep <= 0) {
      beginMatch();
    } else {
      showCountdown(countdownStep);
      Audio.countdown();
    }
  }
}

function updateGame(dt) {
  matchTime += dt;

  updateMouseDirection();

  const player = serpentManager.playerSerpent;
  const boostActive = isBoosting || keys['KeyW'] || keys['ArrowUp'];

  // ── Update serpents ──
  if (player && player.alive) {
    const playerDrops = serpentManager.updatePlayer(dt, inputDirX, inputDirZ, boostActive);
    for (const d of playerDrops) orbManager.spawnBoostOrb(d.x, d.z);
    playerStats.maxLength = Math.max(playerStats.maxLength, player.segmentCount);
  }
  const botDrops = serpentManager.updateBots(dt, orbManager, zoneManager);
  for (const d of botDrops) orbManager.spawnBoostOrb(d.x, d.z);

  // ── Circular boundary kill ──
  for (const s of serpentManager.serpents) {
    if (!s.alive) continue;
    const r2 = s.headPos.x * s.headPos.x + s.headPos.z * s.headPos.z;
    if (r2 > ARENA_RADIUS * ARENA_RADIUS) {
      handleDeath(s, null);
    }
  }

  // ── Orb collection ──
  const orbEvents = orbManager.checkCollection(serpentManager.serpents);
  for (const ev of orbEvents) {
    serpentManager.growSerpent(ev.serpent, ev.mass || 1);
    if (ev.serpent.isPlayer) Audio.orbPickup();
  }

  // ── Zone update ──
  zoneManager.update(dt);

  // ── Zone damage ──
  zoneWarnCooldown -= dt;
  playerOutsideZone = false;
  for (const s of serpentManager.serpents) {
    if (!s.alive) continue;
    if (!zoneManager.isInZone(s.headPos.x, s.headPos.z)) {
      const died = serpentManager.applyZoneDamage(s, dt);
      if (s.isPlayer) {
        playerOutsideZone = true;
        damageFlash = Math.min(1, damageFlash + dt * 1.5);
        if (zoneWarnCooldown <= 0) {
          Audio.zoneWarning();
          zoneWarnCooldown = 3.5;
        }
      }
      if (died) handleDeath(s, null);
    } else {
      // BUG 2 fix: reset zone damage timer for ALL alive serpents inside the zone
      s.zoneDamageTimer = 0;
    }
  }

  // BUG 1 fix: build segment caches for all alive serpents BEFORE collision detection
  for (const s of serpentManager.serpents) {
    if (s.alive) s.path.buildSegmentCache(s.segmentCount);
  }

  // ── Collision detection ──
  if (gameState === STATE.PLAYING) {
    const kills = collisionSystem.checkHeadBody(serpentManager.serpents);
    for (const { victim, killer } of kills) {
      if (!victim.alive) continue;
      handleDeath(victim, killer);
    }
    // Head-to-head: both snakes die
    const headKills = collisionSystem.checkHeadHead(serpentManager.serpents);
    for (const { victim, killer } of headKills) {
      if (!victim.alive) continue;
      handleDeath(victim, killer);
    }
  }

  // ── Win check ──
  if (gameState === STATE.PLAYING) checkWinCondition();

  // ── Render ──
  serpentManager.render();
  orbManager.update(globalTime, serpentManager.serpents);

  // ── Camera — always update (handles dead/orbit mode internally) ──
  cameraController.update(player, dt);

  // ── Damage flash fade — slower when outside zone (more threatening) ──
  damageFlash *= playerOutsideZone ? 0.97 : 0.90;
  showDamageOverlay(damageFlash);

  // ── Slither ambient sound ──
  if (player && player.alive) {
    Audio.slitherUpdate(player.boosting || boostActive);
  }

  // ── HUD ──
  updateHUD(serpentManager, zoneManager, matchTime);
  updateMinimap(serpentManager, zoneManager);
  updateLeaderboard(serpentManager);
}

// ─── Resize ───────────────────────────────────────────────────────────────────

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer?.setSize(window.innerWidth, window.innerHeight);
});

// ─── Buttons ─────────────────────────────────────────────────────────────────

document.getElementById('play-btn')?.addEventListener('click', () => {
  if (!systemsReady) initSystems();
  startGame();
  startTickLoop(); // BUG 4 fix: guarded start
}, { once: true });

document.getElementById('play-again-btn')?.addEventListener('click', () => {
  document.getElementById('results-screen').style.display = 'none';
  showHUD(false);
  resetSystems();
  startGame();
  startTickLoop(); // BUG 4 fix: ensures loop running, guard prevents double-start
});

// ─── Initial Load ─────────────────────────────────────────────────────────────

initSystems();
showStartScreen(true);
showHUD(false);

// Idle render (just the scene, no game logic)
function idleLoop(now) {
  if (gameState !== STATE.START) return;
  requestAnimationFrame(idleLoop);
  globalTime += 0.016;
  terrain?.update(globalTime);
  renderer.render(scene, camera);
}
requestAnimationFrame(idleLoop);

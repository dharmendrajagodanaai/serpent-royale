import * as THREE from 'three';

import { Terrain }         from './terrain.js';
import { SerpentManager }  from './serpent.js';
import { OrbSystem }       from './orbs.js';
import { PowerupSystem }   from './powerups.js';
import { ZoneManager }     from './zone.js';
import { CollisionSystem } from './collision.js';
import { AIController }    from './ai.js';
import { CameraController } from './camera.js';
import { EffectsManager }  from './effects.js';
import { AudioManager }    from './audio.js';
import { UIManager }       from './ui.js';

import {
  ARENA_HALF, AI_COUNT, SERPENT_COLORS,
  GAME_STATE, LOBBY_COUNTDOWN, RESULTS_DURATION,
  BOOST_DRAIN_RATE, ZONE_DRAIN_RATE,
  HEAD_RADIUS, START_SEGMENTS,
  POWERUP_TYPES,
} from './constants.js';

// ─── Bot names ────────────────────────────────────────────────────────────────

const BOT_NAMES = ['Viper', 'Mamba', 'Cobra', 'Python', 'Anaconda', 'Asp', 'Boa'];

// ─── Spawn positions ─────────────────────────────────────────────────────────

function randomSpawn(radius = 70) {
  const angle = Math.random() * Math.PI * 2;
  const r = radius * (0.4 + Math.random() * 0.6);
  return {
    x: Math.cos(angle) * r,
    z: Math.sin(angle) * r,
    dir: Math.atan2(-Math.cos(angle), -Math.sin(angle)), // face center
  };
}

// ─── Game ────────────────────────────────────────────────────────────────────

class Game {
  constructor() {
    // ── Renderer ─────────────────────────────────────────────────────────
    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = false;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    document.getElementById('canvas-container').appendChild(this.renderer.domElement);

    window.addEventListener('resize', () => {
      this.renderer.setSize(window.innerWidth, window.innerHeight);
    });

    // ── Scene ─────────────────────────────────────────────────────────────
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x020408);
    this.scene.fog = new THREE.FogExp2(0x020408, 0.008);

    // Lighting
    const ambient = new THREE.AmbientLight(0x112233, 1.2);
    this.scene.add(ambient);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(50, 80, 30);
    this.scene.add(dirLight);
    const hemi = new THREE.HemisphereLight(0x223344, 0x112200, 0.5);
    this.scene.add(hemi);

    // ── Subsystems ────────────────────────────────────────────────────────
    this.terrain   = new Terrain(this.scene);
    this.zone      = new ZoneManager(this.scene);
    this.orbSystem = new OrbSystem(this.scene, this.terrain);
    this.powerups  = new PowerupSystem();
    this.collision = new CollisionSystem();
    this.serpMgr   = new SerpentManager(this.scene, this.terrain);
    this.camera    = new CameraController(this.renderer);
    this.effects   = new EffectsManager(this.renderer, this.scene, this.camera.camera);
    this.audio     = new AudioManager();
    this.ui        = new UIManager();

    // ── State ─────────────────────────────────────────────────────────────
    this.state        = GAME_STATE.LOBBY;
    this.playerIdx    = -1;
    this.playerName   = 'Player';
    this.selectedColor = SERPENT_COLORS[0]; // player-chosen color
    this.boostLength  = 1.0; // 0–1 fraction
    this.boostOrbTimer = 0;  // seconds since last boost orb drop (player)
    this.kills        = 0;
    this.aiControllers = [];
    this.gameTimer    = 0;
    this.encircTimer  = 0;
    this.zoneTimer    = 0;
    this.lobbyTimer   = 0;
    this.countdownNum = 3;
    this.countdownTimer = 0;
    this.resultsTimer = 0;
    this.deadSerpents = []; // { idx, name, colorHex, kills, maxSegs, isPlayer }
    this.aliveSerpents = []; // indices
    this.serpentMeta = []; // { name, isPlayer, kills, maxSegs }
    this.matchResults = [];

    // ── Input ─────────────────────────────────────────────────────────────
    this.mouse = new THREE.Vector2(); // screen coords -1..1
    this.mouseWorld = new THREE.Vector3();
    this.boosting = false;
    this.uturnPressed = false;
    this._setupInput();

    // ── Lobby setup ───────────────────────────────────────────────────────
    this.ui.showLobby();

    // Start button
    const startBtn = document.getElementById('start-btn');
    if (startBtn) {
      startBtn.addEventListener('click', () => {
        this.playerName = document.getElementById('player-name-input')?.value?.trim() || 'Player';
        this._startCountdown();
      });
    }

    // Play again button (results screen)
    const playAgain = document.getElementById('results-play-again');
    if (playAgain) {
      playAgain.addEventListener('click', () => this._startCountdown());
    }

    // Death overlay buttons
    const deathSpectate = document.getElementById('death-spectate');
    if (deathSpectate) {
      deathSpectate.addEventListener('click', () => this.ui.hideDeathOverlay());
    }
    const deathPlayAgain = document.getElementById('death-play-again');
    if (deathPlayAgain) {
      deathPlayAgain.addEventListener('click', () => {
        this.ui.hideDeathOverlay();
        this._startCountdown();
      });
    }

    // Color swatch selection
    const swatches = document.querySelectorAll('.color-swatch');
    swatches.forEach((swatch) => {
      swatch.addEventListener('click', () => {
        const hex = parseInt(swatch.dataset.color, 16);
        this.selectedColor = hex;
        swatches.forEach(s => s.classList.remove('selected'));
        swatch.classList.add('selected');
      });
    });

    // ── Start loop ────────────────────────────────────────────────────────
    this.clock = new THREE.Clock();
    this._loop();
  }

  // ─── Input ───────────────────────────────────────────────────────────────

  _setupInput() {
    // Mouse move
    document.addEventListener('mousemove', e => {
      this.mouse.x = (e.clientX / window.innerWidth)  * 2 - 1;
      this.mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    });

    // Boost: left click or W/Up
    document.addEventListener('mousedown', e => {
      if (e.button === 0) this.boosting = true;
    });
    document.addEventListener('mouseup', e => {
      if (e.button === 0) this.boosting = false;
    });

    document.addEventListener('keydown', e => {
      if (e.code === 'KeyW' || e.code === 'ArrowUp') this.boosting = true;
      if (e.code === 'Space') {
        e.preventDefault();
        this.uturnPressed = true;
      }
    });
    document.addEventListener('keyup', e => {
      if (e.code === 'KeyW' || e.code === 'ArrowUp') this.boosting = false;
    });

    // Mobile
    document.addEventListener('touchstart', e => {
      if (e.touches.length >= 2) this.boosting = true;
    }, { passive: true });
    document.addEventListener('touchend', e => {
      if (e.touches.length < 2) this.boosting = false;
    }, { passive: true });
  }

  // ─── Match setup ─────────────────────────────────────────────────────────

  _startCountdown() {
    this.ui.showCountdown(3);
    this.state = GAME_STATE.COUNTDOWN;
    this.countdownNum = 3;
    this.countdownTimer = 0;
    this.audio.countdown();
    this._initMatch();
  }

  _initMatch() {
    // Clear previous serpents
    for (const s of this.serpMgr.serpents) {
      if (s.path.alive) this.serpMgr.removeSerpent(this.serpMgr.serpents.indexOf(s));
    }
    this.serpMgr.serpents.length = 0;
    this.serpMgr.bodyMesh.count = 0;
    this.serpMgr.glowMesh.count = 0;

    // Remove old head meshes from scene
    for (const h of this.serpMgr._heads) this.scene.remove(h);
    for (const t of this.serpMgr._trailParticles) this.scene.remove(t.points);
    this.serpMgr._heads.length = 0;
    this.serpMgr._headLights.length = 0;
    this.serpMgr._trailParticles.length = 0;

    this.aiControllers = [];
    this.serpentMeta   = [];
    this.deadSerpents  = [];
    this.kills         = 0;
    this.boostLength   = 1.0;
    this.boostOrbTimer = 0;
    this.gameTimer     = 0;

    // Spawn player with selected color
    const ps = randomSpawn(65);
    this.playerIdx = this.serpMgr.addSerpent(ps.x, ps.z, ps.dir, this.selectedColor, true);
    this.serpentMeta.push({ name: this.playerName, isPlayer: true, kills: 0, maxSegs: START_SEGMENTS });

    // Spawn AI bots — skip selected color to avoid duplicates if possible
    for (let i = 0; i < AI_COUNT; i++) {
      const sp = randomSpawn(65);
      // Pick a color different from the player's selected color
      let colorIdx = (i + 1) % SERPENT_COLORS.length;
      if (SERPENT_COLORS[colorIdx] === this.selectedColor) {
        colorIdx = (colorIdx + 1) % SERPENT_COLORS.length;
      }
      const idx = this.serpMgr.addSerpent(sp.x, sp.z, sp.dir, SERPENT_COLORS[colorIdx], false);
      this.serpentMeta.push({ name: BOT_NAMES[i], isPlayer: false, kills: 0, maxSegs: START_SEGMENTS });
      this.aiControllers.push(new AIController(idx));
    }

    this.aliveSerpents = this.serpMgr.serpents.map((_, i) => i);

    // Reset zone
    this.zone.start();

    // Update lobby player list
    const names  = this.serpentMeta.map(m => m.name);
    const colors = this.serpMgr.serpents.map(s => s.colorHex);
    this.ui.updateLobbyPlayers(names, colors);
  }

  _startGame() {
    this.state = GAME_STATE.PLAYING;
    this.ui.showGame();
    this.audio.go();
  }

  // ─── Game loop ───────────────────────────────────────────────────────────

  _loop() {
    requestAnimationFrame(() => this._loop());
    const dt = Math.min(this.clock.getDelta(), 0.05);
    this._update(dt);
    this._render();
  }

  _update(dt) {
    this.terrain.update(dt);
    this.ui.update(dt);

    switch (this.state) {
      case GAME_STATE.LOBBY:     this._updateLobby(dt);     break;
      case GAME_STATE.COUNTDOWN: this._updateCountdown(dt); break;
      case GAME_STATE.PLAYING:   this._updatePlaying(dt);   break;
      case GAME_STATE.RESULTS:   this._updateResults(dt);   break;
    }
  }

  _render() {
    this.effects.render();
  }

  // ─── State: LOBBY ────────────────────────────────────────────────────────

  _updateLobby(_dt) {
    // Orbit camera slowly
    const t = Date.now() * 0.0003;
    this.camera.camera.position.set(Math.cos(t) * 80, 50, Math.sin(t) * 80);
    this.camera.camera.lookAt(0, 3, 0);
  }

  // ─── State: COUNTDOWN ────────────────────────────────────────────────────

  _updateCountdown(dt) {
    this.countdownTimer += dt;
    if (this.countdownTimer >= 1.0) {
      this.countdownTimer = 0;
      this.countdownNum--;
      if (this.countdownNum <= 0) {
        this.ui.showCountdown(0);
        setTimeout(() => this._startGame(), 600);
      } else {
        this.ui.showCountdown(this.countdownNum);
        this.audio.countdown();
      }
    }

    // Spin serpents during countdown
    this._updateSerpentRendering(dt * 0.2);
  }

  // ─── State: PLAYING ──────────────────────────────────────────────────────

  _updatePlaying(dt) {
    this.gameTimer += dt;

    const player = this.serpMgr.serpents[this.playerIdx];

    // ── Player input ──────────────────────────────────────────────────
    if (player && player.path.alive) {
      const targetAngle = this._computePlayerAngle(player);
      const actualBoost = this.boosting && this.boostLength > 0.05;

      // Handle mobile joystick
      const mob = this.ui.mobileDir;
      const hasMobile = Math.hypot(mob.x, mob.y) > 0.1;
      const mobileBoost = this.ui.mobileBoost;

      let angle = targetAngle;
      if (hasMobile) {
        angle = Math.atan2(mob.x, mob.y);
      }

      // U-turn
      if (this.uturnPressed) {
        player.path.headAngle += Math.PI;
        this.uturnPressed = false;
      }

      const boost = (actualBoost || mobileBoost) && this.boostLength > 0.05;
      player.path.update(angle, dt, this.terrain, boost);

      // Drain boost
      if (boost && !this.powerups.skipBoostDrain(this.playerIdx)) {
        this.boostLength -= dt * BOOST_DRAIN_RATE / (player.path.segmentCount);
        this.boostLength = Math.max(0, this.boostLength);
        if (Math.random() < dt * 3) this.audio.boost();

        // ── Slither.io boost mechanic: shed segments and drop orbs ──
        this.boostOrbTimer += dt;
        if (this.boostOrbTimer >= 0.3 && player.path.segmentCount > 5) {
          this.boostOrbTimer = 0;
          // Drop orb at tail position
          const tailV = new THREE.Vector3();
          const tailIdx = Math.max(0, Math.floor(player.path.segmentCount) - 1);
          player.path.getSegmentPos(tailIdx, this.terrain, tailV);
          this.orbSystem.spawnDeathOrbs(tailV.x, tailV.z, 1);
          player.path.shrink(1);
        }
      } else {
        if (!boost) this.boostOrbTimer = 0;
        this.boostLength = Math.min(1, this.boostLength + dt * 0.3);
      }

      // Magnet power-up
      if (this.powerups.hasMagnet(this.playerIdx)) {
        this.orbSystem.magnetPull(player.path.headPos.x, player.path.headPos.z, 20, dt);
      }

      // Audio ambient speed
      this.audio.setAmbientSpeed(player.path.boost ? 12 : 7);
    }

    // ── AI updates ────────────────────────────────────────────────────
    for (const ai of this.aiControllers) {
      const s = this.serpMgr.serpents[ai.serpentIdx];
      if (!s || !s.path.alive) continue;
      const angle = ai.update(s, this.serpMgr.serpents, this.orbSystem, this.zone, dt);

      // AI boosts based on personality-driven wantsBoost flag or random chance
      const aiBoost = ai.wantsBoost || Math.random() < 0.01;
      s.path.update(angle, dt, this.terrain, aiBoost);
      if (aiBoost && s.path.segmentCount > 5) {
        s.path.segmentCount = Math.max(2, s.path.segmentCount - dt * BOOST_DRAIN_RATE);

        // AI also drops orbs when boosting
        ai.boostOrbTimer += dt;
        if (ai.boostOrbTimer >= 0.3) {
          ai.boostOrbTimer = 0;
          const tailV = new THREE.Vector3();
          const tailIdx = Math.max(0, Math.floor(s.path.segmentCount) - 1);
          s.path.getSegmentPos(tailIdx, this.terrain, tailV);
          this.orbSystem.spawnDeathOrbs(tailV.x, tailV.z, 1);
        }
      } else {
        ai.boostOrbTimer = 0;
      }
    }

    // ── Zone damage ───────────────────────────────────────────────────
    this.zone.update(dt);
    this.zoneTimer += dt;

    for (let i = 0; i < this.serpMgr.serpents.length; i++) {
      const s = this.serpMgr.serpents[i];
      if (!s.path.alive) continue;
      const hx = s.path.headPos.x, hz = s.path.headPos.z;
      if (!this.zone.isInZone(hx, hz)) {
        s.path.segmentCount -= dt * ZONE_DRAIN_RATE;
        if (i === this.playerIdx) {
          this.ui.showZoneWarning(true);
          if (Math.random() < dt * 4) this.ui.flashDamage();
          if (Math.random() < dt * 2) this.audio.zoneWarning();
        }
        if (s.path.segmentCount < 2) this._killSerpent(i, -1);
      } else {
        if (i === this.playerIdx) this.ui.showZoneWarning(false);
      }
    }

    // ── Orb collection ────────────────────────────────────────────────
    for (let i = 0; i < this.serpMgr.serpents.length; i++) {
      const s = this.serpMgr.serpents[i];
      if (!s.path.alive) continue;
      const hx = s.path.headPos.x, hz = s.path.headPos.z;
      const collected = this.orbSystem.checkCollection(hx, hz, HEAD_RADIUS + 0.6);
      for (const c of collected) {
        if (c.type === 'regular') {
          s.path.grow(1);
          if (i === this.playerIdx) this.audio.orbPickup();
        } else {
          // Power-up
          this.powerups.apply(i, c.type);
          if (i === this.playerIdx) this.audio.powerupCollect(c.type);
        }
      }
    }

    // ── Collision ─────────────────────────────────────────────────────
    this.collision.buildHash(this.serpMgr.serpents, this.terrain);

    // Head-body collisions
    const kills = this.collision.checkHeadBody(this.serpMgr.serpents, this.terrain, this.powerups);
    for (const k of kills) {
      if (!this.serpMgr.serpents[k.attackerIdx].path.alive) continue;
      const creditorIdx = k.victimIdx;
      this._killSerpent(k.attackerIdx, creditorIdx);
    }

    // Head-to-head collisions (both die, like slither.io)
    const headHeadKills = this.collision.checkHeadHead(this.serpMgr.serpents);
    for (const hh of headHeadKills) {
      const a = this.serpMgr.serpents[hh.idxA];
      const b = this.serpMgr.serpents[hh.idxB];
      if (a.path.alive) this._killSerpent(hh.idxA, -1);
      if (b.path.alive) this._killSerpent(hh.idxB, -1);
    }

    // Encirclement (every 600ms)
    this.encircTimer += dt;
    if (this.encircTimer >= 0.6) {
      this.encircTimer = 0;
      const encircles = this.collision.checkEncirclement(this.serpMgr.serpents, this.terrain);
      for (const e of encircles) {
        if (!this.serpMgr.serpents[e.encircledIdx].path.alive) continue;
        this._killSerpent(e.encircledIdx, e.coilerIdx);
      }
    }

    // ── Powerup update ────────────────────────────────────────────────
    this.powerups.update(dt);

    // ── Serpent rendering ─────────────────────────────────────────────
    this._updateSerpentRendering(dt);

    // ── Orb update ────────────────────────────────────────────────────
    this.orbSystem.update(dt);

    // ── Effects ───────────────────────────────────────────────────────
    this.effects.update(dt);

    // ── Camera ────────────────────────────────────────────────────────
    if (player && player.path.alive) {
      this.camera.update(dt, player.path.headPos, player.path.headAngle, player.path.boost, this.terrain);
    }

    // ── HUD ───────────────────────────────────────────────────────────
    const aliveCount = this.serpMgr.serpents.filter(s => s.path.alive).length;
    this.ui.updateAliveCount(aliveCount);

    if (player && player.path.alive) {
      this.ui.updateSegmentCount(Math.floor(player.path.segmentCount));
      this.ui.updateKillCount(this.kills);
      this.ui.updateBoostBar(this.boostLength);
      this.ui.updatePowerup(this.powerups.getHUDColor(this.playerIdx));
    }

    this.ui.updateZoneTimer(this.zone.getPhaseInfo());
    this.ui.updateMinimap(this.serpMgr.serpents, this.playerIdx, this.zone.currentRadius, this.orbSystem);
    this.ui.updateLeaderboard(this.serpMgr.serpents, this.serpentMeta, this.playerIdx);

    // ── Win condition ─────────────────────────────────────────────────
    const aliveSerpents = this.serpMgr.serpents.filter(s => s.path.alive);
    if (aliveSerpents.length <= 1 || this.gameTimer > 210) {
      this._endMatch(aliveSerpents);
    }
  }

  // ─── State: RESULTS ──────────────────────────────────────────────────────

  _updateResults(dt) {
    this.resultsTimer += dt;

    // Orbit camera on results
    const t = Date.now() * 0.0002;
    this.camera.camera.position.set(Math.cos(t) * 60, 40, Math.sin(t) * 60);
    this.camera.camera.lookAt(0, 3, 0);

    if (this.resultsTimer > RESULTS_DURATION) {
      this._startCountdown();
    }
  }

  // ─── Kill serpent ────────────────────────────────────────────────────────

  _killSerpent(victimIdx, creditorIdx) {
    const victim = this.serpMgr.serpents[victimIdx];
    if (!victim || !victim.path.alive) return;

    // Record max segs
    const meta = this.serpentMeta[victimIdx];
    if (meta) meta.maxSegs = Math.max(meta.maxSegs || 0, Math.floor(victim.path.segmentCount));

    // Death orb scatter
    const hp = victim.path.headPos;
    const orbCount = Math.floor(victim.path.segmentCount * 0.7);
    this.orbSystem.spawnDeathOrbs(hp.x, hp.z, orbCount);

    // Death explosion
    this.effects.spawnDeathExplosion(hp.x, hp.y, hp.z, victim.color, Math.min(80, orbCount));

    // Kill credit
    if (creditorIdx >= 0 && creditorIdx !== victimIdx) {
      const creditor = this.serpMgr.serpents[creditorIdx];
      if (creditor && creditor.path.alive) {
        creditor.path.grow(Math.floor(victim.path.segmentCount * 0.3));
      }
      const credMeta = this.serpentMeta[creditorIdx];
      if (credMeta) credMeta.kills++;
      if (creditorIdx === this.playerIdx) {
        this.kills++;
        this.ui.updateKillCount(this.kills);
        this.audio.kill();
      }

      // Kill feed
      const creditorName = credMeta?.name || 'Unknown';
      const victimName   = meta?.name || 'Unknown';
      const credColor    = this.serpMgr.serpents[creditorIdx]?.colorHex || 0xffffff;
      const victColor    = victim.colorHex;
      this.ui.addKillEvent(creditorName, credColor, victimName, victColor);
    }

    // If player died — show death overlay + killed-by banner
    if (victimIdx === this.playerIdx) {
      this.audio.death();
      this.ui.showZoneWarning(false);
      const killerName = creditorIdx >= 0 && creditorIdx !== victimIdx
        ? this.serpentMeta[creditorIdx]?.name || null
        : null;
      this.ui.showPlayerDeath(killerName, Math.floor(victim.path.segmentCount), this.kills);
    }

    this.serpMgr.removeSerpent(victimIdx);
    victim.path.alive = false;

    // Track for results
    this.deadSerpents.push({
      idx: victimIdx,
      name: meta?.name || 'Unknown',
      colorHex: victim.colorHex,
      kills: meta?.kills || 0,
      maxSegs: meta?.maxSegs || 0,
      isPlayer: victimIdx === this.playerIdx,
    });
  }

  _endMatch(aliveSerpents) {
    if (this.state !== GAME_STATE.PLAYING) return;
    this.state = GAME_STATE.RESULTS;
    this.resultsTimer = 0;

    // Finalize alive serpent results
    const aliveResults = aliveSerpents.map(s => {
      const idx = this.serpMgr.serpents.indexOf(s);
      const meta = this.serpentMeta[idx];
      return {
        idx,
        name: meta?.name || 'Unknown',
        colorHex: s.colorHex,
        kills: meta?.kills || 0,
        maxSegs: Math.max(meta?.maxSegs || 0, Math.floor(s.path.segmentCount)),
        isPlayer: idx === this.playerIdx,
      };
    });

    // Results: alive first (winner at top), then dead in reverse order (last killed = 2nd)
    this.matchResults = [...aliveResults, ...this.deadSerpents.reverse()];

    const winner = this.matchResults[0];
    if (winner?.isPlayer) this.audio.victory();

    this.ui.showResults(this.matchResults, this.playerName);
  }

  // ─── Serpent rendering passthrough ───────────────────────────────────────

  _updateSerpentRendering(dt) {
    this.serpMgr.update(dt);
  }

  // ─── Mouse world direction computation ───────────────────────────────────

  _computePlayerAngle(player) {
    if (!player) return 0;

    // Project mouse ray onto XZ plane at head height
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(this.mouse, this.camera.camera);
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -player.path.headPos.y);
    const target = new THREE.Vector3();
    raycaster.ray.intersectPlane(plane, target);

    if (!target || isNaN(target.x)) return player.path.headAngle;

    const dx = target.x - player.path.headPos.x;
    const dz = target.z - player.path.headPos.z;
    if (Math.hypot(dx, dz) < 0.5) return player.path.headAngle; // too close

    return Math.atan2(dx, dz);
  }
}

// ─── Bootstrap ───────────────────────────────────────────────────────────────

new Game();

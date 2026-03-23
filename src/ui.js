import { POWERUP_TYPES, ARENA_RADIUS } from './constants.js';

// ─── Kill feed ────────────────────────────────────────────────────────────────

const KILL_FEED_MAX = 6;

export class UIManager {
  constructor() {
    this._killFeed    = document.getElementById('kill-feed');
    this._aliveCount  = document.getElementById('alive-count');
    this._segCount    = document.getElementById('segment-count');
    this._killCount   = document.getElementById('kill-count');
    // Zone UI removed — boundary is fixed
    this._minimap     = document.getElementById('minimap');
    this._mmCtx       = this._minimap.getContext('2d');
    this._powerupDisp = document.getElementById('powerup-display');
    this._powerupName = document.getElementById('powerup-name');
    this._powerupBar  = document.getElementById('powerup-bar');
    this._boostBar    = document.getElementById('boost-bar');
    this._damageOverlay = document.getElementById('damage-overlay');

    this._lobbyScreen    = document.getElementById('lobby-screen');
    this._countdownScreen = document.getElementById('countdown-screen');
    this._countDisplay   = document.getElementById('count-display');
    this._resultsScreen  = document.getElementById('results-screen');
    this._resultsTitle   = document.getElementById('results-title');
    this._resultsWinner  = document.getElementById('results-winner');
    this._resultsList    = document.getElementById('results-list');
    this._hud            = document.getElementById('hud');

    this._leaderboard    = document.getElementById('leaderboard');
    this._deathOverlay   = document.getElementById('death-overlay');
    this._killedByBanner = document.getElementById('killed-by-banner');

    this._killFeedEntries = [];
    this._totalKills  = 0;
    this._lastDeathStats = null;

    this._damageFlashTimer = 0;
    this._killedByTimer    = 0;

    // Share button on death overlay
    const shareBtn = document.getElementById('death-share');
    if (shareBtn) {
      shareBtn.addEventListener('click', () => {
        const s = this._lastDeathStats;
        if (!s) return;
        const min = Math.floor(s.timeSurvived / 60);
        const sec = Math.floor(s.timeSurvived % 60);
        const text = `I survived ${min}:${sec.toString().padStart(2, '0')} in Serpent Royale! ` +
          `Length: ${s.length}, Kills: ${s.kills} 🐍`;
        navigator.clipboard?.writeText(text).then(() => {
          shareBtn.textContent = 'Copied!';
          setTimeout(() => { shareBtn.textContent = 'Share Score'; }, 2000);
        });
      });
    }

    // Mobile controls
    this._setupMobileControls();
  }

  // ─── Overlay management ───────────────────────────────────────────────────

  showLobby() {
    this._lobbyScreen.classList.remove('hidden');
    this._countdownScreen.classList.add('hidden');
    this._resultsScreen.classList.add('hidden');
    this._hud.style.display = 'none';
  }

  showCountdown(num) {
    this._lobbyScreen.classList.add('hidden');
    this._countdownScreen.classList.remove('hidden');
    this._resultsScreen.classList.add('hidden');
    if (num === 0) {
      this._countDisplay.textContent = 'GO!';
      this._countDisplay.className = 'go-text';
    } else {
      this._countDisplay.textContent = String(num);
      this._countDisplay.className = 'count-num';
    }
  }

  showGame() {
    this._lobbyScreen.classList.add('hidden');
    this._countdownScreen.classList.add('hidden');
    this._resultsScreen.classList.add('hidden');
    this._hud.style.display = '';
    this.hideDeathOverlay();
  }

  showResults(results, playerName) {
    this._hud.style.display = 'none';
    this._countdownScreen.classList.add('hidden');
    this._resultsScreen.classList.remove('hidden');

    const winner = results[0];
    this._resultsTitle.textContent = winner.isPlayer ? '🏆 VICTORY!' : 'MATCH OVER';
    this._resultsTitle.style.color = winner.isPlayer ? '#ff0' : '#fff';
    this._resultsWinner.textContent = `Winner: ${winner.name}`;

    this._resultsList.innerHTML = results.slice(0, 8).map((r, i) => {
      const isP = r.isPlayer;
      const colorHex = '#' + (r.colorHex || 0xffffff).toString(16).padStart(6, '0');
      let timeStr = '';
      if (r.survivalTime !== undefined) {
        const min = Math.floor(r.survivalTime / 60);
        const sec = Math.floor(r.survivalTime % 60);
        timeStr = ` · ${min}:${sec.toString().padStart(2, '0')}`;
      }
      return `<div class="result-row ${isP ? 'player-row' : ''}">
        <div class="result-rank">#${i + 1}</div>
        <div class="result-name" style="color:${colorHex}">${r.name}</div>
        <div class="result-stats">segs: ${r.maxSegs} · kills: ${r.kills}${timeStr}</div>
      </div>`;
    }).join('');

    // Leaderboard local storage
    this._updateLeaderboard(results, playerName);
  }

  _updateLeaderboard(results, playerName) {
    try {
      const lb = JSON.parse(localStorage.getItem('sr_leaderboard') || '{"wins":0,"kills":0,"games":0}');
      const player = results.find(r => r.isPlayer);
      if (player) {
        lb.games++;
        lb.kills += player.kills;
        if (results[0].isPlayer) lb.wins++;
        lb.bestLength = Math.max(lb.bestLength || 0, player.maxSegs);
        localStorage.setItem('sr_leaderboard', JSON.stringify(lb));
      }
    } catch (_) {}
  }

  // ─── HUD updates ─────────────────────────────────────────────────────────

  updateAliveCount(n) {
    if (this._aliveCount) this._aliveCount.textContent = String(n);
  }

  updateSegmentCount(n) {
    if (this._segCount) this._segCount.textContent = String(n);
  }

  updateKillCount(n) {
    this._totalKills = n;
    if (this._killCount) this._killCount.textContent = String(n);
  }

  updateBoostBar(fraction) {
    if (this._boostBar) {
      this._boostBar.style.width = `${Math.max(0, Math.min(1, fraction)) * 100}%`;
    }
  }

  // Zone timer + warning removed — boundary is fixed circular wall

  flashDamage() {
    this._damageFlashTimer = 0.25;
    this._damageOverlay.classList.add('flashing');
  }

  updatePowerup(info) {
    if (!info) {
      this._powerupDisp.style.display = 'none';
      return;
    }
    this._powerupDisp.style.display = 'flex';
    this._powerupName.textContent = info.kind;
    this._powerupName.style.color = '#' + info.color.toString(16).padStart(6, '0');
    const pct = (info.timeLeft / info.duration) * 100;
    this._powerupBar.style.width = `${pct}%`;
    this._powerupBar.style.background = '#' + info.color.toString(16).padStart(6, '0');
  }

  // ─── Kill feed ────────────────────────────────────────────────────────────

  addKillEvent(killerName, killerColor, victimName, victimColor) {
    const div = document.createElement('div');
    div.className = 'kill-entry';
    const kc = '#' + killerColor.toString(16).padStart(6, '0');
    const vc = '#' + victimColor.toString(16).padStart(6, '0');
    div.innerHTML = `<span style="color:${kc}">${killerName}</span> <span style="color:#aaa">ate</span> <span style="color:${vc}">${victimName}</span>`;
    this._killFeed.prepend(div);
    this._killFeedEntries.push(div);

    // Remove after animation
    setTimeout(() => {
      div.remove();
      const i = this._killFeedEntries.indexOf(div);
      if (i >= 0) this._killFeedEntries.splice(i, 1);
    }, 4200);

    // Limit entries
    while (this._killFeedEntries.length > KILL_FEED_MAX) {
      this._killFeedEntries.shift().remove();
    }
  }

  // ─── Minimap ─────────────────────────────────────────────────────────────

  updateMinimap(serpents, playerIdx, _unused, orbSystem) {
    const ctx  = this._mmCtx;
    const size = 140;
    const half = size / 2;
    const scale = half / 105; // 105 = slightly larger than ARENA_HALF for padding

    ctx.clearRect(0, 0, size, size);

    // Background
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    ctx.beginPath();
    ctx.arc(half, half, half, 0, Math.PI * 2);
    ctx.fill();

    // Grid lines (faint)
    ctx.strokeStyle = 'rgba(255,255,255,0.05)';
    ctx.lineWidth = 1;
    for (let g = -3; g <= 3; g++) {
      const gx = half + g * (half / 3);
      ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, size); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, gx); ctx.lineTo(size, gx); ctx.stroke();
    }

    // Boundary circle (fixed circular arena edge)
    const br = ARENA_RADIUS * scale;
    ctx.strokeStyle = 'rgba(0,180,255,0.7)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(half, half, br, 0, Math.PI * 2);
    ctx.stroke();

    // Orbs (dots)
    if (orbSystem) {
      const powerOrbs = orbSystem.getPowerOrbs();
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      for (const o of orbSystem._orbs.slice(0, 200)) {
        if (!o.active) continue;
        const mx = half + o.x * scale;
        const my = half + o.z * scale;
        ctx.fillRect(mx - 0.5, my - 0.5, 1, 1);
      }
      for (const o of powerOrbs) {
        const mx = half + o.x * scale;
        const my = half + o.z * scale;
        ctx.fillStyle = '#' + (0x800000 + Math.floor(Math.random() * 0x7fffff)).toString(16);
        ctx.beginPath(); ctx.arc(mx, my, 2.5, 0, Math.PI * 2); ctx.fill();
      }
    }

    // Serpents
    for (let i = 0; i < serpents.length; i++) {
      const s = serpents[i];
      if (!s.path.alive) continue;
      const sx = half + s.path.headPos.x * scale;
      const sy = half + s.path.headPos.z * scale;
      const hex = '#' + s.colorHex.toString(16).padStart(6, '0');
      const isPlayer = i === playerIdx;

      ctx.fillStyle = hex;
      ctx.beginPath();
      ctx.arc(sx, sy, isPlayer ? 4 : 2.5, 0, Math.PI * 2);
      ctx.fill();

      if (isPlayer) {
        // Pulse ring
        ctx.strokeStyle = hex;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(sx, sy, 7, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    // Clip to circle
    ctx.save();
    ctx.globalCompositeOperation = 'destination-in';
    ctx.beginPath();
    ctx.arc(half, half, half, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // ─── Lobby helpers ────────────────────────────────────────────────────────

  showLobbyCountdown(seconds) {
    const el = document.getElementById('lobby-countdown');
    if (!el) return;
    el.style.display = seconds > 0 ? 'block' : 'none';
    el.textContent = seconds > 0 ? `Starting in ${seconds}s…` : '';
  }

  updateLobbyPlayers(names, colors) {
    const el = document.getElementById('lobby-player-list');
    if (!el) return;
    el.innerHTML = names.map((n, i) => {
      const hex = '#' + (colors[i] || 0xffffff).toString(16).padStart(6, '0');
      return `<div class="player-chip" style="color:${hex};border-color:${hex}">${n}</div>`;
    }).join('');
  }

  // ─── Live leaderboard ─────────────────────────────────────────────────────

  updateLeaderboard(serpents, serpentMeta, playerIdx) {
    if (!this._leaderboard) return;

    // Gather alive serpents sorted by segment count (descending)
    const entries = [];
    for (let i = 0; i < serpents.length; i++) {
      const s = serpents[i];
      if (!s.path.alive) continue;
      entries.push({ s, i, meta: serpentMeta[i] });
    }
    entries.sort((a, b) => b.s.path.segmentCount - a.s.path.segmentCount);
    const top = entries.slice(0, 5);

    this._leaderboard.innerHTML = top.map((e, rank) => {
      const hex  = '#' + e.s.colorHex.toString(16).padStart(6, '0');
      const isMe = e.i === playerIdx;
      const name = e.meta?.name || '?';
      return `<div class="lb-row${isMe ? ' lb-me' : ''}">` +
        `<span class="lb-rank">${rank + 1}</span>` +
        `<span class="lb-dot" style="background:${hex}"></span>` +
        `<span class="lb-name" style="color:${isMe ? '#0ff' : '#fff'}">${name}</span>` +
        `<span class="lb-len">${Math.floor(e.s.path.segmentCount)}</span>` +
        `</div>`;
    }).join('');
  }

  // ─── Death overlay ────────────────────────────────────────────────────────

  showPlayerDeath(killerName, length, kills, timeSurvived = 0) {
    if (this._deathOverlay) {
      document.getElementById('death-killer').textContent =
        killerName ? `Killed by ${killerName}` : 'Hit the boundary';
      document.getElementById('death-length').textContent = `Length: ${length}`;
      document.getElementById('death-kills').textContent  = `Kills: ${kills}`;
      const min = Math.floor(timeSurvived / 60);
      const sec = Math.floor(timeSurvived % 60);
      const timeEl = document.getElementById('death-time');
      if (timeEl) timeEl.textContent = `Time: ${min}:${sec.toString().padStart(2, '0')}`;
      this._lastDeathStats = { length, kills, timeSurvived };
      this._deathOverlay.style.display = 'flex';
    }
    if (killerName && this._killedByBanner) {
      this._killedByBanner.textContent = `KILLED BY ${killerName.toUpperCase()}`;
      this._killedByBanner.style.display = 'block';
      this._killedByTimer = 2.0;
    }
  }

  hideDeathOverlay() {
    if (this._deathOverlay) this._deathOverlay.style.display = 'none';
    if (this._killedByBanner) this._killedByBanner.style.display = 'none';
    this._killedByTimer = 0;
  }

  // ─── Update loop ─────────────────────────────────────────────────────────

  update(dt) {
    if (this._damageFlashTimer > 0) {
      this._damageFlashTimer -= dt;
      if (this._damageFlashTimer <= 0) {
        this._damageOverlay.classList.remove('flashing');
      }
    }
    if (this._killedByTimer > 0) {
      this._killedByTimer -= dt;
      if (this._killedByTimer <= 0 && this._killedByBanner) {
        this._killedByBanner.style.display = 'none';
      }
    }
  }

  // ─── Mobile controls ─────────────────────────────────────────────────────

  _setupMobileControls() {
    this.mobileDir = { x: 0, y: 0 };
    this.mobileBoost = false;

    const zone  = document.getElementById('joystick-zone');
    const knob  = document.getElementById('joystick-knob');
    const boost = document.getElementById('boost-btn');
    if (!zone) return;

    let active = false;
    let startX = 0, startY = 0;
    const maxR = 42;

    const onMove = (cx, cy) => {
      const dx = cx - startX;
      const dy = cy - startY;
      const dist = Math.hypot(dx, dy);
      const capped = Math.min(dist, maxR);
      const nx = dist > 0 ? dx / dist : 0;
      const ny = dist > 0 ? dy / dist : 0;
      this.mobileDir.x = nx;
      this.mobileDir.y = ny;
      knob.style.transform = `translate(calc(-50% + ${nx * capped}px), calc(-50% + ${ny * capped}px))`;
    };

    zone.addEventListener('touchstart', e => {
      e.preventDefault();
      active = true;
      const t = e.touches[0];
      const r = zone.getBoundingClientRect();
      startX = r.left + r.width / 2;
      startY = r.top  + r.height / 2;
      onMove(t.clientX, t.clientY);
    }, { passive: false });
    zone.addEventListener('touchmove', e => {
      e.preventDefault();
      if (!active) return;
      onMove(e.touches[0].clientX, e.touches[0].clientY);
    }, { passive: false });
    zone.addEventListener('touchend', () => {
      active = false;
      this.mobileDir.x = 0; this.mobileDir.y = 0;
      knob.style.transform = 'translate(-50%, -50%)';
    });

    if (boost) {
      boost.addEventListener('touchstart', e => { e.preventDefault(); this.mobileBoost = true; });
      boost.addEventListener('touchend',   e => { e.preventDefault(); this.mobileBoost = false; });
    }
  }
}

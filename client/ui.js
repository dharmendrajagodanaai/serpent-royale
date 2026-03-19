import { SERPENT_COLORS } from './serpent.js';

// ─── Kill Feed ───────────────────────────────────────────────────────────────

const MAX_KILL_ENTRIES = 5;
let killEntries = [];

export function addKillFeed(killerName, victimName, killerColorHex, victimColorHex) {
  const feed = document.getElementById('kill-feed');
  if (!feed) return;

  const el = document.createElement('div');
  el.className = 'kill-entry';

  const kCol = '#' + killerColorHex.toString(16).padStart(6, '0');
  const vCol = '#' + victimColorHex.toString(16).padStart(6, '0');

  el.innerHTML = killerName
    ? `<span style="color:${kCol}">${killerName}</span> <span style="opacity:0.6">⚔</span> <span style="color:${vCol}">${victimName}</span>`
    : `<span style="color:${vCol}">${victimName}</span> <span style="opacity:0.6">💀 zone</span>`;

  feed.appendChild(el);
  killEntries.push(el);

  if (killEntries.length > MAX_KILL_ENTRIES) {
    const old = killEntries.shift();
    old.remove();
  }

  setTimeout(() => { el.remove(); killEntries = killEntries.filter(e => e !== el); }, 3000);
}

// BUG 3 fix: clear kill feed on Play Again
export function clearKillFeed() {
  const feed = document.getElementById('kill-feed');
  if (feed) feed.innerHTML = '';
  killEntries = [];
}

// ─── HUD stats ───────────────────────────────────────────────────────────────

export function updateHUD(serpentManager, zoneManager, matchTime) {
  const player = serpentManager.playerSerpent;

  // Segment count
  const lenEl = document.getElementById('stat-length');
  if (lenEl && player) lenEl.textContent = player.alive ? player.segmentCount : '0';

  // YOUR SCORE indicator (top center)
  const scoreEl = document.getElementById('score-value');
  if (scoreEl && player) scoreEl.textContent = player.alive ? player.segmentCount : '0';

  // Alive count
  const aliveEl = document.getElementById('stat-alive');
  if (aliveEl) aliveEl.textContent = serpentManager.aliveCount;

  // Kill count
  const killEl = document.getElementById('stat-kills');
  if (killEl && player) killEl.textContent = player.kills ?? 0;

  // Zone timer
  const zoneEl = document.getElementById('zone-timer');
  if (zoneEl) {
    const t = Math.ceil(zoneManager.timeUntilNextPhase);
    const mins = Math.floor(t / 60);
    const secs = t % 60;
    zoneEl.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
    // Warn when < 5s
    zoneEl.style.color = t <= 5 ? '#ff0000' : '#ff5050';
  }

  // Boost bar = segment count ratio
  const boostBar = document.getElementById('boost-bar');
  if (boostBar && player) {
    const ratio = Math.min(1, player.segmentCount / 100);
    boostBar.style.width = (ratio * 100) + '%';
    boostBar.style.background = player.boosting
      ? 'linear-gradient(90deg, #ff8800, #ffcc00)'
      : 'linear-gradient(90deg, #00ff96, #00ffcc)';
  }
}

// ─── Minimap ─────────────────────────────────────────────────────────────────

const MINIMAP_SIZE = 160;
const ARENA_SIZE = 200;
const SCALE = MINIMAP_SIZE / ARENA_SIZE;

export function updateMinimap(serpentManager, zoneManager) {
  const canvas = document.getElementById('minimap');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);

  // Background
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.beginPath();
  ctx.arc(MINIMAP_SIZE / 2, MINIMAP_SIZE / 2, MINIMAP_SIZE / 2, 0, Math.PI * 2);
  ctx.fill();

  // Grid
  ctx.strokeStyle = 'rgba(0,100,150,0.2)';
  ctx.lineWidth = 0.5;
  for (let i = 0; i <= 4; i++) {
    const p = i / 4 * MINIMAP_SIZE;
    ctx.beginPath(); ctx.moveTo(p, 0); ctx.lineTo(p, MINIMAP_SIZE); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, p); ctx.lineTo(MINIMAP_SIZE, p); ctx.stroke();
  }

  // Zone circle
  const zr = (zoneManager.currentSize * 0.5) * SCALE;
  ctx.beginPath();
  ctx.arc(MINIMAP_SIZE / 2, MINIMAP_SIZE / 2, zr, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255, 60, 60, 0.7)';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Serpents
  ctx.save();
  ctx.beginPath();
  ctx.arc(MINIMAP_SIZE / 2, MINIMAP_SIZE / 2, MINIMAP_SIZE / 2, 0, Math.PI * 2);
  ctx.clip();

  for (const s of serpentManager.serpents) {
    if (!s.alive) continue;
    const mx = (s.headPos.x / ARENA_SIZE + 0.5) * MINIMAP_SIZE;
    const mz = (s.headPos.z / ARENA_SIZE + 0.5) * MINIMAP_SIZE;

    ctx.beginPath();
    ctx.arc(mx, mz, s.isPlayer ? 4 : 2.5, 0, Math.PI * 2);
    ctx.fillStyle = '#' + s.color.getHexString();
    if (s.isPlayer) {
      ctx.shadowColor = '#' + s.color.getHexString();
      ctx.shadowBlur = 6;
    }
    ctx.fill();
    ctx.shadowBlur = 0;
  }
  ctx.restore();
}

// ─── Leaderboard ─────────────────────────────────────────────────────────────

export function updateLeaderboard(serpentManager) {
  const el = document.getElementById('lb-entries');
  if (!el) return;

  // Sort alive serpents by segment count descending, then dead ones
  const alive = serpentManager.serpents
    .filter(s => s.alive)
    .sort((a, b) => b.segmentCount - a.segmentCount);

  const top5 = alive.slice(0, 5);
  const playerInTop5 = top5.some(s => s.isPlayer);

  // If player is alive but not in top 5, append them
  const player = serpentManager.playerSerpent;
  const showExtra = player && player.alive && !playerInTop5;

  let html = '';
  top5.forEach((s, rank) => {
    const col = '#' + s.color.getHexString();
    const cls = s.isPlayer ? ' lb-player' : '';
    html += `<div class="lb-entry${cls}">
      <span class="lb-rank">${rank + 1}</span>
      <span class="lb-dot" style="background:${col};box-shadow:0 0 5px ${col}"></span>
      <span class="lb-name" style="color:${col}">${s.name}</span>
      <span class="lb-len">${s.segmentCount}</span>
    </div>`;
  });

  if (showExtra) {
    const rank = alive.indexOf(player) + 1;
    const col = '#' + player.color.getHexString();
    html += `<div class="lb-entry lb-player lb-sep">
      <span class="lb-rank">${rank}</span>
      <span class="lb-dot" style="background:${col};box-shadow:0 0 5px ${col}"></span>
      <span class="lb-name" style="color:${col}">${player.name}</span>
      <span class="lb-len">${player.segmentCount}</span>
    </div>`;
  }

  el.innerHTML = html;
}

// ─── Screens ─────────────────────────────────────────────────────────────────

export function showHUD(show) {
  const hud = document.getElementById('hud');
  if (hud) hud.style.display = show ? 'block' : 'none';
}

export function showCountdown(num) {
  const screen = document.getElementById('countdown-screen');
  const numEl = document.getElementById('countdown-num');
  if (!screen || !numEl) return;

  if (num === null) {
    screen.style.display = 'none';
    return;
  }

  screen.style.display = 'flex';
  numEl.textContent = num === 0 ? 'GO!' : String(num);
  numEl.style.color = num === 0 ? '#ffff00' : '#00ffcc';
  // Re-trigger animation
  numEl.style.animation = 'none';
  void numEl.offsetWidth;
  numEl.style.animation = 'countPulse 0.9s ease-out';
}

export function showStartScreen(show) {
  const el = document.getElementById('start-screen');
  if (el) el.style.display = show ? 'flex' : 'none';
}

export function showResults(won, stats) {
  const screen = document.getElementById('results-screen');
  const title = document.getElementById('results-title');
  const statsEl = document.getElementById('results-stats');
  if (!screen) return;

  screen.style.display = 'flex';
  title.textContent = won ? 'VICTORY!' : 'ELIMINATED';
  title.style.color = won ? '#ffcc00' : '#ff4444';
  title.style.textShadow = won ? '0 0 30px #ffcc00, 0 0 60px #ff8800' : '0 0 20px #ff4444';

  statsEl.innerHTML = `
    <div>Kills: <strong style="color:#00ffcc">${stats.kills}</strong></div>
    <div>Max Length: <strong style="color:#00ffcc">${stats.maxLength}</strong></div>
    <div>Placement: <strong style="color:#ffcc00">${stats.placement}</strong> / 8</div>
  `;
}

export function showDamageOverlay(intensity) {
  const el = document.getElementById('damage-overlay');
  if (el) el.style.opacity = Math.min(0.9, intensity).toString();
}

export function showAliveBanner(msg) {
  const el = document.getElementById('alive-banner');
  if (!el) return;
  el.textContent = msg;
  el.style.opacity = '1';
  el.style.color = msg.includes('WIN') ? '#ffcc00' : '#ff4444';
  el.style.textShadow = `0 0 20px currentColor`;
  setTimeout(() => { el.style.opacity = '0'; }, 2500);
}

// Show "KILLED BY [name]" overlay after player dies
export function showKilledBy(killerName, killerColorHex) {
  const el = document.getElementById('killed-by-overlay');
  if (!el) return;
  const nameEl = document.getElementById('killed-by-name');
  if (nameEl && killerName) {
    const col = '#' + killerColorHex.toString(16).padStart(6, '0');
    nameEl.textContent = killerName;
    nameEl.style.color = col;
    nameEl.style.textShadow = `0 0 20px ${col}`;
  }
  el.style.display = 'flex';
  // auto-hide after results screen appears
  setTimeout(() => { el.style.display = 'none'; }, 2200);
}

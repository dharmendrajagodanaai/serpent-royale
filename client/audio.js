// Procedural Web Audio API sound effects

let ctx = null;

function getCtx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  return ctx;
}

function resume() {
  const c = getCtx();
  if (c.state === 'suspended') c.resume();
}

// ─── Building blocks ─────────────────────────────────────────────────────────

function playTone(freq, type, duration, gainVal, when = 0) {
  const c = getCtx();
  const osc = c.createOscillator();
  const gain = c.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(gainVal, c.currentTime + when);
  gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + when + duration);
  osc.connect(gain); gain.connect(c.destination);
  osc.start(c.currentTime + when);
  osc.stop(c.currentTime + when + duration);
}

function playNoise(duration, filterFreq, gainVal, when = 0) {
  const c = getCtx();
  const bufLen = c.sampleRate * duration;
  const buf = c.createBuffer(1, bufLen, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;

  const src = c.createBufferSource();
  src.buffer = buf;

  const filter = c.createBiquadFilter();
  filter.type = 'bandpass';
  filter.frequency.value = filterFreq;
  filter.Q.value = 2;

  const gain = c.createGain();
  gain.gain.setValueAtTime(gainVal, c.currentTime + when);
  gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + when + duration);

  src.connect(filter); filter.connect(gain); gain.connect(c.destination);
  src.start(c.currentTime + when);
  src.stop(c.currentTime + when + duration);
}

// ─── Slither ambient ─────────────────────────────────────────────────────────

let _slitherSrc = null;
let _slitherGain = null;
let _slitherFilter = null;

// ─── Sound effects ───────────────────────────────────────────────────────────

export const Audio = {
  init() { resume(); },

  orbPickup() {
    resume();
    playTone(600, 'sine', 0.08, 0.15);
    playTone(900, 'sine', 0.06, 0.08, 0.05);
    playTone(1200, 'sine', 0.05, 0.06, 0.1);
  },

  boost() {
    resume();
    playNoise(0.18, 1800, 0.12);
    playTone(200, 'sawtooth', 0.15, 0.06);
  },

  death() {
    resume();
    // Bass impact
    playTone(80, 'sine', 0.4, 0.2);
    playTone(60, 'sine', 0.6, 0.15, 0.05);
    // Glass shatter (descending noise bursts)
    for (let i = 0; i < 5; i++) {
      playNoise(0.1, 2000 + i * 500, 0.08, i * 0.04);
    }
  },

  kill() {
    resume();
    playTone(400, 'square', 0.1, 0.1);
    playTone(600, 'square', 0.08, 0.08, 0.06);
    playTone(800, 'sine', 0.12, 0.1, 0.12);
  },

  zoneWarning() {
    resume();
    const c = getCtx();
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'square';
    osc.frequency.value = 440;
    osc.frequency.linearRampToValueAtTime(880, c.currentTime + 0.5);
    gain.gain.setValueAtTime(0.06, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.5);
    osc.connect(gain); gain.connect(c.destination);
    osc.start(c.currentTime); osc.stop(c.currentTime + 0.5);
  },

  victory() {
    resume();
    // Major chord arpeggio: C E G C
    const freqs = [261, 329, 392, 523];
    freqs.forEach((f, i) => playTone(f, 'sine', 0.5, 0.15, i * 0.12));
    freqs.forEach((f, i) => playTone(f * 2, 'sine', 0.3, 0.05, i * 0.12 + 0.5));
  },

  countdown() {
    resume();
    playTone(440, 'sine', 0.15, 0.2);
  },

  go() {
    resume();
    playTone(880, 'sine', 0.3, 0.25);
    playTone(1100, 'sine', 0.25, 0.15, 0.08);
    playTone(1320, 'sine', 0.4, 0.2, 0.16);
  },

  // Continuous ambient slither noise — call slitherStart() on match begin
  slitherStart() {
    this.slitherStop(); // stop any previous
    resume();
    const c = getCtx();

    // 1-second looping noise buffer
    const bufLen = c.sampleRate;
    const buf = c.createBuffer(1, bufLen, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) data[i] = Math.random() * 2 - 1;

    _slitherSrc = c.createBufferSource();
    _slitherSrc.buffer = buf;
    _slitherSrc.loop = true;

    _slitherFilter = c.createBiquadFilter();
    _slitherFilter.type = 'bandpass';
    _slitherFilter.frequency.value = 600;
    _slitherFilter.Q.value = 4;

    _slitherGain = c.createGain();
    _slitherGain.gain.value = 0.018;

    _slitherSrc.connect(_slitherFilter);
    _slitherFilter.connect(_slitherGain);
    _slitherGain.connect(c.destination);
    _slitherSrc.start();
  },

  // Call each frame with whether the player is currently boosting
  slitherUpdate(boosting) {
    if (!_slitherGain || !_slitherFilter) return;
    const c = getCtx();
    const targetGain = boosting ? 0.038 : 0.018;
    const targetFreq = boosting ? 1300 : 620;
    _slitherGain.gain.setTargetAtTime(targetGain, c.currentTime, 0.15);
    _slitherFilter.frequency.setTargetAtTime(targetFreq, c.currentTime, 0.15);
  },

  slitherStop() {
    if (_slitherSrc) {
      try { _slitherSrc.stop(); } catch (_) {}
      _slitherSrc = null;
      _slitherGain = null;
      _slitherFilter = null;
    }
  },
};

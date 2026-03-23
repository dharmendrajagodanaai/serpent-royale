// Procedural Web Audio API sound system

export class AudioManager {
  constructor() {
    this._ctx = null;
    this._masterGain = null;
    this._enabled = true;
    this._initialized = false;

    // Lazy init on first user gesture
    const init = () => {
      if (this._initialized) return;
      this._init();
      document.removeEventListener('click', init);
      document.removeEventListener('keydown', init);
    };
    document.addEventListener('click', init);
    document.addEventListener('keydown', init);
  }

  _init() {
    try {
      this._ctx = new (window.AudioContext || window.webkitAudioContext)();
      this._masterGain = this._ctx.createGain();
      this._masterGain.gain.value = 0.55;
      this._masterGain.connect(this._ctx.destination);
      this._initialized = true;

      // Start ambient drone
      this._startAmbient();
    } catch (e) {
      this._enabled = false;
    }
  }

  _startAmbient() {
    if (!this._ctx) return;
    const osc = this._ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = 55;
    const gainNode = this._ctx.createGain();
    gainNode.gain.value = 0.04;
    const filter = this._ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 200;
    osc.connect(filter);
    filter.connect(gainNode);
    gainNode.connect(this._masterGain);
    osc.start();
    this._ambientOsc = osc;
    this._ambientGain = gainNode;
  }

  _playTone(freq, type, duration, volumeStart, volumeEnd, startTime = 0) {
    if (!this._initialized || !this._enabled) return;
    const ctx = this._ctx;
    const t = ctx.currentTime + startTime;

    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(volumeStart, t);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.001, volumeEnd), t + duration);

    osc.connect(gain);
    gain.connect(this._masterGain);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  }

  _playNoise(duration, filterFreq, volume, startTime = 0) {
    if (!this._initialized || !this._enabled) return;
    const ctx = this._ctx;
    const t = ctx.currentTime + startTime;

    const bufSize = ctx.sampleRate * duration;
    const buffer = ctx.createBuffer(1, bufSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufSize; i++) data[i] = (Math.random() * 2 - 1);

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = filterFreq;
    filter.Q.value = 1.5;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(this._masterGain);
    source.start(t);
    source.stop(t + duration);
  }

  // ─── Sound events ─────────────────────────────────────────────────────────

  orbPickup() {
    // Ascending bell tone
    this._playTone(440, 'sine', 0.3, 0.3, 0.01);
    this._playTone(880, 'sine', 0.2, 0.15, 0.01, 0.05);
  }

  boost() {
    // Whoosh
    this._playNoise(0.3, 1800, 0.35);
    this._playTone(180, 'sawtooth', 0.3, 0.3, 0.01);
  }

  kill() {
    // Bass impact + sparkle
    this._playTone(60, 'sine', 0.4, 0.6, 0.01);
    this._playNoise(0.25, 3000, 0.3, 0.05);
    this._playTone(880, 'triangle', 0.15, 0.3, 0.01, 0.06);
  }

  death() {
    // Descending sad tone
    if (!this._initialized || !this._enabled) return;
    const ctx = this._ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(440, t);
    osc.frequency.exponentialRampToValueAtTime(55, t + 0.8);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.4, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
    osc.connect(gain);
    gain.connect(this._masterGain);
    osc.start(t);
    osc.stop(t + 1.0);
  }

  powerupCollect(kind) {
    const freqs = { FRENZY: 660, PHASE: 440, MAGNET: 550, VENOM: 330, SPLIT: 770 };
    const f = freqs[kind] || 550;
    this._playTone(f, 'square', 0.15, 0.4, 0.01);
    this._playTone(f * 1.5, 'sine', 0.2, 0.3, 0.01, 0.08);
    this._playTone(f * 2, 'sine', 0.15, 0.2, 0.01, 0.16);
  }

  zoneWarning() {
    this._playTone(330, 'square', 0.08, 0.25, 0.01);
    this._playTone(330, 'square', 0.08, 0.25, 0.01, 0.2);
  }

  victory() {
    // Major triad arpeggio
    const notes = [261.6, 329.6, 392, 523.2];
    notes.forEach((f, i) => {
      this._playTone(f, 'sine', 0.4, 0.4, 0.01, i * 0.1);
    });
  }

  countdown() {
    this._playTone(440, 'triangle', 0.15, 0.5, 0.01);
  }

  go() {
    this._playTone(523.2, 'sine', 0.3, 0.8, 0.01);
    this._playTone(659.2, 'sine', 0.3, 0.6, 0.01, 0.05);
    this._playTone(783.9, 'sine', 0.4, 0.8, 0.01, 0.1);
  }

  setAmbientSpeed(speed) {
    if (!this._ambientOsc || !this._ctx) return;
    const base = 55;
    const target = base + speed * 1.5;
    this._ambientOsc.frequency.linearRampToValueAtTime(target, this._ctx.currentTime + 0.3);
  }
}

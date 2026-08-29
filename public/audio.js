// Golden Bluff — self-contained synthesized music & sound effects.
// No external audio files and no network fetches: everything here is generated
// on the fly with the Web Audio API, so it works offline and never needs assets.
const AudioFX = (() => {
  let ctx = null;
  let master = null;
  let musicGain = null;
  let sfxGain = null;
  let ambientNodes = [];
  let ambientTimer = null;
  let started = false;
  let muted = false;
  try { muted = localStorage.getItem('gb-muted') === '1'; } catch (e) { /* private mode etc. */ }

  // Low, moody A-minor-ish pentatonic run used for the idle harp-pluck motif.
  const PENTATONIC = [220.0, 261.63, 293.66, 329.63, 392.0, 440.0, 523.25, 587.33];

  function ensureCtx() {
    if (ctx) {
      if (ctx.state === 'suspended') ctx.resume();
      return ctx;
    }
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    ctx = new Ctor();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 1;
    master.connect(ctx.destination);
    musicGain = ctx.createGain();
    musicGain.gain.value = 0.16;
    musicGain.connect(master);
    sfxGain = ctx.createGain();
    sfxGain.gain.value = 0.45;
    sfxGain.connect(master);
    return ctx;
  }

  function startAmbient() {
    if (!ensureCtx() || started) return;
    started = true;
    const t = ctx.currentTime;

    // A slow, evolving drone (two detuned pads + a sub) — the "torchlit hall" bed.
    [
      { f: 110, type: 'triangle', gain: 0.05 },
      { f: 110.7, type: 'triangle', gain: 0.045 },
      { f: 55, type: 'sine', gain: 0.09 },
    ].forEach(({ f, type, gain }, i) => {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = f;
      const filt = ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.value = 700;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gain, t + 3);
      osc.connect(filt); filt.connect(g); g.connect(musicGain);
      osc.start(t);

      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.04 + i * 0.015;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 220;
      lfo.connect(lfoGain); lfoGain.connect(filt.frequency);
      lfo.start(t);

      ambientNodes.push(osc, filt, g, lfo, lfoGain);
    });

    scheduleHarp();
  }

  function scheduleHarp() {
    const playNext = () => {
      if (!started) return;
      pluck(PENTATONIC[Math.floor(Math.random() * PENTATONIC.length)], 0.1, musicGain, 1.8);
      ambientTimer = setTimeout(playNext, 2200 + Math.random() * 3000);
    };
    ambientTimer = setTimeout(playNext, 1500);
  }

  function stopAmbient() {
    started = false;
    clearTimeout(ambientTimer);
    ambientNodes.forEach((n) => {
      try { n.stop && n.stop(); } catch (e) { /* already stopped */ }
      try { n.disconnect(); } catch (e) { /* already disconnected */ }
    });
    ambientNodes = [];
  }

  function pluck(freq, vol, dest, tail) {
    if (!ensureCtx()) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + tail);
    osc.connect(g); g.connect(dest);
    osc.start(t); osc.stop(t + tail + 0.05);
  }

  function tone(freq, { type = 'sine', vol = 0.2, attack = 0.02, decay = 0.3, dest, glideTo, delay = 0 } = {}) {
    if (!ensureCtx()) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, t + decay * 0.8);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    osc.connect(g); g.connect(dest || sfxGain);
    osc.start(t); osc.stop(t + attack + decay + 0.05);
  }

  function noiseBurst({ duration = 0.3, vol = 0.3, filterFreq = 800, dest } = {}) {
    if (!ensureCtx()) return;
    const t = ctx.currentTime;
    const size = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buf = ctx.createBuffer(1, size, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < size; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / size, 2);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filt = ctx.createBiquadFilter();
    filt.type = 'highpass';
    filt.frequency.value = filterFreq;
    const g = ctx.createGain();
    g.gain.value = vol;
    src.connect(filt); filt.connect(g); g.connect(dest || sfxGain);
    src.start(t);
  }

  function sfx(type) {
    if (!ensureCtx()) return;
    switch (type) {
      case 'click':
        tone(500, { type: 'square', vol: 0.06, attack: 0.002, decay: 0.05 });
        break;
      case 'deal':
        pluck(760 + Math.random() * 260, 0.11, sfxGain, 0.5);
        break;
      case 'flip':
        pluck(600, 0.09, sfxGain, 0.4);
        break;
      case 'claim':
        tone(320, { type: 'square', vol: 0.1, attack: 0.03, decay: 0.22, glideTo: 640 });
        break;
      case 'challenge':
        noiseBurst({ duration: 0.3, vol: 0.28, filterFreq: 900 });
        tone(130, { type: 'sawtooth', vol: 0.22, attack: 0.005, decay: 0.45, glideTo: 48 });
        break;
      case 'bust':
        tone(300, { type: 'sawtooth', vol: 0.16, attack: 0.01, decay: 0.18, glideTo: 160 });
        tone(160, { type: 'sawtooth', vol: 0.16, attack: 0.01, decay: 0.3, glideTo: 80, delay: 0.15 });
        break;
      case 'coin':
        tone(1046.5, { type: 'sine', vol: 0.16, attack: 0.005, decay: 0.35 });
        tone(1318.5, { type: 'sine', vol: 0.14, attack: 0.005, decay: 0.4, delay: 0.06 });
        break;
      case 'loss':
        tone(220, { type: 'triangle', vol: 0.18, attack: 0.01, decay: 0.35, glideTo: 90 });
        break;
      case 'shield':
        tone(500, { type: 'sine', vol: 0.2, attack: 0.015, decay: 0.45, glideTo: 720 });
        tone(300, { type: 'sine', vol: 0.12, attack: 0.02, decay: 0.5, delay: 0.05 });
        break;
      case 'defeat':
        tone(180, { type: 'sawtooth', vol: 0.22, attack: 0.01, decay: 0.7, glideTo: 60 });
        break;
      case 'win':
        [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
          tone(f, { type: 'triangle', vol: 0.18, attack: 0.02, decay: 0.9, delay: i * 0.14 });
        });
        break;
      default:
        break;
    }
  }

  function setMuted(m) {
    muted = !!m;
    if (ctx && master) master.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, 0.05);
    try { localStorage.setItem('gb-muted', muted ? '1' : '0'); } catch (e) { /* ignore */ }
  }
  function toggleMuted() { setMuted(!muted); return muted; }
  function isMuted() { return muted; }

  return { ensureCtx, startAmbient, stopAmbient, sfx, setMuted, toggleMuted, isMuted };
})();

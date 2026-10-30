/**
 * Procedural Web Audio Engine for Ghat Rush
 * Real-time synthesis of multi-layer bike engine RPM, exhaust pops, wind, tire squeal,
 * Indian traffic horns, Doppler near-miss whooshes, nitro roar, and background rhythms.
 */
export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.masterGain = null;
    this.engineGain = null;
    this.sfxGain = null;
    this.musicGain = null;

    // Engine synth nodes
    this.engineOsc1 = null;
    this.engineOsc2 = null;
    this.engineNoise = null;
    this.engineFilter = null;
    this.engineRunning = false;

    // Wind synth nodes
    this.windGain = null;
    this.windFilter = null;

    // BGM loop timer
    this.bgmTimer = null;

    this.initAudio();
  }

  initAudio() {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;

    this.ctx = new AudioCtx();
    this.masterGain = this.ctx.createGain();
    this.engineGain = this.ctx.createGain();
    this.sfxGain = this.ctx.createGain();
    this.musicGain = this.ctx.createGain();

    this.masterGain.gain.value = 0.85;
    this.engineGain.gain.value = 0.35;
    this.sfxGain.gain.value = 0.65;
    this.musicGain.gain.value = 0.28;

    this.engineGain.connect(this.masterGain);
    this.sfxGain.connect(this.masterGain);
    this.musicGain.connect(this.masterGain);
    this.masterGain.connect(this.ctx.destination);
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume();
    }
  }

  init() {
    this.resume();
    this.startEngine();
  }

  playMusic() {
    this.startMusic();
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(muted ? 0 : 0.85, this.ctx.currentTime);
    }
  }

  toggleMute() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  // --- Start Continuous Engine & Wind Synthesis ---
  startEngine() {
    if (!this.ctx || this.engineRunning) return;
    this.resume();
    const t = this.ctx.currentTime;

    // Sub oscillator (piston thump)
    this.engineOsc1 = this.ctx.createOscillator();
    this.engineOsc1.type = 'sawtooth';
    this.engineOsc1.frequency.setValueAtTime(45, t);

    // Harmonic oscillator (exhaust scream)
    this.engineOsc2 = this.ctx.createOscillator();
    this.engineOsc2.type = 'triangle';
    this.engineOsc2.frequency.setValueAtTime(90, t);

    // Exhaust low-pass filter
    this.engineFilter = this.ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.setValueAtTime(600, t);
    this.engineFilter.Q.setValueAtTime(2.5, t);

    this.engineOsc1.connect(this.engineFilter);
    this.engineOsc2.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain);

    this.engineOsc1.start();
    this.engineOsc2.start();

    // Wind noise buffer
    const bufferSize = this.ctx.sampleRate * 2;
    const noiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = Math.random() * 2 - 1;
    }

    const whiteNoise = this.ctx.createBufferSource();
    whiteNoise.buffer = noiseBuffer;
    whiteNoise.loop = true;

    this.windFilter = this.ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.setValueAtTime(400, t);
    this.windFilter.Q.setValueAtTime(1.2, t);

    this.windGain = this.ctx.createGain();
    this.windGain.gain.setValueAtTime(0.001, t);

    whiteNoise.connect(this.windFilter);
    this.windFilter.connect(this.windGain);
    this.windGain.connect(this.masterGain);

    whiteNoise.start();

    this.engineRunning = true;
  }

  updateEngine(rpmRatio, speedKmh, isNitro = false) {
    if (!this.ctx || !this.engineRunning) return;
    const t = this.ctx.currentTime;

    // RPM frequency scaling: 40 Hz (idle) up to 340 Hz (redline)
    const baseFreq = 42 + rpmRatio * 280;
    const harmonicFreq = baseFreq * 2.2;
    const filterFreq = 450 + rpmRatio * 2400 + (isNitro ? 1200 : 0);

    this.engineOsc1.frequency.setTargetAtTime(baseFreq, t, 0.04);
    this.engineOsc2.frequency.setTargetAtTime(harmonicFreq, t, 0.04);
    this.engineFilter.frequency.setTargetAtTime(filterFreq, t, 0.05);

    // Wind intensity scaling with speed
    const windVol = Math.min(0.28, Math.max(0.001, Math.pow(speedKmh / 300, 2) * 0.3));
    const windFreq = 300 + (speedKmh / 300) * 1200;
    this.windGain.gain.setTargetAtTime(windVol, t, 0.08);
    this.windFilter.frequency.setTargetAtTime(windFreq, t, 0.08);
  }

  // --- Discrete Sound Effects ---
  playGearShift() {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;

    // Clutch disengage drop & exhaust pop
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(180, t);
    osc.frequency.exponentialRampToValueAtTime(50, t + 0.08);

    gain.gain.setValueAtTime(0.2, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);

    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + 0.1);
  }

  playNearMiss() {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;

    // High velocity Doppler whoosh + metallic chord
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(950, t);
    osc.frequency.exponentialRampToValueAtTime(320, t + 0.22);

    gain.gain.setValueAtTime(0.35, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.24);

    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + 0.25);
  }

  playNitroIgnition() {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;

    // Deep sub bass boom + surging flame hiss
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(120, t);
    osc.frequency.exponentialRampToValueAtTime(35, t + 0.35);

    gain.gain.setValueAtTime(0.45, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);

    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + 0.42);
  }

  playTireSqueal() {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(800 + Math.random() * 200, t);
    osc.frequency.exponentialRampToValueAtTime(500, t + 0.15);

    gain.gain.setValueAtTime(0.08, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.15);

    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + 0.16);
  }

  playTrafficHorn() {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;

    // Classic dual-tone Indian vehicle horn (e.g. 420 Hz & 500 Hz)
    [420, 504].forEach(freq => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, t);

      gain.gain.setValueAtTime(0.12, t);
      gain.gain.setValueAtTime(0.12, t + 0.18);
      gain.gain.exponentialRampToValueAtTime(0.001, t + 0.24);

      osc.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(t);
      osc.stop(t + 0.25);
    });
  }

  playCrash() {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;

    // Low boom + metal crunch
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(140, t);
    osc.frequency.exponentialRampToValueAtTime(30, t + 0.6);

    gain.gain.setValueAtTime(0.5, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.65);

    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + 0.7);
  }

  // --- Energetic Indian-Fusion Electro BGM Loop ---
  startMusic() {
    if (this.bgmTimer || !this.ctx) return;
    this.resume();

    // D-minor Indian fusion pentatonic bass & synth arp
    const scale = [146.83, 164.81, 174.61, 220.00, 246.94, 293.66, 329.63, 349.23];
    let step = 0;
    const interval = 135; // ~133 BPM upbeat race tempo

    this.bgmTimer = setInterval(() => {
      if (this.muted || !this.ctx) return;
      const t = this.ctx.currentTime;
      const note = scale[step % scale.length];

      try {
        // Synth pluck
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = step % 4 === 0 ? 'sawtooth' : 'triangle';
        osc.frequency.setValueAtTime(note, t);

        gain.gain.setValueAtTime(0.04, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);

        osc.connect(gain);
        gain.connect(this.musicGain);
        osc.start(t);
        osc.stop(t + 0.2);

        // Tabla/Dholak bass kick on beats 0 & 2
        if (step % 2 === 0) {
          const kick = this.ctx.createOscillator();
          const kgain = this.ctx.createGain();
          kick.type = 'sine';
          kick.frequency.setValueAtTime(110, t);
          kick.frequency.exponentialRampToValueAtTime(45, t + 0.12);

          kgain.gain.setValueAtTime(0.09, t);
          kgain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);

          kick.connect(kgain);
          kgain.connect(this.musicGain);
          kick.start(t);
          kick.stop(t + 0.15);
        }
      } catch (e) {}

      step++;
    }, interval);
  }

  stopMusic() {
    if (this.bgmTimer) {
      clearInterval(this.bgmTimer);
      this.bgmTimer = null;
    }
  }
}

export const audio = new SoundEngine();

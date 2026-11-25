/**
 * Procedural Web Audio Engine for Ghat Rush
 * Real-time synthesis of multi-layer bike engine RPM, exhaust pops, wind, tire squeal,
 * Indian traffic horns, Doppler near-miss whooshes, nitro roar, and background rhythms.
 */
import { save } from './Save.js';

export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.muted = !!save.getSettings().audioMuted;
    this.paused = false;
    this.masterGain = null;
    this.engineGain = null;
    this.sfxGain = null;
    this.musicGain = null;

    // Engine synth nodes
    this.engineOsc1 = null;
    this.engineOsc2 = null;
    this.engineFilter = null;
    this.engineRunning = false;

    // Wind & Tyre Squeal & Rain Ambience synth nodes
    this.windSource = null;
    this.windGain = null;
    this.windFilter = null;

    this.squealOsc = null;
    this.squealFilter = null;
    this.squealGain = null;

    this.rainSource = null;
    this.rainFilter = null;
    this.rainGain = null;
    this.envAmbience = 'coastal';
    this.shiftEndTime = 0;

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

    this.masterGain.gain.value = this.muted ? 0 : 0.85;
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
      this.ctx.resume().catch(() => {});
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
    this.muted = !!muted;
    if (this.masterGain && this.ctx) {
      const t = this.ctx.currentTime;
      this.masterGain.gain.cancelScheduledValues(t);
      this.masterGain.gain.setValueAtTime(this.muted ? 0 : 0.85, t);
    }
    save.updateSettings({ audioMuted: this.muted });
  }

  toggleMute() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  setPaused(paused) {
    this.paused = !!paused;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (this.engineGain) {
      this.engineGain.gain.cancelScheduledValues(t);
      this.engineGain.gain.setValueAtTime(this.engineGain.gain.value, t);
      this.engineGain.gain.linearRampToValueAtTime(this.paused ? 0 : (this.engineRunning ? 0.35 : 0), t + 0.08);
    }
    if (this.windGain) {
      this.windGain.gain.cancelScheduledValues(t);
      this.windGain.gain.setValueAtTime(this.windGain.gain.value, t);
      this.windGain.gain.linearRampToValueAtTime(this.paused ? 0 : 0.001, t + 0.08);
    }
    if (this.squealGain) {
      this.squealGain.gain.cancelScheduledValues(t);
      this.squealGain.gain.setValueAtTime(0, t);
    }
    if (this.rainGain) {
      this.rainGain.gain.cancelScheduledValues(t);
      this.rainGain.gain.linearRampToValueAtTime(this.paused ? 0.01 : (this.envAmbience === 'monsoon' ? 0.11 : 0), t + 0.12);
    }
    if (this.musicGain) {
      this.musicGain.gain.cancelScheduledValues(t);
      this.musicGain.gain.setValueAtTime(this.musicGain.gain.value, t);
      this.musicGain.gain.linearRampToValueAtTime(this.paused ? 0.06 : 0.28, t + 0.12);
    }
  }

  // --- Start Continuous Engine & Wind Synthesis ---
  startEngine() {
    if (!this.ctx || this.engineRunning) return;
    this.resume();
    const t = this.ctx.currentTime;

    // Restore engine gain (in case stopEngine ramped it to 0 previously)
    this.engineGain.gain.cancelScheduledValues(t);
    this.engineGain.gain.setValueAtTime(this.paused ? 0 : 0.35, t);

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

    this.engineOsc1.start(t);
    this.engineOsc2.start(t);

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

    whiteNoise.start(t);
    this.windSource = whiteNoise;

    // Continuous Tyre Squeal synth (modulated cleanly when cornering near grip limit)
    this.squealOsc = this.ctx.createOscillator();
    this.squealOsc.type = 'sawtooth';
    this.squealOsc.frequency.setValueAtTime(880, t);
    this.squealFilter = this.ctx.createBiquadFilter();
    this.squealFilter.type = 'bandpass';
    this.squealFilter.frequency.setValueAtTime(1200, t);
    this.squealFilter.Q.setValueAtTime(3.2, t);
    this.squealGain = this.ctx.createGain();
    this.squealGain.gain.setValueAtTime(0, t);
    this.squealOsc.connect(this.squealFilter);
    this.squealFilter.connect(this.squealGain);
    this.squealGain.connect(this.sfxGain);
    this.squealOsc.start(t);

    this.engineRunning = true;
  }

  setEnvironmentAmbience(envType = 'coastal') {
    this.envAmbience = envType || 'coastal';
    if (!this.ctx) return;
    const t = this.ctx.currentTime;

    if (this.envAmbience === 'monsoon') {
      if (!this.rainSource) {
        const bufLen = this.ctx.sampleRate * 2;
        const rainBuf = this.ctx.createBuffer(1, bufLen, this.ctx.sampleRate);
        const ch = rainBuf.getChannelData(0);
        for (let i = 0; i < bufLen; i++) {
          ch[i] = Math.random() * 2 - 1;
        }
        const src = this.ctx.createBufferSource();
        src.buffer = rainBuf;
        src.loop = true;

        this.rainFilter = this.ctx.createBiquadFilter();
        this.rainFilter.type = 'bandpass';
        this.rainFilter.frequency.setValueAtTime(1450, t);
        this.rainFilter.Q.setValueAtTime(0.7, t);

        this.rainGain = this.ctx.createGain();
        this.rainGain.gain.setValueAtTime(this.paused ? 0.01 : 0.11, t);

        src.connect(this.rainFilter);
        this.rainFilter.connect(this.rainGain);
        this.rainGain.connect(this.masterGain);
        src.start(t);
        this.rainSource = src;
      } else if (this.rainGain) {
        this.rainGain.gain.setTargetAtTime(this.paused ? 0.01 : 0.11, t, 0.15);
      }
    } else if (this.rainSource) {
      const src = this.rainSource;
      this.rainSource = null;
      if (this.rainGain) {
        this.rainGain.gain.cancelScheduledValues(t);
        this.rainGain.gain.setValueAtTime(this.rainGain.gain.value, t);
        this.rainGain.gain.linearRampToValueAtTime(0, t + 0.25);
      }
      try {
        src.stop(t + 0.28);
        src.onended = () => { try { src.disconnect(); } catch (e) {} };
      } catch (e) {}
    }
  }

  stopEngine() {
    if (!this.ctx || !this.engineRunning) return;
    this.engineRunning = false;

    const t = this.ctx.currentTime;
    const osc1 = this.engineOsc1;
    const osc2 = this.engineOsc2;
    const wind = this.windSource;
    const squeal = this.squealOsc;

    this.engineOsc1 = null;
    this.engineOsc2 = null;
    this.windSource = null;
    this.squealOsc = null;

    if (this.engineGain) {
      this.engineGain.gain.cancelScheduledValues(t);
      this.engineGain.gain.setValueAtTime(this.engineGain.gain.value, t);
      this.engineGain.gain.linearRampToValueAtTime(0, t + 0.3);
    }
    if (this.windGain) {
      this.windGain.gain.cancelScheduledValues(t);
      this.windGain.gain.setValueAtTime(this.windGain.gain.value, t);
      this.windGain.gain.linearRampToValueAtTime(0, t + 0.3);
    }
    if (this.squealGain) {
      this.squealGain.gain.cancelScheduledValues(t);
      this.squealGain.gain.setValueAtTime(0, t);
    }

    [osc1, osc2, wind, squeal].forEach(node => {
      if (!node) return;
      try {
        node.stop(t + 0.31);
        node.onended = () => {
          try { node.disconnect(); } catch (e) {}
        };
      } catch (e) {}
    });
  }

  updateEngine(rpmRatio, speedKmh, isNitro = false, gripDemandRatio = 0) {
    if (!this.ctx || !this.engineRunning || this.paused) return;
    if (!this.engineOsc1 || !this.engineOsc2 || !this.engineFilter) return;
    const t = this.ctx.currentTime;

    // Smooth upshift pitch drop followed by smooth recovery
    const shiftDrop = this.shiftEndTime > t ? 0.28 * ((this.shiftEndTime - t) / 0.22) : 0;
    const effectiveRpm = Math.max(0.12, rpmRatio * (1 - shiftDrop));

    // RPM frequency scaling: 42 Hz (idle) up to ~322 Hz (redline)
    const baseFreq = 42 + effectiveRpm * 280;
    const harmonicFreq = baseFreq * 2.2;
    const filterFreq = 450 + effectiveRpm * 2400 + (isNitro ? 1200 : 0);

    this.engineOsc1.frequency.setTargetAtTime(baseFreq, t, 0.04);
    this.engineOsc2.frequency.setTargetAtTime(harmonicFreq, t, 0.04);
    this.engineFilter.frequency.setTargetAtTime(filterFreq, t, 0.05);

    // Wind intensity scaling with speed
    if (this.windGain && this.windFilter) {
      const windVol = Math.min(0.28, Math.max(0.001, Math.pow(speedKmh / 300, 2) * 0.3));
      const windFreq = 300 + (speedKmh / 300) * 1200;
      this.windGain.gain.setTargetAtTime(windVol, t, 0.08);
      this.windFilter.frequency.setTargetAtTime(windFreq, t, 0.08);
    }

    // Tyre squeal scaling near corner grip limit
    if (this.squealGain && this.squealOsc) {
      const activeSqueal = gripDemandRatio > 0.82 && speedKmh > 75;
      const squealVol = activeSqueal ? Math.min(0.14, (gripDemandRatio - 0.82) * 0.45) : 0;
      this.squealGain.gain.setTargetAtTime(squealVol, t, 0.05);
      if (activeSqueal) {
        this.squealOsc.frequency.setTargetAtTime(860 + Math.min(360, gripDemandRatio * 240), t, 0.05);
      }
    }
  }

  // --- Discrete Sound Effects ---
  playGearShift(isUpshift = true) {
    if (!this.ctx || this.muted || this.paused) return;
    const t = this.ctx.currentTime;
    if (isUpshift) {
      this.shiftEndTime = t + 0.22;
    }

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
    if (!this.ctx || this.muted || this.paused) return;
    const t = this.ctx.currentTime;

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
    if (!this.ctx || this.muted || this.paused) return;
    const t = this.ctx.currentTime;

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
    if (!this.ctx || this.muted || this.paused) return;
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
    if (!this.ctx || this.muted || this.paused) return;
    const t = this.ctx.currentTime;

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
    if (!this.ctx || this.muted || this.paused) return;
    const t = this.ctx.currentTime;

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

    const scale = [146.83, 164.81, 174.61, 220.00, 246.94, 293.66, 329.63, 349.23];
    let step = 0;
    const interval = 135;

    this.bgmTimer = setInterval(() => {
      if (this.muted || this.paused || !this.ctx) return;
      const t = this.ctx.currentTime;
      const note = scale[step % scale.length];

      try {
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

/**
 * Procedural Web Audio Engine for Ghat Rush
 * Real-time synthesis of multi-layer bike engine RPM with harmonic grit, gear shift pitch drops,
 * filtered-noise tire screech/drift, off-road gravel rumble, guardrail scrape sparks,
 * Doppler near-miss whooshes, nitro ignition, UI/checkpoint chimes, and speed-reactive synthwave BGM.
 * Includes external audio asset hooks (MP3/OGG) and persisted Music/SFX volume controls.
 */
import { save } from './Save.js';

export class SoundEngine {
  constructor() {
    this.ctx = null;
    const settings = save.getSettings();
    this.muted = !!settings.audioMuted;
    this.musicVolume = typeof settings.musicVolume === 'number' ? settings.musicVolume : 0.7;
    this.sfxVolume = typeof settings.sfxVolume === 'number' ? settings.sfxVolume : 0.8;
    this.paused = false;

    this.masterGain = null;
    this.engineGain = null;
    this.sfxGain = null;
    this.musicGain = null;
    this.bgmFilter = null;

    // Optional external audio buffer hooks (swap in MP3/OGG files anytime via loadExternalAudio)
    this.externalBuffers = {
      bgm: null,
      crash: null,
      boost: null,
      nearMiss: null,
      checkpoint: null,
      click: null
    };
    this.externalBgmSource = null;

    // Engine synth nodes
    this.engineOsc1 = null;
    this.engineOsc2 = null;
    this.engineShaper = null;
    this.engineFilter = null;
    this.engineRunning = false;

    // Wind, Filtered-Noise Tire Screech & Rain Ambience synth nodes
    this.sharedNoiseBuffer = null;
    this.windSource = null;
    this.windGain = null;
    this.windFilter = null;

    this.screechNoiseSource = null;
    this.screechNoiseFilter = null;
    this.squealOsc = null;
    this.squealFilter = null;
    this.squealGain = null;

    this.rainSource = null;
    this.rainFilter = null;
    this.rainGain = null;
    this.envAmbience = 'coastal';
    this.shiftEndTime = 0;
    this.currentSpeedKmh = 0;
    this.currentNitro = false;

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

    // Speed-reactive lowpass filter on BGM bus
    this.bgmFilter = this.ctx.createBiquadFilter();
    this.bgmFilter.type = 'lowpass';
    this.bgmFilter.frequency.value = 1400;
    this.bgmFilter.Q.value = 1.4;

    this.masterGain.gain.value = this.muted ? 0 : 0.85;
    this.engineGain.gain.value = 0.35 * this.sfxVolume;
    this.sfxGain.gain.value = 0.72 * this.sfxVolume;
    this.musicGain.gain.value = 0.36 * this.musicVolume;

    this.engineGain.connect(this.masterGain);
    this.sfxGain.connect(this.masterGain);
    this.bgmFilter.connect(this.musicGain);
    this.musicGain.connect(this.masterGain);
    this.masterGain.connect(this.ctx.destination);
  }

  /**
   * Optional hook to load external MP3/OGG files for any sound slot
   * @param {'bgm'|'crash'|'boost'|'nearMiss'|'checkpoint'|'click'} key
   * @param {string} url
   */
  async loadExternalAudio(key, url) {
    if (!this.ctx || !url) return false;
    try {
      const resp = await fetch(url);
      const arr = await resp.arrayBuffer();
      const audioBuf = await this.ctx.decodeAudioData(arr);
      this.externalBuffers[key] = audioBuf;
      return true;
    } catch (e) {
      return false;
    }
  }

  playExternalOneShot(key, volume = 1.0) {
    const buf = this.externalBuffers?.[key];
    if (!buf || !this.ctx || this.muted || this.paused) return false;
    const src = this.ctx.createBufferSource();
    const gain = this.ctx.createGain();
    src.buffer = buf;
    gain.gain.value = volume;
    src.connect(gain);
    gain.connect(this.sfxGain);
    src.start(0);
    return true;
  }

  getNoiseBuffer() {
    if (!this.ctx) return null;
    if (!this.sharedNoiseBuffer) {
      const bufferSize = this.ctx.sampleRate * 2;
      this.sharedNoiseBuffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
      const output = this.sharedNoiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
      }
    }
    return this.sharedNoiseBuffer;
  }

  makeDistortionCurve(amount = 18) {
    const nSamples = 256;
    const curve = new Float32Array(nSamples);
    const deg = Math.PI / 180;
    for (let i = 0; i < nSamples; i++) {
      const x = (i * 2) / nSamples - 1;
      curve[i] = ((3 + amount) * x * 20 * deg) / (Math.PI + amount * Math.abs(x));
    }
    return curve;
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

  setMusicVolume(vol) {
    this.musicVolume = Math.max(0, Math.min(1, Number(vol) || 0));
    if (this.musicGain && this.ctx) {
      const t = this.ctx.currentTime;
      const target = this.paused ? 0.06 * this.musicVolume : 0.36 * this.musicVolume;
      this.musicGain.gain.cancelScheduledValues(t);
      this.musicGain.gain.setTargetAtTime(target, t, 0.04);
    }
    save.updateSettings({ musicVolume: Number(this.musicVolume.toFixed(2)) });
  }

  setSfxVolume(vol) {
    this.sfxVolume = Math.max(0, Math.min(1, Number(vol) || 0));
    if (this.ctx) {
      const t = this.ctx.currentTime;
      if (this.sfxGain) {
        this.sfxGain.gain.cancelScheduledValues(t);
        this.sfxGain.gain.setTargetAtTime(0.72 * this.sfxVolume, t, 0.04);
      }
      if (this.engineGain && !this.paused && this.engineRunning) {
        this.engineGain.gain.cancelScheduledValues(t);
        this.engineGain.gain.setTargetAtTime(0.35 * this.sfxVolume, t, 0.04);
      }
    }
    save.updateSettings({ sfxVolume: Number(this.sfxVolume.toFixed(2)) });
  }

  setPaused(paused) {
    this.paused = !!paused;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    if (this.engineGain) {
      this.engineGain.gain.cancelScheduledValues(t);
      this.engineGain.gain.setValueAtTime(this.engineGain.gain.value, t);
      this.engineGain.gain.linearRampToValueAtTime(
        this.paused ? 0 : (this.engineRunning ? 0.35 * this.sfxVolume : 0),
        t + 0.08
      );
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
      this.rainGain.gain.linearRampToValueAtTime(
        this.paused ? 0.01 : (this.envAmbience === 'monsoon' ? 0.11 * this.sfxVolume : 0),
        t + 0.12
      );
    }
    if (this.musicGain) {
      this.musicGain.gain.cancelScheduledValues(t);
      this.musicGain.gain.setValueAtTime(this.musicGain.gain.value, t);
      this.musicGain.gain.linearRampToValueAtTime(
        (this.paused ? 0.06 : 0.36) * this.musicVolume,
        t + 0.12
      );
    }
  }

  // --- Start Continuous Engine, Wind & Filtered-Noise Tire Screech Synthesis ---
  startEngine() {
    if (!this.ctx || this.engineRunning) return;
    this.resume();
    const t = this.ctx.currentTime;

    this.engineGain.gain.cancelScheduledValues(t);
    this.engineGain.gain.setValueAtTime(this.paused ? 0 : 0.35 * this.sfxVolume, t);

    // Sub oscillator (piston thump)
    this.engineOsc1 = this.ctx.createOscillator();
    this.engineOsc1.type = 'sawtooth';
    this.engineOsc1.frequency.setValueAtTime(45, t);

    // Harmonic oscillator (exhaust rasp)
    this.engineOsc2 = this.ctx.createOscillator();
    this.engineOsc2.type = 'triangle';
    this.engineOsc2.frequency.setValueAtTime(92, t);

    // Harmonic grit waveshaper
    this.engineShaper = this.ctx.createWaveShaper();
    this.engineShaper.curve = this.makeDistortionCurve(14);
    this.engineShaper.oversample = '2x';

    // Exhaust low-pass filter
    this.engineFilter = this.ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.setValueAtTime(600, t);
    this.engineFilter.Q.setValueAtTime(2.6, t);

    this.engineOsc1.connect(this.engineShaper);
    this.engineOsc2.connect(this.engineShaper);
    this.engineShaper.connect(this.engineFilter);
    this.engineFilter.connect(this.engineGain);

    this.engineOsc1.start(t);
    this.engineOsc2.start(t);

    const noiseBuffer = this.getNoiseBuffer();

    // Wind rush noise source
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
    this.windGain.connect(this.sfxGain);

    whiteNoise.start(t);
    this.windSource = whiteNoise;

    // Continuous Filtered-Noise Tire Screech & Formant Resonance (fades in smoothly during slip/drift)
    const screechNoise = this.ctx.createBufferSource();
    screechNoise.buffer = noiseBuffer;
    screechNoise.loop = true;

    this.screechNoiseFilter = this.ctx.createBiquadFilter();
    this.screechNoiseFilter.type = 'bandpass';
    this.screechNoiseFilter.frequency.setValueAtTime(1450, t);
    this.screechNoiseFilter.Q.setValueAtTime(4.2, t);

    this.squealOsc = this.ctx.createOscillator();
    this.squealOsc.type = 'sawtooth';
    this.squealOsc.frequency.setValueAtTime(760, t);

    this.squealFilter = this.ctx.createBiquadFilter();
    this.squealFilter.type = 'bandpass';
    this.squealFilter.frequency.setValueAtTime(1250, t);
    this.squealFilter.Q.setValueAtTime(3.6, t);

    const oscSubGain = this.ctx.createGain();
    oscSubGain.gain.setValueAtTime(0.32, t);

    this.squealGain = this.ctx.createGain();
    this.squealGain.gain.setValueAtTime(0, t);

    screechNoise.connect(this.screechNoiseFilter);
    this.screechNoiseFilter.connect(this.squealGain);

    this.squealOsc.connect(this.squealFilter);
    this.squealFilter.connect(oscSubGain);
    oscSubGain.connect(this.squealGain);

    this.squealGain.connect(this.sfxGain);
    screechNoise.start(t);
    this.squealOsc.start(t);
    this.screechNoiseSource = screechNoise;

    this.engineRunning = true;
  }

  setEnvironmentAmbience(envType = 'coastal') {
    this.envAmbience = envType || 'coastal';
    if (!this.ctx) return;
    const t = this.ctx.currentTime;

    if (this.envAmbience === 'monsoon') {
      if (!this.rainSource) {
        const src = this.ctx.createBufferSource();
        src.buffer = this.getNoiseBuffer();
        src.loop = true;

        this.rainFilter = this.ctx.createBiquadFilter();
        this.rainFilter.type = 'bandpass';
        this.rainFilter.frequency.setValueAtTime(1450, t);
        this.rainFilter.Q.setValueAtTime(0.7, t);

        this.rainGain = this.ctx.createGain();
        this.rainGain.gain.setValueAtTime(this.paused ? 0.01 : 0.11 * this.sfxVolume, t);

        src.connect(this.rainFilter);
        this.rainFilter.connect(this.rainGain);
        this.rainGain.connect(this.masterGain);
        src.start(t);
        this.rainSource = src;
      } else if (this.rainGain) {
        this.rainGain.gain.setTargetAtTime(this.paused ? 0.01 : 0.11 * this.sfxVolume, t, 0.15);
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
    const screechNoise = this.screechNoiseSource;

    this.engineOsc1 = null;
    this.engineOsc2 = null;
    this.windSource = null;
    this.squealOsc = null;
    this.screechNoiseSource = null;

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

    [osc1, osc2, wind, squeal, screechNoise].forEach(node => {
      if (!node) return;
      try {
        node.stop(t + 0.31);
        node.onended = () => {
          try { node.disconnect(); } catch (e) {}
        };
      } catch (e) {}
    });
  }

  updateEngine(rpmRatio, speedKmh, isNitro = false, gripDemandRatio = 0, isSliding = false, offRoadFactor = 0) {
    this.currentSpeedKmh = speedKmh || 0;
    this.currentNitro = !!isNitro;

    if (!this.ctx || !this.engineRunning || this.paused) return;
    if (!this.engineOsc1 || !this.engineOsc2 || !this.engineFilter) return;
    const t = this.ctx.currentTime;

    // 1. Smooth upshift pitch drop followed by smooth recovery
    const shiftDrop = this.shiftEndTime > t ? 0.28 * ((this.shiftEndTime - t) / 0.22) : 0;
    const effectiveRpm = Math.max(0.12, rpmRatio * (1 - shiftDrop));

    // RPM frequency scaling: 42 Hz (idle) up to ~325 Hz (redline)
    const baseFreq = 42 + effectiveRpm * 282;
    const harmonicFreq = baseFreq * 2.18;
    const filterFreq = 480 + effectiveRpm * 2550 + (isNitro ? 1300 : 0);

    this.engineOsc1.frequency.setTargetAtTime(baseFreq, t, 0.035);
    this.engineOsc2.frequency.setTargetAtTime(harmonicFreq, t, 0.035);
    this.engineFilter.frequency.setTargetAtTime(filterFreq, t, 0.045);

    // 2. Speed-reactive BGM filter cutoff shift
    if (this.bgmFilter) {
      const speedNorm = Math.min(1.0, (speedKmh || 0) / 280);
      const bgmCutoff = 850 + speedNorm * 2600 + (isNitro ? 900 : 0);
      this.bgmFilter.frequency.setTargetAtTime(bgmCutoff, t, 0.12);
    }

    // 3. Wind & Off-Road Shoulder Rumble
    if (this.windGain && this.windFilter) {
      const baseWindVol = Math.min(0.26, Math.max(0.001, Math.pow(speedKmh / 300, 2) * 0.28));
      const shoulderRumbleVol = offRoadFactor > 0.1 ? offRoadFactor * 0.16 * Math.min(1, speedKmh / 100) : 0;
      const windFreq = offRoadFactor > 0.15
        ? 180 + (speedKmh / 300) * 450
        : 320 + (speedKmh / 300) * 1180;
      this.windGain.gain.setTargetAtTime(baseWindVol + shoulderRumbleVol, t, 0.06);
      this.windFilter.frequency.setTargetAtTime(windFreq, t, 0.06);
    }

    // 4. Filtered-Noise Tire Screech / Drift SFX
    if (this.squealGain && this.squealOsc && this.screechNoiseFilter) {
      const slipRatio = Math.max(gripDemandRatio, isSliding ? 0.96 : 0);
      const activeSqueal = slipRatio > 0.78 && speedKmh > 65;
      const squealVol = activeSqueal ? Math.min(0.22, (slipRatio - 0.78) * 0.55) : 0;
      this.squealGain.gain.setTargetAtTime(squealVol, t, 0.04);
      if (activeSqueal) {
        const pitchMod = 740 + Math.min(380, slipRatio * 240);
        this.squealOsc.frequency.setTargetAtTime(pitchMod, t, 0.04);
        this.screechNoiseFilter.frequency.setTargetAtTime(1250 + Math.min(750, slipRatio * 480), t, 0.04);
      }
    }
  }

  // --- Discrete One-Shot Sound Effects ---
  playGearShift(isUpshift = true) {
    if (!this.ctx || this.muted || this.paused) return;
    const t = this.ctx.currentTime;
    if (isUpshift) {
      this.shiftEndTime = t + 0.22;
    }

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(isUpshift ? 185 : 130, t);
    osc.frequency.exponentialRampToValueAtTime(isUpshift ? 48 : 210, t + 0.08);

    gain.gain.setValueAtTime(0.18, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);

    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + 0.1);
  }

  playNearMiss() {
    if (!this.ctx || this.muted || this.paused) return;
    if (this.playExternalOneShot('nearMiss', 0.8)) return;
    const t = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(980, t);
    osc.frequency.exponentialRampToValueAtTime(290, t + 0.24);

    gain.gain.setValueAtTime(0.35, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);

    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + 0.26);
  }

  playNitroIgnition() {
    if (!this.ctx || this.muted || this.paused) return;
    if (this.playExternalOneShot('boost', 0.85)) return;
    const t = this.ctx.currentTime;

    // Deep sub punch + rising turbine sweep
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(95, t);
    osc.frequency.exponentialRampToValueAtTime(260, t + 0.18);
    osc.frequency.exponentialRampToValueAtTime(55, t + 0.42);

    gain.gain.setValueAtTime(0.38, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.44);

    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + 0.45);
  }

  playRailScrape(intensity = 0.6) {
    if (!this.ctx || this.muted || this.paused) return;
    const t = this.ctx.currentTime;
    const noiseBuf = this.getNoiseBuffer();
    if (!noiseBuf) return;

    const src = this.ctx.createBufferSource();
    src.buffer = noiseBuf;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(2200, t);
    filter.Q.setValueAtTime(3.5, t);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(Math.min(0.3, 0.12 + intensity * 0.18), t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.16);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.sfxGain);
    src.start(t);
    src.stop(t + 0.17);
  }

  playCheckpoint() {
    if (!this.ctx || this.muted || this.paused) return;
    if (this.playExternalOneShot('checkpoint', 0.75)) return;
    const t = this.ctx.currentTime;

    [587.33, 880.0].forEach((freq, idx) => {
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();
      osc.type = 'triangle';
      const startT = t + idx * 0.075;
      osc.frequency.setValueAtTime(freq, startT);
      gain.gain.setValueAtTime(0.22, startT);
      gain.gain.exponentialRampToValueAtTime(0.001, startT + 0.22);
      osc.connect(gain);
      gain.connect(this.sfxGain);
      osc.start(startT);
      osc.stop(startT + 0.24);
    });
  }

  playUIClick() {
    if (!this.ctx || this.muted) return;
    this.resume();
    if (this.playExternalOneShot('click', 0.5)) return;
    const t = this.ctx.currentTime;

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(720, t);
    osc.frequency.exponentialRampToValueAtTime(1120, t + 0.045);

    gain.gain.setValueAtTime(0.14, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.05);

    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + 0.055);
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
    if (this.playExternalOneShot('crash', 0.9)) return;
    const t = this.ctx.currentTime;

    // 1. Low impact thud
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(145, t);
    osc.frequency.exponentialRampToValueAtTime(28, t + 0.55);

    gain.gain.setValueAtTime(0.52, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.6);

    osc.connect(gain);
    gain.connect(this.sfxGain);
    osc.start(t);
    osc.stop(t + 0.62);

    // 2. Metallic crunch noise burst
    const noiseBuf = this.getNoiseBuffer();
    if (noiseBuf) {
      const nSrc = this.ctx.createBufferSource();
      nSrc.buffer = noiseBuf;
      const nFilter = this.ctx.createBiquadFilter();
      nFilter.type = 'bandpass';
      nFilter.frequency.setValueAtTime(950, t);
      nFilter.Q.setValueAtTime(1.1, t);
      const nGain = this.ctx.createGain();
      nGain.gain.setValueAtTime(0.36, t);
      nGain.gain.exponentialRampToValueAtTime(0.001, t + 0.42);
      nSrc.connect(nFilter);
      nFilter.connect(nGain);
      nGain.connect(this.sfxGain);
      nSrc.start(t);
      nSrc.stop(t + 0.44);
    }
  }

  // --- Speed-Reactive Synthwave / Indian-Fusion Arcade Driving BGM ---
  startMusic() {
    if (this.bgmTimer || this.externalBgmSource || !this.ctx) return;
    this.resume();

    if (this.externalBuffers.bgm) {
      const src = this.ctx.createBufferSource();
      src.buffer = this.externalBuffers.bgm;
      src.loop = true;
      src.connect(this.bgmFilter);
      src.start(0);
      this.externalBgmSource = src;
      return;
    }

    // 16-step driving bassline (D2 / F2 / G2 / A2 / Bb2 / C3) + melodic lead arpeggio
    const bassPattern = [
      73.42, 73.42, 146.83, 73.42,
      87.31, 87.31, 98.00, 98.00,
      110.00, 110.00, 116.54, 110.00,
      98.00, 87.31, 82.41, 73.42
    ];
    const leadPattern = [
      293.66, 349.23, 440.00, 587.33,
      523.25, 440.00, 392.00, 349.23,
      440.00, 523.25, 659.25, 587.33,
      523.25, 466.16, 440.00, 329.63
    ];

    let step = 0;
    const stepMs = 130; // ~115 BPM 16th-note pulse
    const noiseBuf = this.getNoiseBuffer();

    this.bgmTimer = setInterval(() => {
      if (this.muted || this.paused || !this.ctx) return;
      const t = this.ctx.currentTime;
      const idx = step % 16;
      const speedNorm = Math.min(1.0, (this.currentSpeedKmh || 0) / 260);

      try {
        // 1. Driving Synth Bassline
        const bassOsc = this.ctx.createOscillator();
        const bassGain = this.ctx.createGain();
        bassOsc.type = idx % 2 === 0 ? 'sawtooth' : 'square';
        bassOsc.frequency.setValueAtTime(bassPattern[idx], t);

        const bassVol = 0.075 + speedNorm * 0.035;
        bassGain.gain.setValueAtTime(bassVol, t);
        bassGain.gain.exponentialRampToValueAtTime(0.001, t + 0.12);

        bassOsc.connect(bassGain);
        bassGain.connect(this.bgmFilter);
        bassOsc.start(t);
        bassOsc.stop(t + 0.13);

        // 2. Melodic Lead Synth (intensifies as speed rises)
        if (idx % 2 === 0 || speedNorm > 0.3) {
          const leadOsc = this.ctx.createOscillator();
          const leadGain = this.ctx.createGain();
          leadOsc.type = idx % 4 === 0 ? 'sawtooth' : 'triangle';
          leadOsc.frequency.setValueAtTime(leadPattern[idx], t);

          const leadVol = 0.038 + speedNorm * 0.045 + (this.currentNitro ? 0.02 : 0);
          leadGain.gain.setValueAtTime(leadVol, t);
          leadGain.gain.exponentialRampToValueAtTime(0.001, t + 0.18);

          leadOsc.connect(leadGain);
          leadGain.connect(this.bgmFilter);
          leadOsc.start(t);
          leadOsc.stop(t + 0.19);
        }

        // 3. Four-on-the-floor Kick Drum (steps 0, 4, 8, 12)
        if (idx % 4 === 0) {
          const kick = this.ctx.createOscillator();
          const kgain = this.ctx.createGain();
          kick.type = 'sine';
          kick.frequency.setValueAtTime(125, t);
          kick.frequency.exponentialRampToValueAtTime(42, t + 0.12);

          kgain.gain.setValueAtTime(0.14, t);
          kgain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);

          kick.connect(kgain);
          kgain.connect(this.musicGain);
          kick.start(t);
          kick.stop(t + 0.15);
        }

        // 4. Crisp Backbeat Snare (steps 4, 12) & Hi-Hat ticks
        if (noiseBuf) {
          const isSnare = (idx === 4 || idx === 12);
          const nSrc = this.ctx.createBufferSource();
          nSrc.buffer = noiseBuf;

          const nFilter = this.ctx.createBiquadFilter();
          nFilter.type = isSnare ? 'bandpass' : 'highpass';
          nFilter.frequency.setValueAtTime(isSnare ? 1600 : 6500, t);

          const nGain = this.ctx.createGain();
          const hatVol = isSnare ? (0.065 + speedNorm * 0.03) : (0.018 + speedNorm * 0.02);
          const dur = isSnare ? 0.095 : 0.035;
          nGain.gain.setValueAtTime(hatVol, t);
          nGain.gain.exponentialRampToValueAtTime(0.001, t + dur);

          nSrc.connect(nFilter);
          nFilter.connect(nGain);
          nGain.connect(this.bgmFilter);
          nSrc.start(t);
          nSrc.stop(t + dur + 0.01);
        }
      } catch (e) {}

      step++;
    }, stepMs);
  }

  stopMusic() {
    if (this.bgmTimer) {
      clearInterval(this.bgmTimer);
      this.bgmTimer = null;
    }
    if (this.externalBgmSource) {
      try {
        this.externalBgmSource.stop();
        this.externalBgmSource.disconnect();
      } catch (e) {}
      this.externalBgmSource = null;
    }
  }
}

export const audio = new SoundEngine();

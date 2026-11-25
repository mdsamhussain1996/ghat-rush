/**
 * Persistent Save System (localStorage)
 * Manages career stars, cash, bike garage, paint customizations, upgrades, and settings.
 */
const STORAGE_KEY = 'ghat_rush_save_v1';

export const UPGRADE_KEYS = ['engine', 'exhaust', 'tyres', 'brakes', 'nitro'];
export const MAX_UPGRADE_LEVEL = 3;

export class SaveManager {
  constructor() {
    this.data = this.load();
  }

  getDefaults() {
    return {
      cash: 8000,
      stars: 0,
      activeBikeId: 'vayu_150',
      unlockedBikes: ['vayu_150'],
      bikeUpgrades: {
        vayu_150: { engine: 0, exhaust: 0, tyres: 0, brakes: 0, nitro: 0 }
      },
      bikePaints: {
        vayu_150: { color: '#ff4d29', finish: 'gloss' }
      },
      careerProgress: {
        completedRaces: {},
        raceObjectives: {},
        bossesDefeated: {}
      },
      bestLaps: {},
      settings: {
        audioMuted: false,
        controlMode: 'buttons',
        quality: 'auto', // 'auto', 'low', 'medium', 'high'
        cameraView: 'chase',
        tiltEnabled: false,
        tiltSensitivity: 1.0
      }
    };
  }

  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        const defaults = this.getDefaults();
        return {
          ...defaults,
          ...parsed,
          settings: { ...defaults.settings, ...(parsed.settings || {}) },
          careerProgress: {
            completedRaces: {},
            raceObjectives: {},
            bossesDefeated: {},
            ...(parsed.careerProgress || {})
          }
        };
      }
    } catch (e) {}
    return this.getDefaults();
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
    } catch (e) {}
  }

  resetSave() {
    this.data = this.getDefaults();
    this.save();
    return this.data;
  }

  getCash() {
    return this.data.cash || 0;
  }

  addCash(amount) {
    this.data.cash = Math.max(0, (this.data.cash || 0) + Math.round(amount));
    this.save();
    return this.data.cash;
  }

  getActiveBikeId() {
    const id = this.data.activeBikeId || 'vayu_150';
    return this.isBikeUnlocked(id) ? id : 'vayu_150';
  }

  setActiveBikeId(id) {
    if (!this.isBikeUnlocked(id)) return false;
    this.data.activeBikeId = id;
    this.save();
    return true;
  }

  isBikeUnlocked(bikeId) {
    return Array.isArray(this.data.unlockedBikes) && this.data.unlockedBikes.includes(bikeId);
  }

  buyBike(bikeData) {
    if (!bikeData) return false;
    if (this.isBikeUnlocked(bikeData.id)) {
      this.setActiveBikeId(bikeData.id);
      return true;
    }
    const price = bikeData.price || 0;
    if (this.getCash() < price) return false;
    this.data.cash -= price;
    this.data.unlockedBikes.push(bikeData.id);
    if (!this.data.bikeUpgrades[bikeData.id]) {
      this.data.bikeUpgrades[bikeData.id] = { engine: 0, exhaust: 0, tyres: 0, brakes: 0, nitro: 0 };
    }
    this.data.activeBikeId = bikeData.id;
    this.save();
    return true;
  }

  getBikeUpgrades(bikeId) {
    const stored = this.data.bikeUpgrades?.[bikeId] || {};
    return {
      engine: Number(stored.engine) || 0,
      exhaust: Number(stored.exhaust) || 0,
      tyres: Number(stored.tyres) || 0,
      brakes: Number(stored.brakes) || 0,
      nitro: Number(stored.nitro) || 0
    };
  }

  getUpgradeCost(level) {
    return 2500 * (level + 1);
  }

  upgradeBike(bikeId, statKey) {
    if (!UPGRADE_KEYS.includes(statKey)) return { ok: false, reason: 'invalid_stat' };
    if (!this.isBikeUnlocked(bikeId)) return { ok: false, reason: 'locked' };
    const up = this.getBikeUpgrades(bikeId);
    const level = up[statKey] || 0;
    if (level >= MAX_UPGRADE_LEVEL) return { ok: false, reason: 'max_level' };
    const cost = this.getUpgradeCost(level);
    if (this.getCash() < cost) return { ok: false, reason: 'insufficient_cash', cost };

    this.data.cash -= cost;
    up[statKey] = level + 1;
    this.data.bikeUpgrades[bikeId] = up;
    this.save();
    return { ok: true, level: up[statKey], cost };
  }

  getBikePaint(bikeId, fallbackColor = '#ff4d29') {
    return this.data.bikePaints?.[bikeId] || { color: fallbackColor, finish: 'gloss' };
  }

  setBikePaint(bikeId, color, finish = 'gloss') {
    this.data.bikePaints[bikeId] = { color, finish };
    this.save();
  }

  getEffectiveBikeStats(bikeData) {
    if (!bikeData) return {};
    const up = this.getBikeUpgrades(bikeData.id);
    const paint = this.getBikePaint(bikeData.id, bikeData.color || '#ff4d29');
    return {
      ...bikeData,
      topSpeedKmh: Math.round((bikeData.topSpeedKmh || 180) * (1 + 0.04 * up.engine + 0.02 * up.exhaust)),
      accelMs: Number(((bikeData.accelMs || 4.2) * Math.max(0.65, 1 - 0.03 * up.engine - 0.05 * up.exhaust)).toFixed(2)),
      handling: Math.min(1.12, Number(((bikeData.handling || 0.88) + 0.04 * up.tyres).toFixed(3))),
      tyreGripBonus: Number((1.0 + 0.06 * up.tyres).toFixed(3)),
      brakeRate: 22.0 + 3.0 * up.brakes,
      nitroCapacity: Number(((bikeData.nitroCapacity || 3.5) + 0.55 * up.nitro).toFixed(2)),
      color: paint.color || bikeData.color || '#ff4d29'
    };
  }

  getCareerRaceObjectives(raceId) {
    return this.data.careerProgress?.raceObjectives?.[raceId] || [false, false, false];
  }

  recordCareerRace(raceId, achievedBoolArray = [false, false, false], wonBoss = false) {
    if (!this.data.careerProgress) {
      this.data.careerProgress = { completedRaces: {}, raceObjectives: {}, bossesDefeated: {} };
    }
    const prev = this.getCareerRaceObjectives(raceId);
    let newlyEarned = 0;
    const merged = [0, 1, 2].map((idx) => {
      const was = !!prev[idx];
      const now = !!achievedBoolArray[idx];
      if (!was && now) newlyEarned++;
      return was || now;
    });
    const earnedCount = achievedBoolArray.filter(Boolean).length;
    this.data.careerProgress.raceObjectives[raceId] = merged;
    this.data.careerProgress.completedRaces[raceId] = merged.filter(Boolean).length;
    if (wonBoss) {
      this.data.careerProgress.bossesDefeated[raceId] = true;
    }
    this.data.stars = (this.data.stars || 0) + newlyEarned;
    this.save();
    return { earnedCount, newlyEarned, objectives: merged };
  }

  getBestLap(trackId) {
    return this.data.bestLaps?.[trackId] || null;
  }

  recordBestLap(trackId, lapSec) {
    if (!trackId || !Number.isFinite(lapSec) || lapSec <= 0) return;
    if (!this.data.bestLaps) this.data.bestLaps = {};
    const prev = this.data.bestLaps[trackId];
    if (!prev || lapSec < prev) {
      this.data.bestLaps[trackId] = lapSec;
      this.save();
    }
  }

  getSettings() {
    return this.data.settings;
  }

  updateSettings(partial) {
    this.data.settings = { ...this.data.settings, ...partial };
    this.save();
  }

  addStars(count) {
    this.data.stars = (this.data.stars || 0) + count;
    this.save();
    return this.data.stars;
  }

  getStars() {
    return this.data.stars || 0;
  }
}

export const save = new SaveManager();

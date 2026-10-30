/**
 * Persistent Save System (localStorage)
 * Manages career stars, cash, bike garage, paint customizations, and upgrades.
 */
const STORAGE_KEY = 'ghat_rush_save_v1';

export class SaveManager {
  constructor() {
    this.data = this.load();
  }

  getDefaults() {
    return {
      cash: 124500, // Matching the concept_garage.png preview ₹ 1,24,500!
      stars: 0,
      activeBikeId: 'vayu_r7',
      unlockedBikes: ['vayu_150', 'vayu_r7'],
      bikeUpgrades: {
        vayu_r7: { engine: 3, exhaust: 2, tyres: 3, brakes: 3, nitro: 2 }
      },
      bikePaints: {
        vayu_r7: { color: '#ff4d29', finish: 'gloss' }
      },
      careerProgress: {
        completedRaces: {},
        leagueStars: {}
      },
      bestLaps: {},
      settings: {
        audioMuted: false,
        controlMode: 'buttons', // 'buttons', 'tilt', 'swipe'
        quality: 'high', // 'low', 'medium', 'high'
        cameraView: 'chase', // 'chase', 'close', 'helmet'
        tiltSensitivity: 1.0
      }
    };
  }

  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        return { ...this.getDefaults(), ...JSON.parse(raw) };
      }
    } catch (e) {}
    return this.getDefaults();
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
    } catch (e) {}
  }

  getCash() {
    return this.data.cash;
  }

  addCash(amount) {
    this.data.cash += amount;
    this.save();
    return this.data.cash;
  }

  getActiveBikeId() {
    return this.data.activeBikeId || 'vayu_r7';
  }

  setActiveBikeId(id) {
    this.data.activeBikeId = id;
    this.save();
  }

  getBikePaint(bikeId) {
    return this.data.bikePaints[bikeId] || { color: '#ff4d29', finish: 'gloss' };
  }

  setBikePaint(bikeId, color, finish = 'gloss') {
    this.data.bikePaints[bikeId] = { color, finish };
    this.save();
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
export const saveManager = save;

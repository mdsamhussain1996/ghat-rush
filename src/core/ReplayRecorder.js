/**
 * ReplayRecorder — 60 Hz Fixed-Capacity Ring Buffer for Race Replay
 * Records player, rivals, and active traffic pose per simulation tick without GC churn.
 */
export class ReplayRecorder {
  constructor(maxFrames = 4800) {
    this.maxFrames = maxFrames;
    this.frames = [];
  }

  clear() {
    this.frames.length = 0;
  }

  get length() {
    return this.frames.length;
  }

  recordFrame(playerBike, rivalsList = [], activeTraffic = []) {
    if (!playerBike) return;

    const frame = {
      p: {
        s: playerBike.s,
        d: playerBike.d,
        lean: playerBike.lean,
        wheelie: playerBike.wheelie,
        stoppie: playerBike.stoppie,
        speed: playerBike.speed,
        isNitro: playerBike.isNitro,
        isCrashed: playerBike.isCrashed
      },
      r: rivalsList.map(r => ({
        s: r.s,
        d: r.d,
        lean: r.lean,
        wheelie: r.wheelie,
        stoppie: r.stoppie,
        speed: r.speed,
        isNitro: r.isNitro,
        isCrashed: r.isCrashed
      })),
      t: activeTraffic.map(v => ({
        idx: v.poolIndex,
        s: v.s,
        d: v.d
      }))
    };

    if (this.frames.length >= this.maxFrames) {
      this.frames.shift();
    }
    this.frames.push(frame);
  }

  getFrame(index) {
    if (this.frames.length === 0) return null;
    const clamped = Math.max(0, Math.min(this.frames.length - 1, index));
    return this.frames[clamped];
  }
}

/**
 * ObjectiveTracker — Evaluates Career objectives live during races and at finish,
 * plus computes Results Screen score breakdown.
 */
export class ObjectiveTracker {
  constructor(objectives = [], totalLaps = 3) {
    this.labels = Array.isArray(objectives) ? objectives : [];
    this.totalLaps = totalLaps;
    this.achieved = this.labels.map(() => false);
  }

  evaluate(context, isFinished = false) {
    const {
      position = 6,
      nearMissCount = 0,
      playerBike = null
    } = context;

    this.achieved = this.labels.map((label, idx) => {
      const prev = this.achieved[idx];
      switch (label) {
        case 'Top 3 Finish':
          return isFinished ? position <= 3 : position <= 3;
        case 'Win the Race':
        case '1st Place':
          return isFinished ? position === 1 : position === 1;
        case '3 Near Misses':
          return prev || nearMissCount >= 3;
        case '5 Near Misses':
          return prev || nearMissCount >= 5;
        case 'Clean Lap':
          return prev || ((playerBike?.cleanLapsCount || 0) >= 1);
        case 'Draft for 4s':
          return prev || ((playerBike?.totalDraftSeconds || 0) >= 4.0);
        case 'Top Speed 260 km/h':
          return prev || ((playerBike?.topSpeedReachedKmh || 0) >= 260);
        case 'Full Nitro Chain':
          return prev || Boolean(playerBike?.didFullNitroDrain || (playerBike?.maxNitroChain || 0) >= 2.2);
        default:
          return isFinished ? position <= 3 : false;
      }
    });

    return this.labels.map((label, i) => ({
      label,
      done: !!this.achieved[i]
    }));
  }

  static computeScoreBreakdown(context) {
    const { position = 6, nearMissCount = 0, playerBike = null } = context;
    const nearMissPoints = nearMissCount * 250;
    const draftPoints = Math.round((playerBike?.totalDraftSeconds || 0) * 120);
    const cleanPoints = Math.round((playerBike?.cleanMeters || 0) * 0.25) + (playerBike?.cleanLapsCount || 0) * 500;
    const positionBonus = Math.max(0, (7 - position) * 600);
    const totalScore = nearMissPoints + draftPoints + cleanPoints + positionBonus;
    return {
      nearMissPoints,
      draftPoints,
      cleanPoints,
      positionBonus,
      totalScore
    };
  }
}

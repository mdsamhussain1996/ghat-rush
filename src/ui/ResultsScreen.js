/**
 * ResultsScreen — Post-race Podium & Rewards Display
 * Renders cached race result metrics without mutating persistent storage on re-open (e.g. exiting replay).
 */
export class ResultsScreen {
  constructor(container, onRestart, onReplay) {
    this.container = container || document.body;
    this.onRestart = onRestart;
    this.onReplay = onReplay;

    this.root = document.createElement('div');
    this.root.id = 'results-screen';
    this.root.className = 'ui-modal hidden';
    this.container.appendChild(this.root);
  }

  formatTime(sec) {
    if (!Number.isFinite(sec) || sec <= 0 || sec >= 9000) return '--:--.--';
    const mins = Math.floor(sec / 60);
    const secs = Math.floor(sec % 60);
    const ms = Math.floor((sec * 100) % 100);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
  }

  show(data) {
    const {
      position,
      totalRacers,
      raceTime,
      nearMisses,
      bestLap,
      cashWon = Math.max(5000, (4 - position) * 12000) + nearMisses * 350,
      starsWon = position === 1 ? 3 : (position <= 3 ? 2 : 1)
    } = data;

    const isPodium = position <= 3;
    const timeFormatted = this.formatTime(raceTime);
    const bestLapFormatted = this.formatTime(bestLap);

    this.root.innerHTML = `
      <div class="results-card">
        <h1 class="results-title ${isPodium ? 'victory-title' : ''}">${position === 1 ? 'VICTORY!' : (isPodium ? 'PODIUM FINISH!' : 'RACE FINISHED')}</h1>
        <div class="results-position-badge">
          <span class="pos-big">${position}</span><span class="pos-sub">/${totalRacers}</span>
        </div>

        <div class="results-stats-grid">
          <div class="stat-box">
            <div class="stat-label">TOTAL TIME</div>
            <div class="stat-value">${timeFormatted}</div>
          </div>
          <div class="stat-box">
            <div class="stat-label">BEST LAP</div>
            <div class="stat-value">${bestLapFormatted}</div>
          </div>
          <div class="stat-box">
            <div class="stat-label">NEAR MISSES</div>
            <div class="stat-value text-accent">${nearMisses}</div>
          </div>
          <div class="stat-box">
            <div class="stat-label">PRIZE MONEY</div>
            <div class="stat-value text-gold">+₹ ${cashWon.toLocaleString('en-IN')}</div>
          </div>
          <div class="stat-box" style="grid-column: 1 / -1;">
            <div class="stat-label">STARS EARNED</div>
            <div class="stat-value text-stars">${'★'.repeat(starsWon)}${'☆'.repeat(3 - starsWon)}</div>
          </div>
        </div>

        <div class="results-actions">
          <button id="btn-replay" class="btn btn-secondary">WATCH REPLAY</button>
          <button id="btn-restart" class="btn btn-primary">RACE AGAIN</button>
        </div>
      </div>
    `;

    this.root.classList.remove('hidden');

    document.getElementById('btn-restart').onclick = () => {
      this.hide();
      if (this.onRestart) this.onRestart();
    };

    document.getElementById('btn-replay').onclick = () => {
      this.hide();
      if (this.onReplay) this.onReplay();
    };
  }

  hide() {
    this.root.classList.add('hidden');
  }
}

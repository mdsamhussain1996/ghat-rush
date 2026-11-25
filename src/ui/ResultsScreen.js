/**
 * ResultsScreen — Post-race Podium, Objectives & Score Breakdown
 * Renders cached metrics without mutating persistent storage on re-open (e.g. exiting replay).
 */
export class ResultsScreen {
  constructor(container, onRestart, onReplay, onNextRace = null, onMenu = null) {
    this.container = container || document.body;
    this.onRestart = onRestart;
    this.onReplay = onReplay;
    this.onNextRace = onNextRace;
    this.onMenu = onMenu;

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
      nearMisses = 0,
      bestLap,
      topSpeedKmh = 0,
      scoreBreakdown = { nearMissPoints: 0, draftPoints: 0, cleanPoints: 0, positionBonus: 0, totalScore: 0 },
      objectives = [],
      hasNextRace = false,
      cashWon = 5000,
      starsWon = 0
    } = data;

    const isPodium = position <= 3;
    const timeFormatted = this.formatTime(raceTime);
    const bestLapFormatted = this.formatTime(bestLap);

    const objectivesHtml = objectives.length > 0
      ? `<div class="results-objectives">${objectives.map(o =>
          `<div class="res-obj-item ${o.done ? 'done' : ''}">${o.done ? '★' : '☆'} ${o.label}</div>`
        ).join('')}</div>`
      : '';

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
            <div class="stat-value" id="res-best-lap">${bestLapFormatted}</div>
          </div>
          <div class="stat-box">
            <div class="stat-label">TOP SPEED</div>
            <div class="stat-value" id="res-top-speed">${topSpeedKmh} km/h</div>
          </div>
          <div class="stat-box">
            <div class="stat-label">TOTAL SCORE</div>
            <div class="stat-value text-accent" id="res-total-score">${scoreBreakdown.totalScore.toLocaleString('en-IN')}</div>
          </div>
          <div class="stat-box">
            <div class="stat-label">NEAR MISSES</div>
            <div class="stat-value">${nearMisses} <span class="stat-mini">(+${scoreBreakdown.nearMissPoints})</span></div>
          </div>
          <div class="stat-box">
            <div class="stat-label">PRIZE MONEY</div>
            <div class="stat-value text-gold">+₹ ${cashWon.toLocaleString('en-IN')}</div>
          </div>
          <div class="stat-box" style="grid-column: 1 / -1;">
            <div class="stat-label">SCORE BREAKDOWN · DRAFT +${scoreBreakdown.draftPoints} · CLEAN +${scoreBreakdown.cleanPoints} · FINISH +${scoreBreakdown.positionBonus}</div>
            <div class="stat-value text-stars">${'★'.repeat(starsWon)}${'☆'.repeat(Math.max(0, 3 - starsWon))}</div>
            ${objectivesHtml}
          </div>
        </div>

        <div class="results-actions">
          ${hasNextRace ? `<button id="btn-next-race" class="btn btn-primary">NEXT RACE</button>` : ''}
          <button id="btn-replay" class="btn btn-secondary">WATCH REPLAY</button>
          <button id="btn-restart" class="btn ${hasNextRace ? 'btn-secondary' : 'btn-primary'}">RACE AGAIN</button>
          <button id="btn-menu" class="btn btn-secondary">MAIN MENU</button>
        </div>
      </div>
    `;

    this.root.classList.remove('hidden');

    const nextBtn = document.getElementById('btn-next-race');
    if (nextBtn) {
      nextBtn.onclick = () => {
        this.hide();
        this.onNextRace?.();
      };
    }

    document.getElementById('btn-restart').onclick = () => {
      this.hide();
      this.onRestart?.();
    };

    document.getElementById('btn-replay').onclick = () => {
      this.hide();
      this.onReplay?.();
    };

    document.getElementById('btn-menu').onclick = () => {
      this.hide();
      this.onMenu?.();
    };
  }

  hide() {
    this.root.classList.add('hidden');
  }
}

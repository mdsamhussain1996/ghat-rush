/**
 * PauseMenu — In-Race Pause Overlay (Esc / P / HUD Pause button / visibilitychange)
 */
export class PauseMenu {
  constructor(container, callbacks = {}) {
    this.container = container || document.body;
    this.callbacks = callbacks;

    this.root = document.createElement('div');
    this.root.id = 'pause-menu';
    this.root.className = 'ui-modal hidden';
    this.container.appendChild(this.root);

    this.render();
  }

  render(muted = false, cameraMode = 'chase') {
    this.root.innerHTML = `
      <div class="results-card pause-card">
        <h1 class="results-title">PAUSED</h1>
        <p class="pause-sub">Take a breather or tweak your ride view</p>
        <div class="pause-actions">
          <button id="pause-btn-resume" class="btn btn-primary">RESUME</button>
          <button id="pause-btn-restart" class="btn btn-secondary">RESTART RACE</button>
          <button id="pause-btn-mute" class="btn btn-secondary">${muted ? '🔇 AUDIO: MUTED' : '🔊 AUDIO: ON'}</button>
          <button id="pause-btn-camera" class="btn btn-secondary">🎥 CAMERA: ${cameraMode.toUpperCase()}</button>
          <button id="pause-btn-quit" class="btn btn-secondary btn-danger-outline">QUIT TO MENU</button>
        </div>
      </div>
    `;

    this.muteBtn = this.root.querySelector('#pause-btn-mute');
    this.cameraBtn = this.root.querySelector('#pause-btn-camera');

    this.root.querySelector('#pause-btn-resume').onclick = () => this.callbacks.onResume?.();
    this.root.querySelector('#pause-btn-restart').onclick = () => this.callbacks.onRestart?.();
    this.muteBtn.onclick = () => this.callbacks.onToggleMute?.();
    this.cameraBtn.onclick = () => this.callbacks.onCycleCamera?.();
    this.root.querySelector('#pause-btn-quit').onclick = () => this.callbacks.onQuit?.();
  }

  updateState(muted, cameraMode) {
    if (this.muteBtn) {
      this.muteBtn.textContent = muted ? '🔇 AUDIO: MUTED' : '🔊 AUDIO: ON';
    }
    if (this.cameraBtn) {
      this.cameraBtn.textContent = `🎥 CAMERA: ${String(cameraMode || 'chase').toUpperCase()}`;
    }
  }

  show(muted = false, cameraMode = 'chase') {
    this.updateState(muted, cameraMode);
    this.root.classList.remove('hidden');
  }

  hide() {
    this.root.classList.add('hidden');
  }
}

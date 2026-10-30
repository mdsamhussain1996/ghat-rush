import { Game } from './core/Game.js';

// Initialize Game when DOM is ready
window.addEventListener('DOMContentLoaded', () => {
  const container = document.getElementById('game-container');
  window.gameInstance = new Game(container);
});

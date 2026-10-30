import * as THREE from 'three';

/**
 * WebGL Renderer Manager
 * Enforces performance budgets:
 * - Pixel ratio capped to min(window.devicePixelRatio, 1.5)
 * - ACESFilmicToneMapping for rich cinematic HDR colors
 * - Quality levels (Low, Medium, High) with dynamic resolution support
 */
export class Renderer {
  constructor(container) {
    this.container = container || document.body;
    this.canvas = document.createElement('canvas');
    this.canvas.id = 'game-canvas';
    this.container.appendChild(this.canvas);

    this.threeRenderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance',
      stencil: false,
      depth: true
    });

    this.threeRenderer.outputColorSpace = THREE.SRGBColorSpace;
    this.threeRenderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.threeRenderer.toneMappingExposure = 1.15;
    this.threeRenderer.shadowMap.enabled = true;
    this.threeRenderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.quality = 'high'; // 'low', 'med', 'high'
    this.dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    this.threeRenderer.setPixelRatio(this.dpr);

    this.handleResize();
    window.addEventListener('resize', () => this.handleResize());
  }

  handleResize() {
    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;
    this.threeRenderer.setSize(width, height, false);
    this.width = width;
    this.height = height;
  }

  setQuality(preset) {
    this.quality = preset;
    if (preset === 'low') {
      this.threeRenderer.setPixelRatio(1.0);
      this.threeRenderer.shadowMap.enabled = false;
    } else if (preset === 'med') {
      this.threeRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
      this.threeRenderer.shadowMap.enabled = true;
    } else {
      this.threeRenderer.setPixelRatio(this.dpr);
      this.threeRenderer.shadowMap.enabled = true;
    }
  }

  render(scene, camera) {
    this.threeRenderer.render(scene, camera);
  }

  getStats() {
    const info = this.threeRenderer.info;
    return {
      drawCalls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures
    };
  }
}

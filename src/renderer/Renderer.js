import * as THREE from 'three';

/**
 * Thin wrapper around THREE.WebGLRenderer owning the scene graph, the
 * camera, the shadow-casting sun light and resize handling.
 */
export class Renderer {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {object} [options]
   * @param {number} [options.fov=75]
   * @param {number} [options.pixelRatio=1]
   * @param {boolean} [options.shadows=true]
   * @param {number} [options.shadowMapSize=2048]
   */
  constructor(canvas, options = {}) {
    this.canvas = canvas;
    this.webgl = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
      alpha: false,
    });
    if (!this.webgl.capabilities.isWebGL2) throw new Error('WebGL2 is required');
    this.webgl.outputColorSpace = THREE.SRGBColorSpace;
    this.webgl.toneMapping = THREE.NoToneMapping;
    this.webgl.shadowMap.enabled = options.shadows ?? true;
    this.webgl.shadowMap.type = THREE.PCFShadowMap;
    this.webgl.shadowMap.autoUpdate = true;
    this.webgl.info.autoReset = false;

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x9fc6ff, 60, 140);
    this.scene.background = new THREE.Color(0x9fc6ff);

    this.camera = new THREE.PerspectiveCamera(options.fov ?? 75, 1, 0.05, 1500);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);

    // Sun/moon directional light: drives shadows for chunks and lighting for entities.
    this.sun = new THREE.DirectionalLight(0xffffff, 2.2);
    this.sun.castShadow = this.webgl.shadowMap.enabled;
    this.shadowExtent = 72;
    this.setShadowMapSize(options.shadowMapSize ?? 2048);
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.04;
    this.sun.shadow.radius = 1.5;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    // Ambient term for entity materials (chunks use their own voxel lighting).
    this.ambient = new THREE.HemisphereLight(0xbfd8ff, 0x6b5a45, 1.1);
    this.scene.add(this.ambient);

    this.pixelRatio = options.pixelRatio ?? 1;
    this.width = 1;
    this.height = 1;
    this.resize();
    this.onResize = () => this.resize();
    window.addEventListener('resize', this.onResize);
  }

  /**
   * Updates the shadow map resolution.
   * @param {number} size
   */
  setShadowMapSize(size) {
    const shadow = this.sun.shadow;
    shadow.mapSize.set(size, size);
    const cam = shadow.camera;
    cam.left = -this.shadowExtent;
    cam.right = this.shadowExtent;
    cam.top = this.shadowExtent;
    cam.bottom = -this.shadowExtent;
    cam.near = 1;
    cam.far = 400;
    cam.updateProjectionMatrix();
    if (shadow.map) {
      shadow.map.dispose();
      shadow.map = null;
    }
  }

  /**
   * Enables or disables shadow rendering.
   * @param {boolean} enabled
   */
  setShadowsEnabled(enabled) {
    this.webgl.shadowMap.enabled = enabled;
    this.sun.castShadow = enabled;
    // Materials must recompile to add/remove shadow code.
    this.scene.traverse((obj) => {
      if (obj.material) {
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        for (const m of mats) m.needsUpdate = true;
      }
    });
  }

  /**
   * Positions the shadow-casting light around a focus point, snapping to
   * shadow-map texels so shadows don't shimmer while moving.
   * @param {THREE.Vector3} focus
   * @param {THREE.Vector3} lightDir direction toward the light (normalised)
   */
  updateSun(focus, lightDir) {
    const cam = this.sun.shadow.camera;
    const texel = (this.shadowExtent * 2) / this.sun.shadow.mapSize.x;
    // Build light-space basis and snap the focus in that space.
    const up = Math.abs(lightDir.y) > 0.99 ? _right : _up;
    _lx.crossVectors(up, lightDir).normalize();
    _ly.crossVectors(lightDir, _lx).normalize();
    const u = Math.round(focus.dot(_lx) / texel) * texel;
    const v = Math.round(focus.dot(_ly) / texel) * texel;
    const w = focus.dot(lightDir);
    _snapped.copy(_lx).multiplyScalar(u).addScaledVector(_ly, v).addScaledVector(lightDir, w);
    this.sun.target.position.copy(_snapped);
    this.sun.position.copy(_snapped).addScaledVector(lightDir, 200);
    this.sun.target.updateMatrixWorld();
    this.sun.updateMatrixWorld();
    cam.updateMatrixWorld();
  }

  /** Resizes the drawing buffer to the canvas' CSS size. */
  resize() {
    const w = Math.max(1, this.canvas.clientWidth || window.innerWidth);
    const h = Math.max(1, this.canvas.clientHeight || window.innerHeight);
    this.width = w;
    this.height = h;
    this.webgl.setPixelRatio(this.pixelRatio);
    this.webgl.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /**
   * @param {number} ratio device pixel ratio multiplier
   */
  setPixelRatio(ratio) {
    this.pixelRatio = ratio;
    this.resize();
  }

  /** Renders the scene. */
  render() {
    this.webgl.info.reset();
    this.webgl.render(this.scene, this.camera);
  }

  /** Releases the WebGL context and listeners. */
  dispose() {
    window.removeEventListener('resize', this.onResize);
    // The canvas keeps its GL context for the next session's renderer, whose
    // state cache assumes defaults: restore them (pixel store flags etc.).
    this.webgl.state.reset();
    this.webgl.dispose();
  }
}

const _up = new THREE.Vector3(0, 1, 0);
const _right = new THREE.Vector3(1, 0, 0);
const _lx = new THREE.Vector3();
const _ly = new THREE.Vector3();
const _snapped = new THREE.Vector3();

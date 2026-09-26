import { renderSound, renderLoop } from './SoundLibrary.js';

/** Volume categories mapped to settings keys. */
const CATEGORIES = {
  music: 'musicVolume',
  blocks: 'blocksVolume',
  ambient: 'ambientVolume',
  mobs: 'mobsVolume',
  player: 'playerVolume',
  ui: null,
};

const VARIANTS = 3;
const MAX_VOICES = 48;

/**
 * Web Audio engine: category buses with volume settings, a synthesised
 * reverb, positional 3D one-shots, looping ambiences and an underwater
 * muffle filter. Sounds are synthesised on first use and cached.
 */
export class AudioEngine {
  /**
   * @param {import('../settings/Settings.js').Settings} settings
   */
  constructor(settings) {
    this.settings = settings;
    /** @type {AudioContext|null} */
    this.ctx = null;
    this.buffers = new Map();
    this.buses = {};
    this.voices = 0;
    this.underwater = false;
    this.onSettings = (key) => {
      if (key === 'masterVolume' || Object.values(CATEGORIES).includes(key)) this.applyVolumes();
    };
    settings.on('change', this.onSettings);
  }

  /** Whether the audio context is running. */
  get ready() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /**
   * Creates/resumes the audio context. Must be called from a user gesture.
   */
  unlock() {
    if (typeof window === 'undefined' || !(window.AudioContext || window.webkitAudioContext)) return;
    if (!this.ctx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      this.ctx = new Ctx({ latencyHint: 'interactive' });
      this.build();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  /** @private */
  build() {
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.muffle = ctx.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = 20000;
    this.master.connect(this.muffle).connect(ctx.destination);
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.createImpulse(2.6);
    this.reverbGain = ctx.createGain();
    this.reverbGain.gain.value = 0.35;
    this.reverb.connect(this.reverbGain).connect(this.master);
    for (const cat of Object.keys(CATEGORIES)) {
      const g = ctx.createGain();
      g.connect(this.master);
      this.buses[cat] = g;
    }
    this.applyVolumes();
  }

  /** Synthesises an exponentially decaying stereo impulse response. @private */
  createImpulse(seconds) {
    const ctx = this.ctx;
    const len = Math.floor(seconds * ctx.sampleRate);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    return buf;
  }

  /** @private */
  applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.settings.get('masterVolume'), t, 0.02);
    for (const [cat, key] of Object.entries(CATEGORIES)) {
      this.buses[cat].gain.setTargetAtTime(key ? this.settings.get(key) : 1, t, 0.02);
    }
  }

  /**
   * Bus node of a category (music system, reverb sends).
   * @param {string} category
   * @returns {GainNode|null}
   */
  bus(category) {
    return this.buses[category] ?? null;
  }

  /** @private */
  getBuffers(id) {
    let list = this.buffers.get(id);
    if (list !== undefined) return list;
    list = [];
    for (let v = 0; v < VARIANTS; v++) {
      const data = renderSound(id, this.ctx.sampleRate, v * 7919 + id.length);
      if (!data) break;
      const buf = this.ctx.createBuffer(1, data.length, this.ctx.sampleRate);
      buf.getChannelData(0).set(data);
      list.push(buf);
    }
    this.buffers.set(id, list);
    return list;
  }

  /**
   * Plays a one-shot sound.
   * @param {string} id sound id (see SoundLibrary)
   * @param {object} [opts]
   * @param {{x:number,y:number,z:number}} [opts.position] world position (3D) — omit for 2D
   * @param {number} [opts.volume=1]
   * @param {number} [opts.pitch=1]
   * @param {string} [opts.category='blocks']
   * @param {number} [opts.reverb=0] send amount to reverb
   */
  play(id, { position, volume = 1, pitch = 1, category = 'blocks', reverb = 0 } = {}) {
    if (!this.ready || this.voices >= MAX_VOICES) return;
    const list = this.getBuffers(id);
    if (!list.length) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = list[Math.floor(Math.random() * list.length)];
    src.playbackRate.value = pitch * (0.92 + Math.random() * 0.16);
    const gain = ctx.createGain();
    gain.gain.value = volume;
    let node = src.connect(gain);
    if (position) {
      const panner = ctx.createPanner();
      panner.panningModel = 'equalpower';
      panner.distanceModel = 'inverse';
      panner.refDistance = 2.5;
      panner.maxDistance = 48;
      panner.rolloffFactor = 1.3;
      panner.positionX.value = position.x;
      panner.positionY.value = position.y;
      panner.positionZ.value = position.z;
      node = node.connect(panner);
    }
    node.connect(this.buses[category] ?? this.master);
    if (reverb > 0) {
      const send = ctx.createGain();
      send.gain.value = reverb;
      node.connect(send).connect(this.reverb);
    }
    this.voices++;
    src.onended = () => {
      this.voices--;
      src.disconnect();
    };
    src.start();
  }

  /**
   * Starts a looping ambience at zero volume.
   * @param {'wind'|'rain'|'water'|'cave'} kind
   * @param {string} [category='ambient']
   * @returns {{setVolume: (v:number, ramp?:number) => void, setFilter: (hz:number) => void, stop: () => void}|null}
   */
  loop(kind, category = 'ambient') {
    if (!this.ctx) return null;
    const ctx = this.ctx;
    const data = renderLoop(kind, ctx.sampleRate);
    const buf = ctx.createBuffer(1, data.length, ctx.sampleRate);
    buf.getChannelData(0).set(data);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 20000;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    src.connect(filter).connect(gain).connect(this.buses[category]);
    src.start(0, Math.random() * buf.duration);
    return {
      setVolume: (v, ramp = 0.5) => gain.gain.setTargetAtTime(v, ctx.currentTime, ramp),
      setFilter: (hz) => filter.frequency.setTargetAtTime(hz, ctx.currentTime, 0.3),
      stop: () => {
        src.stop();
        src.disconnect();
      },
    };
  }

  /**
   * Updates the 3D listener from a camera.
   * @param {import('three').Camera} camera
   * @param {{x:number,y:number,z:number}} forward
   */
  setListener(camera, forward) {
    if (!this.ctx) return;
    const l = this.ctx.listener;
    const t = this.ctx.currentTime;
    if (l.positionX) {
      l.positionX.setTargetAtTime(camera.position.x, t, 0.02);
      l.positionY.setTargetAtTime(camera.position.y, t, 0.02);
      l.positionZ.setTargetAtTime(camera.position.z, t, 0.02);
      l.forwardX.setTargetAtTime(forward.x, t, 0.02);
      l.forwardY.setTargetAtTime(forward.y, t, 0.02);
      l.forwardZ.setTargetAtTime(forward.z, t, 0.02);
      l.upX.value = 0;
      l.upY.value = 1;
      l.upZ.value = 0;
    } else {
      l.setPosition(camera.position.x, camera.position.y, camera.position.z);
      l.setOrientation(forward.x, forward.y, forward.z, 0, 1, 0);
    }
  }

  /**
   * Muffles all sound while the camera is underwater.
   * @param {boolean} underwater
   */
  setUnderwater(underwater) {
    if (!this.ctx || underwater === this.underwater) return;
    this.underwater = underwater;
    this.muffle.frequency.setTargetAtTime(underwater ? 600 : 20000, this.ctx.currentTime, 0.08);
  }

  /** Suspends output (pause menu in background tabs). */
  suspend() {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend().catch(() => {});
  }

  /** Releases the audio context. */
  dispose() {
    this.settings.off('change', this.onSettings);
    if (this.ctx) this.ctx.close().catch(() => {});
    this.ctx = null;
    this.buffers.clear();
  }
}

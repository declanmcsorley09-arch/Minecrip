import { SeededRandom } from '../utils/random.js';

/**
 * Tiny offline DSP toolkit used to synthesise every sound effect into
 * sample buffers (no audio assets). All functions operate on Float32Arrays.
 * @module audio/Synth
 */

/**
 * Sample-buffer builder with a deterministic random source.
 */
export class SynthBuffer {
  /**
   * @param {number} duration seconds
   * @param {number} sampleRate
   * @param {number} seed
   */
  constructor(duration, sampleRate, seed) {
    this.sampleRate = sampleRate;
    this.length = Math.max(1, Math.floor(duration * sampleRate));
    this.data = new Float32Array(this.length);
    this.rng = new SeededRandom(seed);
  }

  /** Seconds → sample index. */
  at(t) {
    return Math.floor(t * this.sampleRate);
  }

  /**
   * Adds a generated signal.
   * @param {number} start seconds
   * @param {number} duration seconds
   * @param {(t: number, i: number) => number} fn sample generator (t = local seconds)
   */
  add(start, duration, fn) {
    const s = this.at(start);
    const n = Math.min(this.length - s, this.at(duration));
    for (let i = 0; i < n; i++) this.data[s + i] += fn(i / this.sampleRate, i);
  }

  /** White noise sample in [-1, 1]. */
  noise() {
    return this.rng.next() * 2 - 1;
  }

  /**
   * Normalises the peak amplitude.
   * @param {number} [peak=0.9]
   * @returns {SynthBuffer}
   */
  normalize(peak = 0.9) {
    let max = 0;
    for (let i = 0; i < this.length; i++) max = Math.max(max, Math.abs(this.data[i]));
    if (max > 0) {
      const k = peak / max;
      for (let i = 0; i < this.length; i++) this.data[i] *= k;
    }
    return this;
  }

  /**
   * Short fade in/out to avoid clicks.
   * @param {number} [ms=4]
   * @returns {SynthBuffer}
   */
  fade(ms = 4) {
    const n = Math.min(this.length >> 1, Math.floor((ms / 1000) * this.sampleRate));
    for (let i = 0; i < n; i++) {
      const k = i / n;
      this.data[i] *= k;
      this.data[this.length - 1 - i] *= k;
    }
    return this;
  }
}

/**
 * One-pole low-pass filter in place.
 * @param {Float32Array} data
 * @param {number} cutoff Hz
 * @param {number} sampleRate
 */
export function lowpass(data, cutoff, sampleRate) {
  const a = 1 - Math.exp((-2 * Math.PI * cutoff) / sampleRate);
  let y = 0;
  for (let i = 0; i < data.length; i++) {
    y += a * (data[i] - y);
    data[i] = y;
  }
}

/**
 * One-pole high-pass filter in place.
 * @param {Float32Array} data
 * @param {number} cutoff Hz
 * @param {number} sampleRate
 */
export function highpass(data, cutoff, sampleRate) {
  const a = Math.exp((-2 * Math.PI * cutoff) / sampleRate);
  let prevX = 0;
  let y = 0;
  for (let i = 0; i < data.length; i++) {
    const x = data[i];
    y = a * (y + x - prevX);
    prevX = x;
    data[i] = y;
  }
}

/**
 * Biquad band-pass filter in place (constant 0 dB peak gain).
 * @param {Float32Array} data
 * @param {number} freq centre frequency (Hz), or a function of the sample index
 * @param {number} q quality factor
 * @param {number} sampleRate
 */
export function bandpass(data, freq, q, sampleRate) {
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  const dynamic = typeof freq === 'function';
  let b0;
  let b2;
  let a1;
  let a2;
  const coeffs = (f) => {
    const w = (2 * Math.PI * Math.min(f, sampleRate * 0.45)) / sampleRate;
    const alpha = Math.sin(w) / (2 * q);
    const a0 = 1 + alpha;
    b0 = alpha / a0;
    b2 = -alpha / a0;
    a1 = (-2 * Math.cos(w)) / a0;
    a2 = (1 - alpha) / a0;
  };
  if (!dynamic) coeffs(freq);
  for (let i = 0; i < data.length; i++) {
    if (dynamic && (i & 31) === 0) coeffs(freq(i));
    const x = data[i];
    const y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = x;
    y2 = y1;
    y1 = y;
    data[i] = y;
  }
}

/**
 * Exponential decay envelope value.
 * @param {number} t seconds
 * @param {number} decay seconds to ~1/e
 * @param {number} [attack=0.002]
 * @returns {number}
 */
export function env(t, decay, attack = 0.002) {
  if (t < attack) return t / attack;
  return Math.exp(-(t - attack) / decay);
}

/**
 * Karplus-Strong plucked string into a buffer (bow twangs, music).
 * @param {SynthBuffer} buf
 * @param {number} start seconds
 * @param {number} freq Hz
 * @param {number} duration seconds
 * @param {number} [gain=1]
 * @param {number} [damping=0.996]
 */
export function pluck(buf, start, freq, duration, gain = 1, damping = 0.996) {
  const period = Math.max(2, Math.round(buf.sampleRate / freq));
  const ring = new Float32Array(period);
  for (let i = 0; i < period; i++) ring[i] = buf.noise();
  const s = buf.at(start);
  const n = Math.min(buf.length - s, buf.at(duration));
  let idx = 0;
  for (let i = 0; i < n; i++) {
    const next = (idx + 1) % period;
    const v = ring[idx];
    ring[idx] = (v + ring[next]) * 0.5 * damping;
    buf.data[s + i] += v * gain;
    idx = next;
  }
}

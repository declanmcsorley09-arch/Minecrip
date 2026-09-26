import { SynthBuffer, lowpass, highpass, bandpass, env, pluck } from './Synth.js';

/**
 * Procedural recipes for every sound effect. Each recipe renders a mono
 * Float32Array for a given sample rate and variation seed.
 * @module audio/SoundLibrary
 */

/** Acoustic profile of each block material. */
const MATERIALS = {
  stone: { lp: 3600, hp: 350, dur: 0.09, tone: 165, toneAmt: 0.55, grit: 0.45 },
  wood: { lp: 2400, hp: 120, dur: 0.12, tone: 230, toneAmt: 0.9, grit: 0.15 },
  grass: { lp: 2800, hp: 450, dur: 0.15, tone: 0, toneAmt: 0, grit: 0.85 },
  gravel: { lp: 4400, hp: 650, dur: 0.17, tone: 0, toneAmt: 0, grit: 1.0 },
  sand: { lp: 1700, hp: 220, dur: 0.17, tone: 0, toneAmt: 0, grit: 0.5 },
  snow: { lp: 3200, hp: 900, dur: 0.15, tone: 0, toneAmt: 0, grit: 0.9 },
  glass: { lp: 9000, hp: 1600, dur: 0.08, tone: 2400, toneAmt: 0.55, grit: 0.25 },
  cloth: { lp: 950, hp: 120, dur: 0.13, tone: 0, toneAmt: 0, grit: 0.2 },
  water: { lp: 1500, hp: 160, dur: 0.2, tone: 0, toneAmt: 0, grit: 0.3 },
};

const KIND = {
  step: { len: 1, gain: 0.55, grit: 1 },
  dig: { len: 1.1, gain: 0.7, grit: 1.2 },
  place: { len: 1.2, gain: 0.95, grit: 0.8 },
  break: { len: 2.4, gain: 1, grit: 2.2 },
};

/**
 * Block interaction sound (footstep, dig, place, break).
 * @param {string} material
 * @param {string} kind
 * @param {number} sr
 * @param {number} seed
 * @returns {Float32Array}
 */
function materialSound(material, kind, sr, seed) {
  const m = MATERIALS[material] ?? MATERIALS.stone;
  const k = KIND[kind];
  const dur = m.dur * k.len;
  const b = new SynthBuffer(dur + 0.05, sr, seed);
  b.add(0, dur, (t) => b.noise() * env(t, dur * 0.35));
  const clicks = Math.floor(6 * m.grit * k.grit) + 1;
  for (let i = 0; i < clicks; i++) {
    const start = b.rng.range(0, dur * 0.8);
    const amp = b.rng.range(0.3, 1);
    b.add(start, 0.004, (t) => b.noise() * amp * env(t, 0.0015));
  }
  if (m.toneAmt > 0) {
    const f = m.tone * b.rng.range(0.85, 1.15);
    b.add(0, dur, (t) => Math.sin(2 * Math.PI * f * t) * m.toneAmt * env(t, material === 'glass' ? 0.05 : 0.03));
  }
  if (kind === 'break') {
    b.add(0, 0.08, (t) => Math.sin(2 * Math.PI * 90 * t) * 0.6 * env(t, 0.03));
  }
  lowpass(b.data, m.lp, sr);
  highpass(b.data, m.hp, sr);
  if (material === 'glass' && kind === 'break') {
    for (let i = 0; i < 14; i++) {
      const f = b.rng.range(2500, 6500);
      const start = b.rng.range(0, 0.25);
      b.add(start, 0.25, (t) => Math.sin(2 * Math.PI * f * t) * 0.25 * env(t, 0.06));
    }
  }
  return b.normalize(k.gain).fade(3).data;
}

/** Nasal animal vocalisation built from a buzzy source and a formant. */
function voice(sr, seed, { dur, f0, f1 = f0, vibrato = 0, vibratoRate = 6, formant, q = 3, noise = 0.05, pulses = 1, gain = 0.9 }) {
  const b = new SynthBuffer(dur, sr, seed);
  const jitter = b.rng.range(0.93, 1.07);
  let phase = 0;
  const pulseLen = dur / pulses;
  for (let i = 0; i < b.length; i++) {
    const t = i / sr;
    const local = t % pulseLen;
    const frac = t / dur;
    const f = (f0 + (f1 - f0) * frac) * jitter * (1 + Math.sin(2 * Math.PI * vibratoRate * t) * vibrato);
    phase += f / sr;
    const saw = 2 * (phase % 1) - 1;
    const envelope = Math.min(1, local / 0.03) * Math.min(1, (pulseLen - local) / (pulseLen * 0.35));
    b.data[i] = (saw + b.noise() * noise) * envelope;
  }
  bandpass(b.data, formant, q, sr);
  return b.normalize(gain).fade(5).data;
}

/**
 * Recipes keyed by sound id.
 * @type {Record<string, (sr: number, seed: number) => Float32Array>}
 */
const RECIPES = {
  'player.jump': (sr, seed) => {
    const b = new SynthBuffer(0.12, sr, seed);
    b.add(0, 0.12, (t) => b.noise() * env(t, 0.04, 0.01));
    lowpass(b.data, 900, sr);
    return b.normalize(0.35).fade().data;
  },
  'player.land': (sr, seed) => {
    const b = new SynthBuffer(0.25, sr, seed);
    b.add(0, 0.25, (t) => Math.sin(2 * Math.PI * (70 - t * 80) * t) * env(t, 0.06));
    b.add(0, 0.1, (t) => b.noise() * 0.5 * env(t, 0.03));
    lowpass(b.data, 700, sr);
    return b.normalize(0.9).fade().data;
  },
  'player.hurt': (sr, seed) => voice(sr, seed, { dur: 0.22, f0: 210, f1: 140, formant: 900, q: 2, noise: 0.3, gain: 0.85 }),
  'player.splash': (sr, seed) => {
    const b = new SynthBuffer(0.7, sr, seed);
    b.add(0, 0.7, (t) => b.noise() * env(t, 0.18, 0.01));
    bandpass(b.data, 1200, 0.8, sr);
    for (let i = 0; i < 10; i++) {
      const f = b.rng.range(500, 1400);
      const st = b.rng.range(0.05, 0.5);
      b.add(st, 0.08, (t) => Math.sin(2 * Math.PI * (f + t * 4000) * t) * 0.35 * env(t, 0.02));
    }
    return b.normalize(0.8).fade().data;
  },
  'player.swim': (sr, seed) => {
    const b = new SynthBuffer(0.35, sr, seed);
    b.add(0, 0.35, (t) => b.noise() * Math.sin(Math.PI * (t / 0.35)));
    bandpass(b.data, 700, 1.2, sr);
    return b.normalize(0.35).fade().data;
  },
  'player.eat': (sr, seed) => {
    const b = new SynthBuffer(0.18, sr, seed);
    for (let i = 0; i < 5; i++) {
      const st = b.rng.range(0, 0.12);
      b.add(st, 0.03, (t) => b.noise() * env(t, 0.008));
    }
    bandpass(b.data, 2200, 1.5, sr);
    return b.normalize(0.6).fade().data;
  },
  'player.pop': (sr, seed) => {
    const b = new SynthBuffer(0.08, sr, seed);
    b.add(0, 0.08, (t) => Math.sin(2 * Math.PI * (500 + t * 9000) * t) * env(t, 0.025));
    return b.normalize(0.45).fade(2).data;
  },
  'player.swing': (sr, seed) => {
    const b = new SynthBuffer(0.15, sr, seed);
    b.add(0, 0.15, (t) => b.noise() * Math.sin(Math.PI * t / 0.15));
    bandpass(b.data, (i) => 400 + (i / sr) * 12000, 1.5, sr);
    return b.normalize(0.18).fade().data;
  },
  'tool.break': (sr, seed) => {
    const b = new SynthBuffer(0.35, sr, seed);
    b.add(0, 0.35, (t) => (Math.sin(2 * Math.PI * 1800 * t) + Math.sin(2 * Math.PI * 2650 * t) * 0.6) * env(t, 0.05));
    b.add(0, 0.05, (t) => b.noise() * env(t, 0.01));
    return b.normalize(0.7).fade().data;
  },
  'mob.cow.ambient': (sr, seed) => voice(sr, seed, { dur: 1.1, f0: 115, f1: 95, vibrato: 0.02, vibratoRate: 4, formant: (i) => 500 + Math.sin(i / sr * 3) * 200, q: 2.5, noise: 0.08 }),
  'mob.cow.hurt': (sr, seed) => voice(sr, seed, { dur: 0.45, f0: 150, f1: 110, formant: 700, q: 2, noise: 0.15 }),
  'mob.pig.ambient': (sr, seed) => voice(sr, seed, { dur: 0.42, f0: 320, f1: 260, formant: 1100, q: 4, noise: 0.25, pulses: 2 }),
  'mob.pig.hurt': (sr, seed) => voice(sr, seed, { dur: 0.3, f0: 520, f1: 380, formant: 1400, q: 3, noise: 0.3 }),
  'mob.sheep.ambient': (sr, seed) => voice(sr, seed, { dur: 0.75, f0: 250, f1: 230, vibrato: 0.06, vibratoRate: 9, formant: 1000, q: 3, noise: 0.08 }),
  'mob.sheep.hurt': (sr, seed) => voice(sr, seed, { dur: 0.35, f0: 340, f1: 260, vibrato: 0.08, vibratoRate: 12, formant: 1200, q: 3, noise: 0.1 }),
  'mob.zombie.ambient': (sr, seed) => voice(sr, seed, { dur: 1.3, f0: 85, f1: 70, vibrato: 0.05, vibratoRate: 3, formant: (i) => 350 + Math.sin(i / sr * 5) * 150, q: 2, noise: 0.4 }),
  'mob.zombie.hurt': (sr, seed) => voice(sr, seed, { dur: 0.4, f0: 120, f1: 80, formant: 500, q: 2, noise: 0.5 }),
  'mob.skeleton.ambient': (sr, seed) => {
    const b = new SynthBuffer(0.45, sr, seed);
    for (let i = 0; i < 8; i++) {
      const st = b.rng.range(0, 0.38);
      const f = b.rng.range(900, 1600);
      b.add(st, 0.05, (t) => (Math.sin(2 * Math.PI * f * t) * 0.6 + b.noise() * 0.4) * env(t, 0.012));
    }
    highpass(b.data, 500, sr);
    return b.normalize(0.6).fade().data;
  },
  'mob.skeleton.hurt': (sr, seed) => RECIPES['mob.skeleton.ambient'](sr, seed + 7),
  'mob.death': (sr, seed) => voice(sr, seed, { dur: 0.6, f0: 260, f1: 90, formant: 800, q: 1.5, noise: 0.35, gain: 0.8 }),
  'mob.skeleton.shoot': (sr, seed) => {
    const b = new SynthBuffer(0.5, sr, seed);
    pluck(b, 0, 180, 0.5, 0.8, 0.993);
    b.add(0, 0.2, (t) => b.noise() * 0.3 * env(t, 0.06));
    lowpass(b.data, 2500, sr);
    return b.normalize(0.75).fade().data;
  },
  'mob.zombie.attack': (sr, seed) => materialSound('wood', 'place', sr, seed),
  'arrow.hit': (sr, seed) => materialSound('wood', 'dig', sr, seed),
  'weather.thunder': (sr, seed) => {
    const b = new SynthBuffer(4.5, sr, seed);
    let brown = 0;
    const peaks = [0, b.rng.range(0.3, 0.8), b.rng.range(1, 2)];
    for (let i = 0; i < b.length; i++) {
      const t = i / sr;
      brown = brown * 0.985 + b.noise() * 0.15;
      let a = 0;
      for (const p of peaks) if (t >= p) a += env(t - p, 0.9, 0.05);
      b.data[i] = brown * a;
    }
    lowpass(b.data, 380, sr);
    return b.normalize(1).fade(20).data;
  },
  'ui.click': (sr, seed) => {
    const b = new SynthBuffer(0.05, sr, seed);
    b.add(0, 0.05, (t) => (Math.sin(2 * Math.PI * 1300 * t) * 0.6 + b.noise() * 0.4) * env(t, 0.008));
    return b.normalize(0.45).fade(1).data;
  },
};

/**
 * Renders a sound by id.
 * @param {string} id
 * @param {number} sampleRate
 * @param {number} seed variation seed
 * @returns {Float32Array|null}
 */
export function renderSound(id, sampleRate, seed) {
  const recipe = RECIPES[id];
  if (recipe) return recipe(sampleRate, seed);
  const m = /^(step|dig|place|break)\.(\w+)$/.exec(id);
  if (m) return materialSound(m[2], m[1], sampleRate, seed);
  return null;
}

/**
 * Renders a seamless looping ambience buffer.
 * @param {'wind'|'rain'|'water'|'cave'} kind
 * @param {number} sampleRate
 * @returns {Float32Array}
 */
export function renderLoop(kind, sampleRate) {
  const dur = 6;
  const b = new SynthBuffer(dur, sampleRate, kind.length * 977);
  const n = b.length;
  if (kind === 'wind') {
    let brown = 0;
    for (let i = 0; i < n; i++) {
      brown = brown * 0.995 + b.noise() * 0.06;
      const t = i / sampleRate;
      b.data[i] = brown * (0.6 + 0.4 * Math.sin((2 * Math.PI * t) / dur) * Math.sin((2 * Math.PI * 3 * t) / dur));
    }
    bandpass(b.data, (i) => 300 + 250 * Math.sin((2 * Math.PI * i) / n * 2), 0.7, sampleRate);
  } else if (kind === 'rain') {
    for (let i = 0; i < n; i++) b.data[i] = b.noise() * 0.5;
    highpass(b.data, 900, sampleRate);
    lowpass(b.data, 7000, sampleRate);
    for (let i = 0; i < 900; i++) {
      const st = b.rng.range(0, dur - 0.02);
      const amp = b.rng.range(0.2, 0.9);
      b.add(st, 0.012, (t) => b.noise() * amp * env(t, 0.003));
    }
  } else if (kind === 'water') {
    for (let i = 0; i < n; i++) b.data[i] = b.noise();
    bandpass(b.data, (i) => 500 + 300 * Math.sin((2 * Math.PI * i) / n * 5) + 150 * Math.sin((2 * Math.PI * i) / n * 13), 1.5, sampleRate);
    for (let i = 0; i < 60; i++) {
      const f = b.rng.range(400, 1100);
      const st = b.rng.range(0, dur - 0.1);
      b.add(st, 0.07, (t) => Math.sin(2 * Math.PI * (f + t * 3000) * t) * 0.3 * env(t, 0.02));
    }
  } else {
    let brown = 0;
    for (let i = 0; i < n; i++) {
      brown = brown * 0.998 + b.noise() * 0.02;
      b.data[i] = brown;
    }
    lowpass(b.data, 200, sampleRate);
  }
  // Crossfade the ends so the loop is seamless.
  const xf = Math.floor(0.25 * sampleRate);
  for (let i = 0; i < xf; i++) {
    const k = i / xf;
    b.data[i] = b.data[i] * k + b.data[n - xf + i] * (1 - k);
  }
  const out = b.data.slice(0, n - xf);
  let max = 0;
  for (const v of out) max = Math.max(max, Math.abs(v));
  if (max > 0) for (let i = 0; i < out.length; i++) out[i] *= 0.8 / max;
  return out;
}

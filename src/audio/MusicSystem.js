/**
 * Generative ambient music. Every few minutes a new piece is composed on
 * the fly — a slow chord progression with a wandering melody in a random
 * key and mode — and played with synthesised piano and pad voices through
 * the reverb. Notes are scheduled a couple of seconds ahead with the Web
 * Audio clock, so timing is sample accurate and nothing is pre-rendered
 * beyond one short sample per instrument.
 */

const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  minorPent: [0, 3, 5, 7, 10],
  majorPent: [0, 2, 4, 7, 9],
};
const PROGRESSIONS = [
  [0, 5, 3, 4],
  [0, 3, 5, 4],
  [0, 4, 5, 3],
  [5, 3, 0, 4],
];
const LOOKAHEAD = 2.5;

export class MusicSystem {
  /**
   * @param {import('./AudioEngine.js').AudioEngine} engine
   */
  constructor(engine) {
    this.engine = engine;
    this.wait = 25 + Math.random() * 40;
    this.piece = null;
    this.samples = null;
    this.enabled = true;
  }

  /** Renders the instrument samples (C4). @private */
  buildSamples() {
    const ctx = this.engine.ctx;
    const sr = ctx.sampleRate;
    const make = (dur, fn) => {
      const buf = ctx.createBuffer(1, Math.floor(dur * sr), sr);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = fn(i / sr);
      let max = 0;
      for (const v of d) max = Math.max(max, Math.abs(v));
      for (let i = 0; i < d.length; i++) d[i] *= 0.8 / max;
      return buf;
    };
    const f = 261.63;
    const piano = make(4, (t) => {
      let s = 0;
      for (let h = 1; h <= 6; h++) s += (Math.sin(2 * Math.PI * f * h * t * (1 + h * 0.0006)) / (h * h)) * Math.exp(-t * (0.9 + h * 0.5));
      return s * Math.min(1, t / 0.004);
    });
    const pad = make(5, (t) => {
      let s = 0;
      for (let h = 1; h <= 4; h++) s += Math.sin(2 * Math.PI * f * h * t + Math.sin(t * 3) * 0.2) / h;
      s += Math.sin(2 * Math.PI * f * 1.003 * t) * 0.5;
      return s * Math.min(1, t / 1.2) * Math.min(1, (5 - t) / 1.5);
    });
    this.samples = { piano, pad };
  }

  /** Composes a new piece. @private */
  compose() {
    const scaleNames = Object.keys(SCALES);
    const scale = SCALES[scaleNames[Math.floor(Math.random() * scaleNames.length)]];
    const root = [-5, -3, -2, 0, 2, 3][Math.floor(Math.random() * 6)];
    const bpm = 56 + Math.random() * 22;
    const beat = 60 / bpm;
    const progression = PROGRESSIONS[Math.floor(Math.random() * PROGRESSIONS.length)];
    const bars = 16 + Math.floor(Math.random() * 12);
    const notes = [];
    const degreeToSemis = (deg) => {
      const oct = Math.floor(deg / scale.length);
      const idx = ((deg % scale.length) + scale.length) % scale.length;
      return root + scale[idx] + oct * 12;
    };
    let melody = scale.length + 2;
    for (let bar = 0; bar < bars; bar++) {
      const chord = progression[bar % progression.length];
      const t0 = bar * 4 * beat;
      // Chord: root, third and fifth an octave below the melody.
      if (Math.random() < 0.85) {
        for (const off of [0, 2, 4]) notes.push({ t: t0, semis: degreeToSemis(chord + off) - 12, inst: 'pad', vol: 0.12 });
      }
      for (let b = 0; b < 4; b++) {
        if (Math.random() < 0.35) continue;
        melody += Math.floor(Math.random() * 5) - 2;
        melody = Math.max(scale.length - 1, Math.min(scale.length * 2 + 3, melody));
        const swing = b % 2 === 1 ? beat * 0.08 : 0;
        notes.push({ t: t0 + b * beat + swing, semis: degreeToSemis(melody), inst: 'piano', vol: 0.18 + Math.random() * 0.08 });
        if (Math.random() < 0.2) notes.push({ t: t0 + b * beat + beat / 2, semis: degreeToSemis(melody + 2), inst: 'piano', vol: 0.12 });
      }
    }
    notes.sort((a, b) => a.t - b.t);
    return { notes, index: 0, start: this.engine.ctx.currentTime + 0.5, length: bars * 4 * beat + 4 };
  }

  /**
   * Advances the music scheduler.
   * @param {number} dt
   */
  update(dt) {
    const engine = this.engine;
    if (!engine.ready || !this.enabled) return;
    if (!this.samples) this.buildSamples();
    const ctx = engine.ctx;
    if (!this.piece) {
      this.wait -= dt;
      if (this.wait <= 0 && engine.settings.get('musicVolume') > 0) this.piece = this.compose();
      return;
    }
    const p = this.piece;
    const horizon = ctx.currentTime + LOOKAHEAD;
    while (p.index < p.notes.length && p.start + p.notes[p.index].t < horizon) {
      this.schedule(p.notes[p.index], p.start);
      p.index++;
    }
    if (ctx.currentTime > p.start + p.length) {
      this.piece = null;
      this.wait = 120 + Math.random() * 240;
    }
  }

  /** @private */
  schedule(note, start) {
    const ctx = this.engine.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.samples[note.inst];
    src.playbackRate.value = Math.pow(2, note.semis / 12);
    const gain = ctx.createGain();
    gain.gain.value = note.vol;
    const bus = this.engine.bus('music');
    src.connect(gain);
    gain.connect(bus);
    const send = ctx.createGain();
    send.gain.value = 0.6;
    gain.connect(send).connect(this.engine.reverb);
    src.onended = () => {
      src.disconnect();
      gain.disconnect();
      send.disconnect();
    };
    src.start(Math.max(ctx.currentTime, start + note.t));
  }

  /** Stops the current piece (e.g. on quitting to the menu). */
  stop() {
    this.piece = null;
    this.wait = 20 + Math.random() * 30;
  }
}

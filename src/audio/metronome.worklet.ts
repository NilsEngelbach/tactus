/// <reference path="./worklet-env.d.ts" />
// Renders the metronome inside the audio thread. Every click starts on an exact
// sample computed from the tempo, so timing never depends on the main thread,
// timers or a background tab. Each rendered click is reported back with its
// AudioContext time; the page lights the beat when that time reaches the speaker.
import type { Accent, MetronomeMessage, TempoConfig, TickEvent } from './types';

type Kind = 0 | 1 | 2; // accent, normal, subdivision

interface Voice {
  buf: Float32Array;
  pos: number;
  gain: number;
}

const LENGTH = 0.09; // seconds per click sample (the claves ring longer)

/** The light-only voice: ticks are counted and reported, nothing sounds. */
const SILENT = 4;

/** Synthesises the click buffers: [voice][kind]. */
function buildSounds(sr: number): Float32Array[][] {
  const make = (fn: (t: number) => number, length = LENGTH) => {
    const n = Math.round(length * sr);
    const b = new Float32Array(n);
    for (let i = 0; i < n; i++) b[i] = fn(i / sr);
    // short fade-out so no buffer ends on a step
    const fade = Math.round(0.004 * sr);
    for (let i = 0; i < fade; i++) b[n - 1 - i] *= i / fade;
    return b;
  };
  let seed = 12345;
  const noise = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x3fffffff - 1;
  };
  const tau = Math.PI * 2;

  // Click: a bright sine ping with a 1 ms noise transient.
  const click = (f: number) =>
    make((t) => Math.sin(tau * f * t) * Math.exp(-t / 0.012) * 0.8 + (t < 0.001 ? noise() * 0.5 * (1 - t / 0.001) : 0));
  // Wood: two inharmonic damped partials, like a wood block.
  const wood = (f: number) =>
    make(
      (t) =>
        (Math.sin(tau * f * t) * Math.exp(-t / 0.025) * 0.75 +
          Math.sin(tau * f * 2.76 * t) * Math.exp(-t / 0.009) * 0.35 +
          (t < 0.0007 ? noise() * 0.4 : 0)) *
        0.9,
    );
  // Beep: a steady sine with soft edges, the classic digital metronome.
  const beep = (f: number) =>
    make((t) => {
      const env = t < 0.002 ? t / 0.002 : t < 0.05 ? 1 : Math.max(0, 1 - (t - 0.05) / 0.012);
      return Math.sin(tau * f * t) * env * 0.55;
    });

  // Brings a buffer to a common loudness (RMS of its first 40 ms), so it sits
  // level with the other voices, but never past a 0.95 peak
  // (no clipping at full level); ends it on a short fade.
  const level = (b: Float32Array, target: number) => {
    const m = Math.min(b.length, Math.round(0.04 * sr));
    let sum = 0;
    let peak = 0;
    for (let i = 0; i < m; i++) sum += b[i] * b[i];
    for (let i = 0; i < b.length; i++) peak = Math.max(peak, Math.abs(b[i]));
    const g = Math.min(target / Math.sqrt(sum / m), 0.95 / peak);
    for (let i = 0; i < b.length; i++) b[i] *= g;
    const fade = Math.round(0.004 * sr);
    for (let i = 0; i < fade; i++) b[b.length - 1 - i] *= i / fade;
    return b;
  };
  // Claves: a struck hardwood rod. One clear, ringing pitch; the rod's upper
  // modes (2.76x and 5.40x, a free bar) die away within milliseconds.
  // Accent and beat share the pitch (the gain sets them apart); subdivisions
  // are damped a little, like a softer stroke.
  const claves = (damp: number) => {
    const f = 2350;
    return level(
      make(
        (t) =>
          (t < 0.00025 ? t / 0.00025 : 1) *
          (Math.sin(tau * f * t) * Math.exp(-t / (0.055 * damp)) +
            Math.sin(tau * f * 2.756 * t) * Math.exp(-t / (0.012 * damp)) * 0.2 +
            Math.sin(tau * f * 5.404 * t) * Math.exp(-t / 0.004) * 0.05),
        0.22,
      ),
      0.26,
    );
  };
  return [
    [click(2093), click(1568), click(1175)],
    [wood(1250), wood(940), wood(760)],
    [beep(1760), beep(880), beep(660)],
    [claves(1), claves(1), claves(0.6)],
  ];
}

const KIND_GAIN: Record<Kind, number> = { 0: 1, 1: 0.72, 2: 0.42 };

class MetronomeProcessor extends AudioWorkletProcessor {
  private cfg: TempoConfig = { bpm: 120, beats: 4, subdiv: 1, accents: [2, 1, 1, 1], voice: 0, level: 0.8 };
  private sounds = buildSounds(sampleRate);
  private running = false;
  private nextFrame = 0; // fractional, so long runs never drift
  private tick = 0; // click index inside the bar
  private active: Voice[] = [];

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<MetronomeMessage>) => {
      const m = e.data;
      if (m.t === 'config') {
        const ticksPerBar = m.cfg.beats * m.cfg.subdiv;
        // Keep the current beat when the bar or subdivision changes.
        const beat = Math.floor(this.tick / this.cfg.subdiv);
        this.cfg = m.cfg;
        this.tick = (beat * m.cfg.subdiv) % ticksPerBar;
      } else if (m.t === 'start') {
        this.running = true;
        this.tick = 0;
        this.nextFrame = Math.max(currentFrame + 128, m.at * sampleRate);
      } else {
        this.running = false;
      }
    };
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    const left = out[0];
    const size = left.length;
    const end = currentFrame + size;

    if (this.running) {
      while (this.nextFrame < end) {
        const offset = Math.max(0, Math.round(this.nextFrame - currentFrame));
        this.trigger(offset);
        this.nextFrame += (sampleRate * 60) / this.cfg.bpm / this.cfg.subdiv;
      }
    }

    const master = this.cfg.level * this.cfg.level;
    for (let v = this.active.length - 1; v >= 0; v--) {
      const voice = this.active[v];
      const start = voice.pos < 0 ? -voice.pos : 0;
      const g = voice.gain * master;
      let p = Math.max(0, voice.pos);
      for (let i = start; i < size && p < voice.buf.length; i++, p++) left[i] += voice.buf[p] * g;
      voice.pos = p;
      if (p >= voice.buf.length) this.active.splice(v, 1);
    }
    for (let c = 1; c < out.length; c++) out[c].set(left);
    return true;
  }

  private trigger(offset: number) {
    const { subdiv, accents, voice } = this.cfg;
    const beat = Math.floor(this.tick / subdiv);
    const sub = this.tick % subdiv;
    const accent: Accent = accents[beat] ?? 1;
    const kind: Kind = sub > 0 ? 2 : accent === 2 ? 0 : 1;
    if (accent !== 0 && voice !== SILENT) {
      // An unknown voice (a page from an older version) clicks instead of
      // throwing: an exception here would kill the processor for good.
      const bank = this.sounds[voice] ?? this.sounds[0];
      // pos < 0 means "starts |pos| frames into this block"
      this.active.push({ buf: bank[kind], pos: -offset, gain: KIND_GAIN[kind] });
    }
    const ev: TickEvent = { t: 'tick', time: (currentFrame + offset) / sampleRate, beat, sub, accent };
    this.port.postMessage(ev);
    this.tick = (this.tick + 1) % (this.cfg.beats * subdiv);
  }
}

registerProcessor('tactus-metronome', MetronomeProcessor);

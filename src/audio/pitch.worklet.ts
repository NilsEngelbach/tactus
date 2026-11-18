/// <reference path="./worklet-env.d.ts" />
// Collects microphone samples in the audio thread and runs the pitch detector
// every hop, on the full band and on a band-passed copy (see band.ts). The
// detector is the Rust/WebAssembly build when the page can hand over a compiled
// module, else the TypeScript port of the same algorithm.
//
// Window per band: a long window is needed to find a low note, but it answers
// late, since a window reports the pitch around its middle. So once a band
// tracks a pitch, it analyses the shortest window that holds PERIODS periods of
// it, and keeps that answer only when it stays near the tracked pitch: a short
// window cannot see a low fundamental and could land on a harmonic. Anything
// else goes through the long window. At a note's onset, while the long window
// still holds mostly silence, the short ones may start it; the long window then
// confirms or corrects that pitch within a few frames.
// A low note with a weak fundamental (violin G string, cello, bass) can make the
// long window answer with its octave. Taken up, the short window would then
// track that octave and never see the fundamental again, so while a band
// tracks a note, a jump to one of its harmonics is overruled while the tracked
// period is clearly more periodic than the new one. (Merely as periodic proves
// nothing: a pure tone repeats at twice its period just as well.)
// Then the pitch is refined strobe-style from the phase of its harmonics.
import { BandPass, CLARITY, harmonicRatio, type BandReading } from './band';
import { Mpm } from './mpm';
import type { PitchFrame } from './types';

// At 96 kHz and up, every length doubles so it covers the same time.
const SCALE = sampleRate > 60000 ? 2 : 1;
/** Window sizes, short to long: about 21, 43 and 85 ms. */
const SIZES = [1024, 2048, 4096].map((s) => s * SCALE);
const WINDOW = SIZES[SIZES.length - 1];
const LONG = SIZES.length - 1;
/** About 11 ms between readings. */
const HOP = 512 * SCALE;
/** Periods a shorter window must hold before it is used. */
const PERIODS = 8;
/** A short window's pitch is kept only this close to the tracked one. */
const TRACK_CENTS = 150;
/** Frames (about 11 ms each) the long window gets to confirm an onset pitch. */
const CONFIRM_FRAMES = 16;
const FMIN = 27; // just under A0 / low B on a 5-string bass (30.9 Hz)
const FMAX = 4500;
const FMAX_REFINE = Math.min(5000, sampleRate * 0.45);
const K = 0.9;
/**
 * The tracked note holds against a jump to its harmonic while its period's
 * aperiodicity (1 - NSDF peak) is at most this share of the harmonic's. On the
 * Good-Sounds recordings a weak fundamental (violin G string, bass) scores about
 * 0.01, cello 0.06; an overblown flute note over the faint resonance of its
 * fingering's lower octave 0.1 to 0.3, and a pure tone about 1.
 */
const OCTAVE_STAY = 0.05;

interface Engine {
  input: Float32Array;
  detect(): number;
  refine(f0: number): number;
  /** The pitch near `f` in the last detection, 0 when there is none; see `nearHeight`. */
  near(f: number): number;
  nearHeight(): number;
  clarity(): number;
  rms(): number;
}

function jsEngine(size: number): Engine {
  const m = new Mpm(size);
  return {
    input: m.input,
    detect: () => m.detect(sampleRate, FMIN, FMAX, K),
    refine: (f0) => m.refine(sampleRate, f0, FMAX_REFINE),
    near: (f) => m.near(sampleRate, f),
    nearHeight: () => m.nearHeight,
    clarity: () => m.clarity,
    rms: () => m.rms,
  };
}

/** engines[band][size]: band 0 is the full band, band 1 the band-passed signal. */
type Engines = Engine[][];

function jsEngines(): Engines {
  return [0, 1].map(() => SIZES.map(jsEngine));
}

function wasmEngines(module: WebAssembly.Module): Engines {
  const inst = new WebAssembly.Instance(module, {});
  const x = inst.exports as {
    memory: WebAssembly.Memory;
    tp_init(slot: number, w: number): number;
    tp_detect(slot: number, sr: number, fmin: number, fmax: number, k: number): number;
    tp_refine(slot: number, sr: number, f0: number, fmax: number): number;
    tp_near(slot: number, sr: number, f: number): number;
    tp_near_height(slot: number): number;
    tp_clarity(slot: number): number;
    tp_rms(slot: number): number;
  };
  // Build every detector before taking any view: allocating can grow the memory,
  // which would detach a view made earlier. Nothing allocates after this.
  const slot = (band: number, i: number) => band * SIZES.length + i;
  const ptrs = [0, 1].map((band) => SIZES.map((size, i) => x.tp_init(slot(band, i), size)));
  if (ptrs.flat().some((p) => !p)) throw new Error('tp_init failed');
  return [0, 1].map((band) =>
    SIZES.map((size, i): Engine => {
      const s = slot(band, i);
      return {
        input: new Float32Array(x.memory.buffer, ptrs[band][i], size),
        detect: () => x.tp_detect(s, sampleRate, FMIN, FMAX, K),
        refine: (f0) => x.tp_refine(s, sampleRate, f0, FMAX_REFINE),
        near: (f) => x.tp_near(s, sampleRate, f),
        nearHeight: () => x.tp_near_height(s),
        clarity: () => x.tp_clarity(s),
        rms: () => x.tp_rms(s),
      };
    }),
  );
}

const cents = (a: number, b: number) => 1200 * Math.log2(a / b);

class PitchProcessor extends AudioWorkletProcessor {
  private ring = new Float32Array(WINDOW);
  private ringHigh = new Float32Array(WINDOW);
  private band = new BandPass(sampleRate);
  private write = 0;
  private since = 0;
  private filled = 0;
  private engines: Engines = jsEngines();
  /** Pitch each band tracks, 0 when none. */
  private tracked = [0, 0];
  /** Frames left to confirm a band's onset pitch with the long window; 0 when confirmed. */
  private provisional = [0, 0];

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<{ t: 'wasm'; module: WebAssembly.Module }>) => {
      if (e.data?.t !== 'wasm') return;
      try {
        this.engines = wasmEngines(e.data.module);
        this.port.postMessage({ t: 'engine', engine: 'wasm' });
      } catch {
        this.port.postMessage({ t: 'engine', engine: 'js' });
      }
    };
  }

  process(inputs: Float32Array[][]): boolean {
    const ch = inputs[0]?.[0];
    if (!ch) return true;
    const { ring, ringHigh, band } = this;
    for (let i = 0; i < ch.length; i++) {
      ring[this.write] = ch[i];
      ringHigh[this.write] = band.run(ch[i]);
      this.write = (this.write + 1) % WINDOW;
    }
    this.filled = Math.min(WINDOW, this.filled + ch.length);
    this.since += ch.length;
    if (this.since >= HOP && this.filled === WINDOW) {
      this.since = 0;
      this.analyse();
    }
    return true;
  }

  /** Copies the newest `engine.input.length` samples of `ring`, oldest first. */
  private load(engine: Engine, ring: Float32Array) {
    const n = engine.input.length;
    const start = (this.write - n + WINDOW) % WINDOW;
    if (start + n <= WINDOW) engine.input.set(ring.subarray(start, start + n));
    else {
      engine.input.set(ring.subarray(start), 0);
      engine.input.set(ring.subarray(0, this.write), WINDOW - start);
    }
  }

  /** Runs the detector on the newest `SIZES[i]` samples; `clear` when it found a usable pitch. */
  private detect(band: number, i: number, ring: Float32Array) {
    const engine = this.engines[band][i];
    this.load(engine, ring);
    const freq = engine.detect();
    const clear = freq > 0 && engine.clarity() >= CLARITY;
    return { engine, freq, clear, fits: clear && SIZES[i] >= (PERIODS * sampleRate) / freq };
  }

  private run(band: number, ring: Float32Array): BandReading {
    const tracked = this.tracked[band];
    type Result = ReturnType<PitchProcessor['detect']>;
    let r: Result | null = null;
    let long: Result | null = null;
    if (tracked > 0) {
      // Tracking: the shortest window that holds the note, kept when it agrees.
      const i = SIZES.findIndex((s) => s >= (PERIODS * sampleRate) / tracked);
      if (i >= 0 && i < LONG) {
        r = this.detect(band, i, ring);
        if (!(r.fits && Math.abs(cents(r.freq, tracked)) <= TRACK_CENTS)) r = null;
      }
      // An onset pitch from a short window stands until the long window agrees
      // or overrules it: the short one may have caught a harmonic of a low note.
      if (this.provisional[band] > 0) {
        this.provisional[band]--;
        long = this.detect(band, LONG, ring);
        if (long.clear) {
          this.provisional[band] = 0;
          if (!r || Math.abs(cents(long.freq, r.freq)) > TRACK_CENTS) r = long;
        }
      }
    }
    r ??= long ?? this.detect(band, LONG, ring);
    if (!r.clear && tracked === 0) {
      // A note just began: the long window still holds mostly what came before,
      // the short ones already hear it.
      for (let i = 0; i < LONG; i++) {
        const s = this.detect(band, i, ring);
        if (s.fits) {
          r = s;
          this.provisional[band] = CONFIRM_FRAMES;
          break;
        }
      }
    }
    let freq = r.freq;
    let clarity = r.engine.clarity();
    if (tracked > 0 && r.clear && freq > 1.5 * tracked && harmonicRatio(freq, tracked) > 1) {
      // Jumped to a harmonic of the tracked note: stay while that note's period is
      // clearly the more periodic (only the long window gets here; it holds the period).
      const low = r.engine.near(tracked);
      const h = r.engine.nearHeight();
      if (low > 0 && h >= CLARITY && 1 - h <= OCTAVE_STAY * (1 - clarity)) {
        freq = low;
        clarity = h;
      }
    }
    if (freq > 0) {
      const fine = r.engine.refine(freq);
      if (fine > 0) freq = fine;
    }
    this.tracked[band] = r.clear ? freq : 0;
    if (!r.clear) this.provisional[band] = 0;
    return { freq, clarity, rms: r.engine.rms() };
  }

  private analyse() {
    const frame: PitchFrame = {
      t: 'pitch',
      full: this.run(0, this.ring),
      high: this.run(1, this.ringHigh),
      time: currentTime,
    };
    this.port.postMessage(frame);
  }
}

registerProcessor('tactus-pitch', PitchProcessor);

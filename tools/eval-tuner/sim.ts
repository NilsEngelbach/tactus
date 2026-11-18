// Replays a recording through the real pitch worklet and Tuner, block by block,
// and returns what the tuner would show for every analysis frame.
import { advance, processorCtor, resetTimers, type FakePort } from './shims';
import '../../src/audio/pitch.worklet';
import { Tuner, type Reading } from '../../src/audio/tuner';
import type { PitchWorkletEvent } from '../../src/audio/types';

const BLOCK = 128;

export interface Trace {
  /** Seconds: the newest sample in the analysed window. */
  t: Float32Array;
  /** Unsmoothed pitch as MIDI (the trace), NaN when none was heard. */
  raw: Float32Array;
  /** Displayed note, -1 when nothing is shown. */
  note: Int16Array;
  /** Displayed (smoothed) cents. */
  cents: Float32Array;
  /** 1 while live, 0 while a pitch is held or nothing is shown. */
  live: Uint8Array;
  engine: string;
}

export function simulate(x: Float32Array, sr: number, wasm: WebAssembly.Module | null, a4: number): Trace {
  if (sr !== (globalThis as { sampleRate?: number }).sampleRate) throw new Error(`sample rate ${sr} unsupported`);
  resetTimers();
  const proc = new processorCtor() as { port: FakePort; process(i: Float32Array[][]): boolean };
  const tuner = new Tuner();
  tuner.a4 = a4;
  let reading: Reading | null = null;
  let raw = NaN;
  tuner.onReading((r) => (reading = r));
  tuner.onTrace((m) => (raw = m ?? NaN));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const frame = (tuner as any).frame.bind(tuner) as (f: unknown, h: unknown) => void;

  const cap = Math.ceil(x.length / 512) + 4;
  const out = {
    t: new Float32Array(cap),
    raw: new Float32Array(cap),
    note: new Int16Array(cap),
    cents: new Float32Array(cap),
    live: new Uint8Array(cap),
  };
  let n = 0;
  let engine = 'js';
  let end = 0;
  proc.port.sink = (m) => {
    const e = m as PitchWorkletEvent;
    if (e.t === 'engine') {
      engine = e.engine;
      return;
    }
    const t = end / sr;
    advance(t * 1000);
    raw = NaN;
    frame(e.full, e.high);
    const r = reading as Reading | null;
    out.t[n] = t;
    out.raw[n] = raw;
    out.note[n] = r ? r.note : -1;
    out.cents[n] = r ? r.cents : 0;
    out.live[n] = r?.live ? 1 : 0;
    n++;
  };
  if (wasm) proc.port.onmessage?.({ data: { t: 'wasm', module: wasm } });

  const g = globalThis as { currentTime: number };
  for (let i = 0; i + BLOCK <= x.length; i += BLOCK) {
    g.currentTime = i / sr;
    end = i + BLOCK;
    proc.process([[x.subarray(i, i + BLOCK)]]);
  }
  return {
    t: out.t.slice(0, n),
    raw: out.raw.slice(0, n),
    note: out.note.slice(0, n),
    cents: out.cents.slice(0, n),
    live: out.live.slice(0, n),
    engine,
  };
}

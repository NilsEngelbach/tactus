/// <reference path="./worklet-env.d.ts" />
// Collects microphone samples in the audio thread and runs the pitch detector
// every hop, on the full band and on a band-passed copy (see band.ts). The
// detector is the Rust/WebAssembly build when the page can hand over a compiled
// module, else the TypeScript port of the same algorithm.
import { BandPass, type BandReading } from './band';
import { Mpm } from './mpm';
import type { PitchFrame } from './types';

const WINDOW = 4096;
const FMIN = 27; // just under A0 / low B on a 5-string bass (30.9 Hz)
const FMAX = 4500;
const K = 0.9;

interface Engine {
  input: Float32Array;
  detect(): number;
  clarity(): number;
  rms(): number;
}

function jsEngine(): Engine {
  const m = new Mpm(WINDOW);
  return {
    input: m.input,
    detect: () => m.detect(sampleRate, FMIN, FMAX, K),
    clarity: () => m.clarity,
    rms: () => m.rms,
  };
}

/** Slot 0 analyses the full band, slot 1 the band-passed signal. */
function wasmEngines(module: WebAssembly.Module): [Engine, Engine] {
  const inst = new WebAssembly.Instance(module, {});
  const x = inst.exports as {
    memory: WebAssembly.Memory;
    tp_init(slot: number, w: number): number;
    tp_detect(slot: number, sr: number, fmin: number, fmax: number, k: number): number;
    tp_clarity(slot: number): number;
    tp_rms(slot: number): number;
  };
  // Build both detectors before taking any view: allocating can grow the memory,
  // which would detach a view made earlier. Nothing allocates after this.
  const ptrs = [x.tp_init(0, WINDOW), x.tp_init(1, WINDOW)];
  if (!ptrs[0] || !ptrs[1]) throw new Error('tp_init failed');
  const engine = (slot: number): Engine => ({
    input: new Float32Array(x.memory.buffer, ptrs[slot], WINDOW),
    detect: () => x.tp_detect(slot, sampleRate, FMIN, FMAX, K),
    clarity: () => x.tp_clarity(slot),
    rms: () => x.tp_rms(slot),
  });
  return [engine(0), engine(1)];
}

class PitchProcessor extends AudioWorkletProcessor {
  private ring = new Float32Array(WINDOW);
  private ringHigh = new Float32Array(WINDOW);
  private band = new BandPass(sampleRate);
  private write = 0;
  private since = 0;
  private filled = 0;
  // ~21 ms at 48 kHz: fast enough for the meter, cheap enough for the audio thread
  private hop = sampleRate > 60000 ? 2048 : 1024;
  private engines: [Engine, Engine] = [jsEngine(), jsEngine()];

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
    if (this.since >= this.hop && this.filled === WINDOW) {
      this.since = 0;
      this.analyse();
    }
    return true;
  }

  private run(engine: Engine, ring: Float32Array): BandReading {
    // Unroll the ring, oldest sample first.
    engine.input.set(ring.subarray(this.write), 0);
    engine.input.set(ring.subarray(0, this.write), WINDOW - this.write);
    const freq = engine.detect();
    return { freq, clarity: engine.clarity(), rms: engine.rms() };
  }

  private analyse() {
    const frame: PitchFrame = {
      t: 'pitch',
      full: this.run(this.engines[0], this.ring),
      high: this.run(this.engines[1], this.ringHigh),
      time: currentTime,
    };
    this.port.postMessage(frame);
  }
}

registerProcessor('tactus-pitch', PitchProcessor);

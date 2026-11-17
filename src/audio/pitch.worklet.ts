/// <reference path="./worklet-env.d.ts" />
// Collects microphone samples in the audio thread and runs the pitch detector
// every hop. The detector is the Rust/WebAssembly build when the page can hand
// over a compiled module, else the TypeScript port of the same algorithm.
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

function wasmEngine(module: WebAssembly.Module): Engine {
  const inst = new WebAssembly.Instance(module, {});
  const x = inst.exports as {
    memory: WebAssembly.Memory;
    tp_init(w: number): number;
    tp_detect(sr: number, fmin: number, fmax: number, k: number): number;
    tp_clarity(): number;
    tp_rms(): number;
  };
  const ptr = x.tp_init(WINDOW);
  if (!ptr) throw new Error('tp_init failed');
  // No allocation happens after init, so this view stays valid.
  const input = new Float32Array(x.memory.buffer, ptr, WINDOW);
  return {
    input,
    detect: () => x.tp_detect(sampleRate, FMIN, FMAX, K),
    clarity: () => x.tp_clarity(),
    rms: () => x.tp_rms(),
  };
}

class PitchProcessor extends AudioWorkletProcessor {
  private ring = new Float32Array(WINDOW);
  private write = 0;
  private since = 0;
  private filled = 0;
  // ~21 ms at 48 kHz: fast enough for the meter, cheap enough for the audio thread
  private hop = sampleRate > 60000 ? 2048 : 1024;
  private engine: Engine = jsEngine();

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<{ t: 'wasm'; module: WebAssembly.Module }>) => {
      if (e.data?.t !== 'wasm') return;
      try {
        this.engine = wasmEngine(e.data.module);
        this.port.postMessage({ t: 'engine', engine: 'wasm' });
      } catch {
        this.port.postMessage({ t: 'engine', engine: 'js' });
      }
    };
  }

  process(inputs: Float32Array[][]): boolean {
    const ch = inputs[0]?.[0];
    if (!ch) return true;
    const ring = this.ring;
    for (let i = 0; i < ch.length; i++) {
      ring[this.write] = ch[i];
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

  private analyse() {
    const { input } = this.engine;
    // Unroll the ring, oldest sample first.
    const head = WINDOW - this.write;
    input.set(this.ring.subarray(this.write), 0);
    input.set(this.ring.subarray(0, this.write), head);
    const freq = this.engine.detect();
    const frame: PitchFrame = {
      t: 'pitch',
      freq,
      clarity: this.engine.clarity(),
      rms: this.engine.rms(),
      time: currentTime,
    };
    this.port.postMessage(frame);
  }
}

registerProcessor('tactus-pitch', PitchProcessor);

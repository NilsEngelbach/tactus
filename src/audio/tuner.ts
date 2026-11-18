import { choosePitch, harmonicRatio, type BandReading } from './band';
import { audio, holdScreen, loadWorklet, setAudioSession } from './engine';
import { freqToMidi, midiToFreq } from './notes';
import workletUrl from './pitch.worklet.ts?worker&url';
import wasmUrl from './pitch.wasm?url';
import type { PitchWorkletEvent } from './types';

export type TunerError = 'denied' | 'no-mic' | 'insecure' | 'unsupported' | 'failed';
export type TunerState = 'off' | 'starting' | 'listening' | 'error';

export interface Reading {
  /** Sounding pitch as a MIDI number (69 = A4), already settled. */
  note: number;
  /** -50 to +50, smoothed. */
  cents: number;
  freq: number;
  /** True while a pitch is coming in; false while the last one is held. */
  live: boolean;
}

const HISTORY = 5; // readings in the median, about 55 ms
const HOLD_MS = 1600;
// The cents smoothing: a held pitch is steadied below 2 Hz, while a moving one
// (a peg turned, a lip bend) opens the filter so the meter keeps up.
const SMOOTH_MIN_HZ = 2;
const SMOOTH_BETA = 0.03; // per cent/second of movement

/**
 * One Euro filter (Casiez, Roussel, Vogel, CHI 2012): a low-pass whose cutoff
 * rises with the speed of the signal, so it is calm when still and quick when moving.
 */
class OneEuro {
  private x = 0;
  private dx = 0;
  private t = 0;

  constructor(
    private readonly minHz: number,
    private readonly beta: number,
    private readonly dHz: number,
  ) {}

  reset(v: number, t: number) {
    this.x = v;
    this.dx = 0;
    this.t = t;
  }

  /** `t` in milliseconds. */
  filter(v: number, t: number): number {
    const dt = Math.max(0.001, (t - this.t) / 1000);
    this.t = t;
    const alpha = (hz: number) => 1 / (1 + 1 / (2 * Math.PI * hz * dt));
    this.dx += alpha(this.dHz) * ((v - this.x) / dt - this.dx);
    this.x += alpha(this.minHz + this.beta * Math.abs(this.dx)) * (v - this.x);
    return this.x;
  }
}

let wasmModule: Promise<WebAssembly.Module | null> | null = null;
function loadWasm(): Promise<WebAssembly.Module | null> {
  wasmModule ??= fetch(wasmUrl)
    .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
    .then((b) => WebAssembly.compile(b))
    .catch(() => null);
  return wasmModule;
}

export class Tuner {
  state: TunerState = 'off';
  error: TunerError | null = null;
  engine: 'wasm' | 'js' | null = null;
  a4 = 440;

  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private node: AudioWorkletNode | null = null;
  private history: number[] = [];
  private current: number | null = null;
  private smooth = new OneEuro(SMOOTH_MIN_HZ, SMOOTH_BETA, 1);
  private lastLive = 0;
  private reading: Reading | null = null;
  private holdTimer = 0;
  private listeners = new Set<(r: Reading | null) => void>();
  private stateListeners = new Set<(s: TunerState) => void>();
  private ref: { osc: OscillatorNode; gain: GainNode; midi: number } | null = null;
  private refListeners = new Set<(midi: number | null) => void>();
  private traceListeners = new Set<(midi: number | null) => void>();

  onReading(fn: (r: Reading | null) => void) {
    this.listeners.add(fn);
  }
  onState(fn: (s: TunerState) => void) {
    this.stateListeners.add(fn);
  }
  onReference(fn: (midi: number | null) => void) {
    this.refListeners.add(fn);
  }
  /** Every analysis frame: the unsmoothed pitch, or null when none was heard. */
  onTrace(fn: (midi: number | null) => void) {
    this.traceListeners.add(fn);
  }
  private emitTrace(midi: number | null) {
    for (const fn of this.traceListeners) fn(midi);
  }

  private setState(s: TunerState, error: TunerError | null = null) {
    this.state = s;
    this.error = error;
    for (const fn of this.stateListeners) fn(s);
  }

  async toggle() {
    if (this.state === 'listening' || this.state === 'starting') this.stop();
    else await this.start();
  }

  async start() {
    if (!window.isSecureContext) return this.setState('error', 'insecure');
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioWorkletNode === 'undefined') {
      return this.setState('error', 'unsupported');
    }
    this.setState('starting');
    setAudioSession('play-and-record');
    try {
      const [ctx, module] = await Promise.all([audio(), loadWasm()]);
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      if (this.state !== 'starting') {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      await loadWorklet(ctx, workletUrl);
      const node = new AudioWorkletNode(ctx, 'tactus-pitch', { numberOfInputs: 1, numberOfOutputs: 1 });
      node.port.onmessage = (e: MessageEvent<PitchWorkletEvent>) => {
        const m = e.data;
        if (m.t === 'engine') this.engine = m.engine;
        else this.frame(m.full, m.high);
      };
      this.engine = 'js';
      if (module) node.port.postMessage({ t: 'wasm', module });
      const source = ctx.createMediaStreamSource(stream);
      source.connect(node);
      // The worklet writes silence; the connection keeps it pulled by the graph.
      node.connect(ctx.destination);
      this.stream = stream;
      this.source = source;
      this.node = node;
      holdScreen('tuner', true);
      this.setState('listening');
    } catch (err) {
      const name = err instanceof DOMException ? err.name : '';
      const code: TunerError =
        name === 'NotAllowedError' || name === 'SecurityError'
          ? 'denied'
          : name === 'NotFoundError' || name === 'OverconstrainedError'
            ? 'no-mic'
            : 'failed';
      this.teardown();
      this.setState('error', code);
    }
  }

  stop() {
    this.teardown();
    this.setState('off');
  }

  private teardown() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.source?.disconnect();
    this.node?.disconnect();
    if (this.node) this.node.port.onmessage = null;
    this.stream = null;
    this.source = null;
    this.node = null;
    this.history = [];
    this.current = null;
    this.reading = null;
    clearTimeout(this.holdTimer);
    holdScreen('tuner', false);
    this.emit(null);
  }

  private emit(r: Reading | null) {
    for (const fn of this.listeners) fn(r);
  }

  /** One frame from the worklet: band choice and gate, median, note hysteresis, smoothing. */
  private frame(full: BandReading, high: BandReading) {
    const now = performance.now();
    const pick = choosePitch(full, high);
    if (!pick) {
      this.emitTrace(null);
      if (this.reading?.live && now - this.lastLive > 120) {
        this.reading = { ...this.reading, live: false };
        this.emit(this.reading);
        clearTimeout(this.holdTimer);
        this.holdTimer = window.setTimeout(() => {
          this.reading = null;
          this.current = null;
          this.history = [];
          this.emit(null);
        }, HOLD_MS);
      }
      return;
    }
    clearTimeout(this.holdTimer);
    this.lastLive = now;

    // As a low note fades, the full band loses it first and the high band may
    // hear only a harmonic: fold that back onto the note on display.
    let freq = pick.freq;
    if (pick.band === 'high' && this.reading?.live && this.current !== null) {
      const shown = midiToFreq(this.current, this.a4);
      const n = harmonicRatio(freq, shown);
      if (n > 1 && freq > shown) freq /= n;
    }

    const midi = freqToMidi(freq, this.a4);
    this.history.push(midi);
    if (this.history.length > HISTORY) this.history.shift();
    const sorted = [...this.history].sort((a, b) => a - b);
    const med = sorted[sorted.length >> 1];

    // Stay on the note until the pitch is clearly closer to another one.
    const newNote = this.current === null || Math.abs(med - this.current) > 0.62;
    const note: number = newNote ? Math.round(med) : this.current!;
    this.current = note;
    const cents = Math.max(-50, Math.min(50, (med - note) * 100));
    // A new note, or a new attack after a pause, starts the meter where it is.
    if (newNote || !this.reading?.live) this.smooth.reset(cents, now);
    this.reading = { note, cents: this.smooth.filter(cents, now), freq: midiToFreq(med, this.a4), live: true };
    this.emit(this.reading);
    this.emitTrace(midi);
  }

  // ── Reference tone ─────────────────────────────────────────────────────────
  get referenceNote(): number | null {
    return this.ref?.midi ?? null;
  }

  async toggleReference(midi: number) {
    if (this.ref) return this.stopReference();
    await this.startReference(midi);
  }

  /** Plays `midi` (sounding pitch); if a tone is already playing, glides it there. */
  async startReference(midi: number) {
    if (this.ref) return this.setReference(midi);
    const ctx = await audio();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    // Harmonics like a soft organ stop: low notes stay audible on phone speakers.
    const h = [0, 1, 0.55, 0.32, 0.2, 0.12, 0.07];
    osc.setPeriodicWave(ctx.createPeriodicWave(new Float32Array(h.length), Float32Array.from(h)));
    osc.frequency.value = midiToFreq(midi, this.a4);
    gain.gain.setValueAtTime(0, ctx.currentTime);
    gain.gain.linearRampToValueAtTime(0.22, ctx.currentTime + 0.04);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    this.ref = { osc, gain, midi };
    for (const fn of this.refListeners) fn(midi);
  }

  setReference(midi: number) {
    const r = this.ref;
    if (!r) return;
    r.midi = midi;
    r.osc.frequency.setTargetAtTime(midiToFreq(midi, this.a4), r.osc.context.currentTime, 0.008);
    for (const fn of this.refListeners) fn(midi);
  }

  retuneReference() {
    if (this.ref) this.ref.osc.frequency.value = midiToFreq(this.ref.midi, this.a4);
  }

  stopReference() {
    const r = this.ref;
    if (!r) return;
    this.ref = null;
    const t = r.gain.context.currentTime;
    r.gain.gain.cancelScheduledValues(t);
    r.gain.gain.setValueAtTime(r.gain.gain.value, t);
    r.gain.gain.linearRampToValueAtTime(0, t + 0.05);
    r.osc.stop(t + 0.06);
    for (const fn of this.refListeners) fn(null);
  }
}

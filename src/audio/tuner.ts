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

const HISTORY = 5;
const HOLD_MS = 1600;

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
  private smoothCents = 0;
  private lastLive = 0;
  private reading: Reading | null = null;
  private holdTimer = 0;
  private listeners = new Set<(r: Reading | null) => void>();
  private stateListeners = new Set<(s: TunerState) => void>();
  private ref: { osc: OscillatorNode; gain: GainNode; midi: number } | null = null;
  private refListeners = new Set<(midi: number | null) => void>();

  onReading(fn: (r: Reading | null) => void) {
    this.listeners.add(fn);
  }
  onState(fn: (s: TunerState) => void) {
    this.stateListeners.add(fn);
  }
  onReference(fn: (midi: number | null) => void) {
    this.refListeners.add(fn);
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
    if (this.current === null || Math.abs(med - this.current) > 0.62) {
      this.current = Math.round(med);
      this.smoothCents = (med - this.current) * 100;
    }
    const cents = Math.max(-50, Math.min(50, (med - this.current) * 100));
    this.smoothCents += (cents - this.smoothCents) * 0.35;
    this.reading = { note: this.current, cents: this.smoothCents, freq: midiToFreq(med, this.a4), live: true };
    this.emit(this.reading);
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

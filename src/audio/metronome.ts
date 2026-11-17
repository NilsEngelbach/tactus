import { audibleTime, audio, holdScreen, loadWorklet, setAudioSession } from './engine';
import workletUrl from './metronome.worklet.ts?worker&url';
import type { MetronomeMessage, TempoConfig, TickEvent } from './types';

export type BeatListener = (ev: TickEvent) => void;

/** Main-thread handle on the metronome worklet. */
export class Metronome {
  running = false;
  private node: AudioWorkletNode | null = null;
  private ctx: AudioContext | null = null;
  private queue: TickEvent[] = [];
  private frame = 0;
  private listeners = new Set<BeatListener>();
  private stateListeners = new Set<(running: boolean) => void>();

  constructor(private cfg: TempoConfig) {}

  onBeat(fn: BeatListener) {
    this.listeners.add(fn);
  }

  onState(fn: (running: boolean) => void) {
    this.stateListeners.add(fn);
  }

  configure(cfg: TempoConfig) {
    this.cfg = cfg;
    this.send({ t: 'config', cfg });
  }

  async toggle() {
    if (this.running) this.stop();
    else await this.start();
  }

  async start() {
    if (this.running) return;
    // Flip state first so a fast double stomp does not start twice.
    this.running = true;
    this.emitState();
    setAudioSession('playback');
    try {
      const ctx = await audio();
      this.ctx = ctx;
      if (!this.node) {
        await loadWorklet(ctx, workletUrl);
        const node = new AudioWorkletNode(ctx, 'tactus-metronome', {
          numberOfInputs: 0,
          numberOfOutputs: 1,
          outputChannelCount: [2],
        });
        // Nothing is drawn while the tab is hidden, so nothing is queued either.
        node.port.onmessage = (e: MessageEvent<TickEvent>) => {
          if (!document.hidden) this.queue.push(e.data);
        };
        node.connect(ctx.destination);
        this.node = node;
      }
      if (!this.running) return; // stopped while loading
      this.send({ t: 'config', cfg: this.cfg });
      this.send({ t: 'start', at: ctx.currentTime + 0.03 });
      holdScreen('metronome', true);
      this.loop();
    } catch (err) {
      this.running = false;
      this.emitState();
      throw err;
    }
  }

  stop() {
    if (!this.running) return;
    this.running = false;
    this.send({ t: 'stop' });
    this.queue.length = 0;
    cancelAnimationFrame(this.frame);
    holdScreen('metronome', false);
    this.emitState();
  }

  private send(m: MetronomeMessage) {
    this.node?.port.postMessage(m);
  }

  private emitState() {
    for (const fn of this.stateListeners) fn(this.running);
  }

  /** Releases each tick when its sound reaches the speaker. */
  private loop = () => {
    const ctx = this.ctx;
    if (!ctx || !this.running) return;
    const now = audibleTime(ctx);
    while (this.queue.length && this.queue[0].time <= now) {
      const ev = this.queue.shift()!;
      // A tick far in the past (tab was hidden) is dropped, not flashed late.
      if (now - ev.time < 0.15) for (const fn of this.listeners) fn(ev);
    }
    this.frame = requestAnimationFrame(this.loop);
  };
}

/** Tap tempo: the average of the last few intervals; a pause of 2 s starts over. */
export class TapTempo {
  private taps: number[] = [];

  tap(now = performance.now()): number | null {
    const last = this.taps[this.taps.length - 1];
    if (last !== undefined && now - last > 2000) this.taps = [];
    this.taps.push(now);
    if (this.taps.length > 5) this.taps.shift();
    if (this.taps.length < 2) return null;
    const span = this.taps[this.taps.length - 1] - this.taps[0];
    return 60000 / (span / (this.taps.length - 1));
  }
}

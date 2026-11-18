// Stand-ins for the AudioWorkletGlobalScope and the page clock, so the real
// pitch worklet and Tuner run offline in Node. Imported first by sim.ts.
const g = globalThis as Record<string, unknown>;

g.sampleRate = 48000;
// engine.ts listens for page visibility at load.
g.document ??= { addEventListener() {}, visibilityState: 'hidden' };
g.currentTime = 0;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export let processorCtor: any = null;
g.registerProcessor = (_name: string, ctor: unknown) => {
  processorCtor = ctor;
};

export class FakePort {
  onmessage: ((e: { data: unknown }) => void) | null = null;
  sink: (m: unknown) => void = () => {};
  postMessage(m: unknown) {
    this.sink(m);
  }
}
g.AudioWorkletProcessor = class {
  port = new FakePort();
};

// Page clock (performance.now) and the Tuner's hold timer, driven by audio time.
export const clock = { ms: 0 };
const timers = new Map<number, { at: number; fn: () => void }>();
let nextId = 1;
g.__evalNow = () => clock.ms;
g.__evalSetTimeout = (fn: () => void, ms: number) => {
  const id = nextId++;
  timers.set(id, { at: clock.ms + ms, fn });
  return id;
};
g.__evalClearTimeout = (id: number) => {
  timers.delete(id);
};

/** Moves the clock to `ms`, firing every timer due by then. */
export function advance(ms: number) {
  for (;;) {
    let due: [number, { at: number; fn: () => void }] | null = null;
    for (const e of timers) if (e[1].at <= ms && (!due || e[1].at < due[1].at)) due = e;
    if (!due) break;
    timers.delete(due[0]);
    clock.ms = due[1].at;
    due[1].fn();
  }
  clock.ms = ms;
}

export function resetTimers() {
  timers.clear();
  clock.ms = 0;
}

// One AudioContext for every pedal, created on the first user gesture.

let ctx: AudioContext | null = null;

type SessionType = 'playback' | 'play-and-record';
interface AudioSessionNav {
  audioSession?: { type: string };
}

/** iOS Safari: 'playback' keeps the click audible with the ring/silent switch on. */
export function setAudioSession(type: SessionType) {
  const s = (navigator as Navigator & AudioSessionNav).audioSession;
  if (s) {
    try {
      s.type = type;
    } catch {
      /* not supported in this browser */
    }
  }
}

export async function audio(): Promise<AudioContext> {
  if (!ctx) ctx = new AudioContext({ latencyHint: 'interactive' });
  if (ctx.state !== 'running') await ctx.resume();
  return ctx;
}

export function currentAudio(): AudioContext | null {
  return ctx;
}

/**
 * The AudioContext time that is reaching the speaker right now. Lights and
 * readings are drawn against this clock, so they match what is heard.
 */
export function audibleTime(c: AudioContext): number {
  if (typeof c.getOutputTimestamp === 'function') {
    const ts = c.getOutputTimestamp();
    if (ts.contextTime !== undefined && ts.performanceTime !== undefined && ts.contextTime > 0) {
      return ts.contextTime + (performance.now() - ts.performanceTime) / 1000;
    }
  }
  return c.currentTime - (c.outputLatency || c.baseLatency || 0);
}

const loaded = new Map<string, Promise<void>>();
export function loadWorklet(c: AudioContext, url: string): Promise<void> {
  let p = loaded.get(url);
  if (!p) {
    p = c.audioWorklet.addModule(url);
    loaded.set(url, p);
    p.catch(() => loaded.delete(url));
  }
  return p;
}

// ── Screen wake lock: the screen stays on while any pedal is on ──────────────
const holders = new Set<string>();
let lock: WakeLockSentinel | null = null;

async function syncWakeLock() {
  const want = holders.size > 0 && document.visibilityState === 'visible';
  if (want && !lock && 'wakeLock' in navigator) {
    try {
      lock = await navigator.wakeLock.request('screen');
      lock.addEventListener('release', () => {
        lock = null;
      });
    } catch {
      /* denied or unsupported: the screen may sleep, audio keeps going */
    }
  } else if (!want && lock) {
    const l = lock;
    lock = null;
    await l.release().catch(() => {});
  }
}

export function holdScreen(id: string, on: boolean) {
  if (on) holders.add(id);
  else holders.delete(id);
  void syncWakeLock();
}

document.addEventListener('visibilitychange', () => void syncWakeLock());

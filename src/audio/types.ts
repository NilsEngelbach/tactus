/** Accent of one beat: 2 accented, 1 normal, 0 silent (the light still counts it). */
export type Accent = 0 | 1 | 2;

export interface TempoConfig {
  bpm: number;
  /** Beats per bar, 1 to 12. */
  beats: number;
  /** Clicks per beat: 1 quarter, 2 eighths, 3 triplets, 4 sixteenths. */
  subdiv: 1 | 2 | 3 | 4;
  /** One entry per beat. */
  accents: Accent[];
  /** 0 click, 1 wood, 2 beep, 3 claves, 4 light only (no sound). */
  voice: 0 | 1 | 2 | 3 | 4;
  /** 0 to 1. */
  level: number;
}

export type MetronomeMessage =
  | { t: 'config'; cfg: TempoConfig }
  | { t: 'start'; at: number }
  | { t: 'stop' };

/** Sent by the metronome worklet for every click it renders. `time` is AudioContext time. */
export interface TickEvent {
  t: 'tick';
  time: number;
  beat: number;
  sub: number;
  accent: Accent;
}

/** One analysis frame from the pitch worklet. `freq` is 0 when no pitch was found. */
export interface PitchFrame {
  t: 'pitch';
  freq: number;
  clarity: number;
  rms: number;
  time: number;
}

export type PitchWorkletEvent = PitchFrame | { t: 'engine'; engine: 'wasm' | 'js' };

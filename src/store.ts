// Settings live on this device only (localStorage). Every read tolerates
// missing, old or broken data, and private windows without storage.
import type { Accent, TempoConfig } from './audio/types';
import type { TranspositionId } from './audio/notes';
import type { Lang } from './i18n';

export interface Settings {
  lang: Lang | null;
  tempo: TempoConfig;
  /** refNote: the reference tone as written pitch (MIDI), C1 to C6. */
  tuner: { a4: number; transpose: TranspositionId; refNote: number };
}

const KEY = 'tactus:v1';

export const defaults: Settings = {
  lang: null,
  tempo: { bpm: 96, beats: 4, subdiv: 1, accents: [2, 1, 1, 1], voice: 1, level: 0.8 },
  tuner: { a4: 440, transpose: 'C', refNote: 69 },
};

const clamp = (v: unknown, min: number, max: number, d: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : d;

export function accentsFor(beats: number, prev: Accent[] = []): Accent[] {
  return Array.from({ length: beats }, (_, i) => prev[i] ?? (i === 0 ? 2 : 1));
}

export function load(): Settings {
  let raw: Partial<Settings> = {};
  try {
    raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {};
  } catch {
    /* no storage */
  }
  const tp: Partial<TempoConfig> = raw.tempo ?? {};
  const beats = Math.round(clamp(tp.beats, 1, 12, defaults.tempo.beats));
  const acc = Array.isArray(tp.accents)
    ? tp.accents.map((a) => (a === 0 || a === 1 || a === 2 ? a : 1))
    : defaults.tempo.accents;
  const tn: Partial<Settings['tuner']> = raw.tuner ?? {};
  return {
    lang: raw.lang === 'de' || raw.lang === 'en' ? raw.lang : null,
    tempo: {
      bpm: Math.round(clamp(tp.bpm, 30, 300, defaults.tempo.bpm)),
      beats,
      subdiv: ([1, 2, 3, 4] as const).find((s) => s === tp.subdiv) ?? 1,
      accents: accentsFor(beats, acc as Accent[]),
      voice: ([0, 1, 2, 3, 4] as const).find((v) => v === tp.voice) ?? defaults.tempo.voice,
      level: clamp(tp.level, 0, 1, defaults.tempo.level),
    },
    tuner: {
      a4: Math.round(clamp(tn.a4, 415, 466, 440)),
      transpose: (['C', 'Bb', 'Eb', 'F'] as const).find((x) => x === tn.transpose) ?? 'C',
      refNote: Math.round(clamp(tn.refNote, 24, 84, 69)),
    },
  };
}

let timer = 0;
export function save(s: Settings) {
  clearTimeout(timer);
  timer = window.setTimeout(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(s));
    } catch {
      /* no storage: settings last for this visit */
    }
  }, 250);
}

// The tuner analyses every window twice: the full band, which low notes need,
// and a band-passed copy for higher notes. A quiet high note drowns in hum and
// low rumble, which keep the full-band NSDF positive past the note's period, so
// the detector either finds nothing or locks onto the hum. Without everything
// below 150 Hz and above 5 kHz the same note reads cleanly at a much lower level.

export const HIGH_PASS_HZ = 150;
export const LOW_PASS_HZ = 5000;

/** One second-order section (RBJ cookbook), Butterworth Q. */
class Biquad {
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;
  private readonly b0: number;
  private readonly b1: number;
  private readonly b2: number;
  private readonly a1: number;
  private readonly a2: number;

  constructor(kind: 'hp' | 'lp', fc: number, sampleRate: number) {
    const w0 = (2 * Math.PI * fc) / sampleRate;
    const alpha = Math.sin(w0) / (2 * Math.SQRT1_2);
    const cos = Math.cos(w0);
    const a0 = 1 + alpha;
    const g = kind === 'hp' ? (1 + cos) / 2 : (1 - cos) / 2;
    this.b0 = g / a0;
    this.b1 = ((kind === 'hp' ? -2 : 2) * g) / a0;
    this.b2 = g / a0;
    this.a1 = (-2 * cos) / a0;
    this.a2 = (1 - alpha) / a0;
  }

  run(x: number): number {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }
}

/** Streaming band-pass: two high-pass sections at 150 Hz, one low-pass at 5 kHz. */
export class BandPass {
  private readonly stages: Biquad[];

  constructor(sampleRate: number) {
    this.stages = [
      new Biquad('hp', HIGH_PASS_HZ, sampleRate),
      new Biquad('hp', HIGH_PASS_HZ, sampleRate),
      new Biquad('lp', Math.min(LOW_PASS_HZ, sampleRate * 0.45), sampleRate),
    ];
  }

  run(x: number): number {
    for (const s of this.stages) x = s.run(x);
    return x;
  }
}

/** One band's result for a window. `freq` is 0 when no pitch was found. */
export interface BandReading {
  freq: number;
  clarity: number;
  rms: number;
}

export const CLARITY = 0.86;
export const GATE_FULL = 0.0025; // about -52 dBFS
// Hum and rumble no longer count towards this level, so it can sit lower; the
// clarity threshold still keeps noise out.
export const GATE_HIGH = 0.0013; // about -58 dBFS

const usable = (b: BandReading, gate: number) => b.freq > 0 && b.clarity >= CLARITY && b.rms >= gate;

/** n in 1..8 such that the larger of a and b is n times the smaller, within 25 cents; else 0. */
export function harmonicRatio(a: number, b: number): number {
  const r = Math.max(a, b) / Math.min(a, b);
  const n = Math.round(r);
  return n >= 1 && n <= 8 && Math.abs(1200 * Math.log2(r / n)) < 25 ? n : 0;
}

/**
 * Picks the pitch of one window, or null. The full band wins whenever it is
 * clear and the high band hears the same note (or, for a low note, one of its
 * harmonics), so low notes read exactly as before. The high band takes over
 * when the full band found nothing or something unrelated such as mains hum.
 * When both are clear an octave or more apart and the full band's note lies
 * well inside the high band, the high band heard that note itself, so the
 * clearer reading wins: rumble can push the full band onto a subharmonic.
 */
export function choosePitch(full: BandReading, high: BandReading): { freq: number; band: 'full' | 'high' } | null {
  const fullOk = usable(full, GATE_FULL);
  const highOk = usable(high, GATE_HIGH);
  const useFull = () => ({ freq: full.freq, band: 'full' as const });
  const useHigh = () => ({ freq: high.freq, band: 'high' as const });
  if (!highOk) return fullOk ? useFull() : null;
  if (!fullOk) return useHigh();
  const n = harmonicRatio(full.freq, high.freq);
  if (n === 1) return useFull();
  if (n > 1 && full.freq < 1.5 * HIGH_PASS_HZ) return useFull();
  if (n > 1) return high.clarity > full.clarity ? useHigh() : useFull();
  return useHigh();
}

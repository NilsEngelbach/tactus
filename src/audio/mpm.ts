// McLeod Pitch Method in TypeScript: the fallback for browsers that cannot run
// WebAssembly inside an AudioWorklet. Mirrors wasm/pitch/src/lib.rs; keep the two in step.

export class Mpm {
  readonly input: Float32Array;
  clarity = 0;
  rms = 0;
  /** Height of the peak the last `near` found. */
  nearHeight = 0;
  /** NSDF lags computed by the last `detect` (0 when it stopped early). */
  private maxLag = 0;
  private readonly n: number;
  private readonly re: Float32Array;
  private readonly im: Float32Array;
  private readonly cos: Float32Array;
  private readonly sin: Float32Array;
  private readonly rev: Uint32Array;
  private readonly nsdf: Float32Array;
  private readonly hann: Float32Array;

  constructor(private readonly w: number) {
    const d = w >> 1;
    this.hann = new Float32Array(d);
    for (let i = 0; i < d; i++) this.hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / d);
    let n = 1;
    while (n < 2 * w) n <<= 1;
    this.n = n;
    this.input = new Float32Array(w);
    this.re = new Float32Array(n);
    this.im = new Float32Array(n);
    this.nsdf = new Float32Array(w);
    this.cos = new Float32Array(n / 2);
    this.sin = new Float32Array(n / 2);
    for (let k = 0; k < n / 2; k++) {
      this.cos[k] = Math.cos((2 * Math.PI * k) / n);
      this.sin[k] = Math.sin((2 * Math.PI * k) / n);
    }
    const bits = Math.log2(n);
    this.rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
  }

  private fft() {
    const { n, re, im, cos, sin, rev } = this;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      if (j > i) {
        let t = re[i]; re[i] = re[j]; re[j] = t;
        t = im[i]; im[i] = im[j]; im[j] = t;
      }
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1;
      const step = n / size;
      for (let start = 0; start < n; start += size) {
        for (let k = 0; k < half; k++) {
          const wr = cos[k * step];
          const wi = -sin[k * step];
          const a = start + k;
          const b = a + half;
          const tr = re[b] * wr - im[b] * wi;
          const ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr;
          im[b] = im[a] - ti;
          re[a] += tr;
          im[a] += ti;
        }
      }
    }
  }

  detect(sampleRate: number, fmin: number, fmax: number, k: number): number {
    const { w, n, input, re, im, nsdf } = this;
    this.clarity = 0;
    this.maxLag = 0;
    let mean = 0;
    for (let i = 0; i < w; i++) mean += input[i];
    mean /= w;
    let energy = 0;
    for (let i = 0; i < w; i++) {
      const v = input[i] - mean;
      input[i] = v;
      re[i] = v;
      energy += v * v;
    }
    this.rms = Math.sqrt(energy / w);
    if (energy < 1e-9) return 0;
    re.fill(0, w);
    im.fill(0);

    this.fft();
    for (let i = 0; i < n; i++) {
      re[i] = re[i] * re[i] + im[i] * im[i];
      im[i] = 0;
    }
    this.fft();

    const maxLag = Math.min(Math.ceil((sampleRate / fmin) * 1.3), w >> 1);
    const minLag = Math.max(2, Math.floor(sampleRate / fmax));
    let m = 2 * energy;
    nsdf[0] = 1;
    for (let tau = 1; tau < maxLag; tau++) {
      const a = input[tau - 1];
      const b = input[w - tau];
      m -= a * a + b * b;
      nsdf[tau] = m > 1e-12 ? (2 * re[tau]) / n / m : 0;
    }
    this.maxLag = maxLag;

    let tau = 1;
    while (tau < maxLag && nsdf[tau] > 0) tau++;
    const peaks: number[] = [];
    let highest = 0;
    while (tau < maxLag - 1 && peaks.length < 64) {
      while (tau < maxLag - 1 && nsdf[tau] <= 0) tau++;
      let best = tau;
      while (tau < maxLag - 1 && nsdf[tau] > 0) {
        if (nsdf[tau] > nsdf[best]) best = tau;
        tau++;
      }
      if (best >= minLag && best + 1 < maxLag && nsdf[best] > 0 && nsdf[best + 1] < nsdf[best]) {
        peaks.push(best);
        if (nsdf[best] > highest) highest = nsdf[best];
      }
    }
    if (!peaks.length) return 0;

    const cut = k * highest;
    const chosen = peaks.find((p) => nsdf[p] >= cut) ?? peaks[0];
    const a = nsdf[chosen - 1];
    const b = nsdf[chosen];
    const c = nsdf[chosen + 1];
    const denom = a - 2 * b + c;
    let delta = 0;
    let peak = b;
    if (Math.abs(denom) > 1e-12) {
      delta = (0.5 * (a - c)) / denom;
      peak = b - 0.25 * (a - c) * delta;
    }
    const f = sampleRate / (chosen + delta);
    // The lag range runs past the longest period so its lobe can close, which
    // lets rumble under fmin through: it is no pitch.
    if (f < fmin) return 0;
    this.clarity = Math.min(1, peak);
    return f;
  }

  /**
   * The pitch near `f` in the last `detect`: the NSDF maximum within about half
   * a semitone of its period, parabolically interpolated; 0 when there is none
   * (`nearHeight` is then 0 too). The worklet asks this for the note it tracks
   * when `detect` jumped to a harmonic of it.
   */
  near(sampleRate: number, f: number): number {
    const { nsdf } = this;
    this.nearHeight = 0;
    if (f <= 0) return 0;
    const lag = sampleRate / f;
    const lo = Math.max(2, Math.floor(lag * 0.97));
    const hi = Math.ceil(lag * 1.03);
    if (hi + 1 >= this.maxLag) return 0;
    let best = lo;
    for (let t = lo; t <= hi; t++) if (nsdf[t] > nsdf[best]) best = t;
    const a = nsdf[best - 1];
    const b = nsdf[best];
    const c = nsdf[best + 1];
    if (b <= 0 || a > b || c > b) return 0;
    const denom = a - 2 * b + c;
    let delta = 0;
    let peak = b;
    if (Math.abs(denom) > 1e-12) {
      delta = (0.5 * (a - c)) / denom;
      peak = b - 0.25 * (a - c) * delta;
    }
    this.nearHeight = Math.min(1, peak);
    return sampleRate / (best + delta);
  }

  /**
   * Refines `f0`, found by `detect` on the same input, strobe-style: by how far
   * the phase of the first harmonics advances between the two halves of the
   * window. Returns 0 when the halves hold too few periods, differ too much in
   * level (a note starting or stopping) or the result strays.
   */
  refine(sampleRate: number, f0: number, fmax: number): number {
    const { input, hann } = this;
    const d = this.w >> 1;
    if (f0 <= 0 || d < MIN_PERIODS * (sampleRate / f0)) return 0;
    const tau = 2 * Math.PI;
    let num = 0;
    let den = 0;
    let ea = 0;
    let eb = 0;
    for (let h = 1; h <= HARMONICS; h++) {
      const fh = f0 * h;
      if (fh > fmax) break;
      // One DFT bin at fh over each half, the rotation e^(-i w n) kept by recursion.
      const omega = (tau * fh) / sampleRate;
      const c = Math.cos(omega);
      const s = Math.sin(omega);
      let zr = 1;
      let zi = 0;
      let ar = 0;
      let ai = 0;
      let br = 0;
      let bi = 0;
      for (let i = 0; i < d; i++) {
        const xa = input[i] * hann[i];
        const xb = input[i + d] * hann[i];
        ar += xa * zr;
        ai += xa * zi;
        br += xb * zr;
        bi += xb * zi;
        const t = zr * c + zi * s;
        zi = zi * c - zr * s;
        zr = t;
      }
      // B times conj(A): its angle is the phase advance over d samples, its size weighs the harmonic.
      const cr = br * ar + bi * ai;
      const ci = bi * ar - br * ai;
      const weight = Math.hypot(cr, ci);
      ea += ar * ar + ai * ai;
      eb += br * br + bi * bi;
      if (weight <= 0) continue;
      let err = Math.atan2(ci, cr) - omega * d;
      err -= tau * Math.round(err / tau);
      num += (weight * (fh + (err * sampleRate) / (tau * d))) / h;
      den += weight;
    }
    // The halves must hold the same tone: at an onset the first half is still
    // mostly silence and its phase is noise.
    if (den <= 0 || Math.min(ea, eb) < MIN_HALF_POWER * Math.max(ea, eb)) return 0;
    const f = num / den;
    return Math.abs(1200 * Math.log2(f / f0)) > MAX_SHIFT_CENTS ? 0 : f;
  }
}

/** Harmonics `refine` measures (fewer when they pass `fmax`). */
const HARMONICS = 4;
/** `refine` needs this many periods in each half of the window. */
const MIN_PERIODS = 2.5;
/** A refined pitch further than this from MPM's is not trusted. */
const MAX_SHIFT_CENTS = 20;
/** The weaker half must hold this share of the stronger half's power at the harmonics (-6 dB). */
const MIN_HALF_POWER = 0.25;

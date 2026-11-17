// McLeod Pitch Method in TypeScript: the fallback for browsers that cannot run
// WebAssembly inside an AudioWorklet. Mirrors wasm/pitch/src/lib.rs; keep the two in step.

export class Mpm {
  readonly input: Float32Array;
  clarity = 0;
  rms = 0;
  private readonly n: number;
  private readonly re: Float32Array;
  private readonly im: Float32Array;
  private readonly cos: Float32Array;
  private readonly sin: Float32Array;
  private readonly rev: Uint32Array;
  private readonly nsdf: Float32Array;

  constructor(private readonly w: number) {
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
    this.clarity = Math.min(1, peak);
    return sampleRate / (chosen + delta);
  }
}

//! Pitch detection for the Tactus tuner: the McLeod Pitch Method (MPM).
//!
//! The normalised square difference function (NSDF) is computed from an
//! autocorrelation done with an FFT, so one frame costs O(n log n) instead of
//! O(n * lag). The detector is built once for a fixed window size; after that
//! nothing allocates, so the JavaScript views on the input buffer stay valid.
//!
//! `refine` then measures the found pitch much more finely, strobe-style, from
//! the phase advance of its harmonics across the window. It removes MPM's bias
//! on high notes (2.5 cents at C7 for a bright tone) and cuts the scatter in
//! noise severalfold; `report` in the tests prints the numbers.
//!
//! The same algorithm exists in TypeScript (`src/audio/mpm.ts`) as the fallback
//! for browsers that cannot run WebAssembly inside an AudioWorklet. Keep the two
//! in step.

use core::f64::consts::PI;

pub struct Detector {
    w: usize,
    n: usize,
    input: Vec<f32>,
    re: Vec<f32>,
    im: Vec<f32>,
    cos: Vec<f32>,
    sin: Vec<f32>,
    rev: Vec<u32>,
    nsdf: Vec<f32>,
    /// Hann window over half the input, for `refine`.
    hann: Vec<f32>,
    clarity: f32,
    rms: f32,
}

/// Harmonics `refine` measures (fewer when they pass `fmax`).
const HARMONICS: usize = 4;
/// `refine` needs this many periods in each half of the window.
const MIN_PERIODS: f64 = 2.5;
/// A refined pitch further than this from MPM's is not trusted.
const MAX_SHIFT_CENTS: f64 = 20.0;
/// The weaker half of the window must hold at least this share of the stronger
/// half's power at the harmonics (-6 dB in level).
const MIN_HALF_POWER: f64 = 0.25;

impl Detector {
    pub fn new(w: usize) -> Self {
        let n = (2 * w).next_power_of_two();
        let bits = n.trailing_zeros();
        let rev = (0..n as u32).map(|i| i.reverse_bits() >> (32 - bits)).collect();
        let half = n / 2;
        let cos = (0..half).map(|k| (2.0 * PI * k as f64 / n as f64).cos() as f32).collect();
        let sin = (0..half).map(|k| (2.0 * PI * k as f64 / n as f64).sin() as f32).collect();
        Detector {
            w,
            n,
            input: vec![0.0; w],
            re: vec![0.0; n],
            im: vec![0.0; n],
            cos,
            sin,
            rev,
            nsdf: vec![0.0; w],
            hann: (0..w / 2)
                .map(|i| (0.5 - 0.5 * (2.0 * PI * i as f64 / (w / 2) as f64).cos()) as f32)
                .collect(),
            clarity: 0.0,
            rms: 0.0,
        }
    }

    pub fn input_mut(&mut self) -> &mut [f32] {
        &mut self.input
    }

    pub fn clarity(&self) -> f32 {
        self.clarity
    }

    pub fn rms(&self) -> f32 {
        self.rms
    }

    /// Forward complex FFT, in place, radix 2.
    fn fft(&mut self) {
        let n = self.n;
        for i in 0..n {
            let j = self.rev[i] as usize;
            if j > i {
                self.re.swap(i, j);
                self.im.swap(i, j);
            }
        }
        let mut size = 2;
        while size <= n {
            let half = size / 2;
            let step = n / size;
            let mut start = 0;
            while start < n {
                for k in 0..half {
                    let wr = self.cos[k * step];
                    let wi = -self.sin[k * step];
                    let a = start + k;
                    let b = a + half;
                    let tr = self.re[b] * wr - self.im[b] * wi;
                    let ti = self.re[b] * wi + self.im[b] * wr;
                    self.re[b] = self.re[a] - tr;
                    self.im[b] = self.im[a] - ti;
                    self.re[a] += tr;
                    self.im[a] += ti;
                }
                start += size;
            }
            size *= 2;
        }
    }

    /// Detects the fundamental of the current input window.
    /// Returns the frequency in Hz, or 0 when there is no clear pitch.
    /// `k` is the MPM peak threshold relative to the highest key maximum (0.8 to 0.95).
    pub fn detect(&mut self, sample_rate: f32, fmin: f32, fmax: f32, k: f32) -> f32 {
        let w = self.w;
        let n = self.n;
        self.clarity = 0.0;

        let mean = self.input.iter().sum::<f32>() / w as f32;
        let mut energy = 0.0f32;
        for i in 0..w {
            let v = self.input[i] - mean;
            self.input[i] = v;
            self.re[i] = v;
            energy += v * v;
        }
        self.rms = (energy / w as f32).sqrt();
        if energy < 1e-9 {
            return 0.0;
        }
        for i in w..n {
            self.re[i] = 0.0;
        }
        for v in self.im.iter_mut() {
            *v = 0.0;
        }

        // Autocorrelation: FFT, power spectrum, FFT again (the power spectrum is
        // real and even, so the forward transform equals the inverse up to 1/n).
        self.fft();
        for i in 0..n {
            self.re[i] = self.re[i] * self.re[i] + self.im[i] * self.im[i];
            self.im[i] = 0.0;
        }
        self.fft();

        // Room past the longest period so its lobe can close; the overlap stays >= w/2.
        let max_lag = ((sample_rate / fmin * 1.3).ceil() as usize).min(w / 2);
        let min_lag = ((sample_rate / fmax).floor() as usize).max(2);
        let inv_n = 1.0 / n as f32;

        // NSDF: n(t) = 2 r(t) / m(t), m(t) = sum of x[j]^2 + x[j+t]^2 over the overlap.
        let mut m = 2.0 * energy;
        self.nsdf[0] = 1.0;
        for tau in 1..max_lag {
            let a = self.input[tau - 1];
            let b = self.input[w - tau];
            m -= a * a + b * b;
            let r = self.re[tau] * inv_n;
            self.nsdf[tau] = if m > 1e-12 { 2.0 * r / m } else { 0.0 };
        }

        // Key maxima: the highest point of each positive lobe after the first
        // negative-going zero crossing.
        let mut tau = 1;
        while tau < max_lag && self.nsdf[tau] > 0.0 {
            tau += 1;
        }
        let mut peaks = [0usize; 64];
        let mut count = 0;
        let mut highest = 0.0f32;
        while tau < max_lag - 1 && count < peaks.len() {
            while tau < max_lag - 1 && self.nsdf[tau] <= 0.0 {
                tau += 1;
            }
            let mut best = tau;
            while tau < max_lag - 1 && self.nsdf[tau] > 0.0 {
                if self.nsdf[tau] > self.nsdf[best] {
                    best = tau;
                }
                tau += 1;
            }
            // A usable maximum is a real local maximum inside the lag range (a lobe
            // cut off by the range end still counts once it turned downwards).
            if best >= min_lag
                && best + 1 < max_lag
                && self.nsdf[best] > 0.0
                && self.nsdf[best + 1] < self.nsdf[best]
            {
                peaks[count] = best;
                count += 1;
                if self.nsdf[best] > highest {
                    highest = self.nsdf[best];
                }
            }
        }
        if count == 0 {
            return 0.0;
        }

        let cut = k * highest;
        let mut chosen = peaks[0];
        for &p in &peaks[..count] {
            if self.nsdf[p] >= cut {
                chosen = p;
                break;
            }
        }

        // Parabolic interpolation around the chosen peak.
        let a = self.nsdf[chosen - 1];
        let b = self.nsdf[chosen];
        let c = self.nsdf[chosen + 1];
        let denom = a - 2.0 * b + c;
        let (delta, peak) = if denom.abs() > 1e-12 {
            let d = 0.5 * (a - c) / denom;
            (d, b - 0.25 * (a - c) * d)
        } else {
            (0.0, b)
        };
        self.clarity = peak.min(1.0);
        sample_rate / (chosen as f32 + delta)
    }

    /// Refines `f0`, found by `detect` on the same input, the way a strobe tuner
    /// works: by how far the phase of the first harmonics advances between the
    /// two halves of the window. A steady tone at exactly f advances by
    /// 2 pi f d / sample_rate over d samples; the difference to what `f0` predicts
    /// is the error, measured far finer than the NSDF peak can be placed.
    /// Returns 0 when the halves hold too few periods for a clean measurement
    /// (low notes in a short window), differ too much in level (a note just
    /// starting or stopping) or the result strays from `f0`.
    pub fn refine(&self, sample_rate: f32, f0: f32, fmax: f32) -> f32 {
        let d = self.w / 2;
        let sr = sample_rate as f64;
        let f0 = f0 as f64;
        if f0 <= 0.0 || (d as f64) < MIN_PERIODS * sr / f0 {
            return 0.0;
        }
        let tau = 2.0 * PI;
        let mut num = 0.0f64;
        let mut den = 0.0f64;
        let (mut ea, mut eb) = (0.0f64, 0.0f64);
        for h in 1..=HARMONICS {
            let fh = f0 * h as f64;
            if fh > fmax as f64 {
                break;
            }
            // One DFT bin at fh over each half, the rotation e^(-i w n) kept by recursion.
            let omega = tau * fh / sr;
            let (c, s) = (omega.cos(), omega.sin());
            let (mut zr, mut zi) = (1.0f64, 0.0f64);
            let (mut ar, mut ai, mut br, mut bi) = (0.0f64, 0.0f64, 0.0f64, 0.0f64);
            for i in 0..d {
                let wv = self.hann[i] as f64;
                let xa = self.input[i] as f64 * wv;
                let xb = self.input[i + d] as f64 * wv;
                ar += xa * zr;
                ai += xa * zi;
                br += xb * zr;
                bi += xb * zi;
                let t = zr * c + zi * s;
                zi = zi * c - zr * s;
                zr = t;
            }
            // B times conj(A): its angle is the phase advance over d samples, and
            // its size (the bin's power) weighs this harmonic against the others.
            let cr = br * ar + bi * ai;
            let ci = bi * ar - br * ai;
            let weight = (cr * cr + ci * ci).sqrt();
            ea += ar * ar + ai * ai;
            eb += br * br + bi * bi;
            if weight <= 0.0 {
                continue;
            }
            let mut err = ci.atan2(cr) - omega * d as f64;
            err -= tau * (err / tau).round();
            num += weight * (fh + err * sr / (tau * d as f64)) / h as f64;
            den += weight;
        }
        // The halves must hold the same tone: at an onset the first half is still
        // mostly silence and its phase is noise.
        if den <= 0.0 || ea.min(eb) < MIN_HALF_POWER * ea.max(eb) {
            return 0.0;
        }
        let f = num / den;
        if (1200.0 * (f / f0).log2()).abs() > MAX_SHIFT_CENTS {
            return 0.0;
        }
        f as f32
    }
}

// ── C ABI for the AudioWorklet ──────────────────────────────────────────────
// WebAssembly here is single threaded; the worklet owns the detectors. It keeps
// one per band (full and band-passed) and window size: slot = band * 3 + size
// index, the sizes short to long (see pitch.worklet.ts).

const SLOTS: usize = 6;
static mut DETECTORS: [Option<Detector>; SLOTS] = [None, None, None, None, None, None];

fn detector(slot: u32) -> Option<&'static mut Detector> {
    // SAFETY: wasm32 without threads, and the worklet calls these one at a time.
    unsafe { (*core::ptr::addr_of_mut!(DETECTORS)).get_mut(slot as usize)?.as_mut() }
}

/// Builds the detector in `slot` for `window` samples and returns its input buffer's address.
/// This allocates, which can grow the memory: build every slot before taking views on it.
#[no_mangle]
pub extern "C" fn tp_init(slot: u32, window: u32) -> *mut f32 {
    if slot as usize >= SLOTS {
        return core::ptr::null_mut();
    }
    // SAFETY: see `detector`.
    unsafe {
        (*core::ptr::addr_of_mut!(DETECTORS))[slot as usize] = Some(Detector::new(window as usize));
    }
    detector(slot).map_or(core::ptr::null_mut(), |d| d.input_mut().as_mut_ptr())
}

#[no_mangle]
pub extern "C" fn tp_detect(slot: u32, sample_rate: f32, fmin: f32, fmax: f32, k: f32) -> f32 {
    detector(slot).map_or(0.0, |d| d.detect(sample_rate, fmin, fmax, k))
}

/// Refines `f0` from the last `tp_detect` in this slot; 0 when it cannot.
#[no_mangle]
pub extern "C" fn tp_refine(slot: u32, sample_rate: f32, f0: f32, fmax: f32) -> f32 {
    detector(slot).map_or(0.0, |d| d.refine(sample_rate, f0, fmax))
}

#[no_mangle]
pub extern "C" fn tp_clarity(slot: u32) -> f32 {
    detector(slot).map_or(0.0, |d| d.clarity())
}

#[no_mangle]
pub extern "C" fn tp_rms(slot: u32) -> f32 {
    detector(slot).map_or(0.0, |d| d.rms())
}

#[cfg(test)]
mod tests {
    use super::*;

    const SR: f32 = 48_000.0;
    const W: usize = 4096;

    fn run(signal: impl Fn(f64) -> f64) -> (f32, f32) {
        let mut d = Detector::new(W);
        for (i, v) in d.input_mut().iter_mut().enumerate() {
            *v = signal(i as f64 / SR as f64) as f32;
        }
        let f = d.detect(SR, 27.0, 4200.0, 0.9);
        (f, d.clarity())
    }

    fn cents(f: f32, target: f32) -> f32 {
        1200.0 * (f / target).log2()
    }

    #[test]
    fn sine_a4() {
        let (f, c) = run(|t| (2.0 * PI * 440.0 * t).sin() * 0.5);
        assert!(cents(f, 440.0).abs() < 0.5, "got {f}");
        assert!(c > 0.95);
    }

    #[test]
    fn low_e_bass_sawtooth() {
        // E1 on a bass, harmonic rich: the fundamental must win, not an octave up.
        let f0 = 41.203;
        let (f, _) = run(|t| {
            (1..12).map(|h| (2.0 * PI * f0 * h as f64 * t).sin() / h as f64).sum::<f64>() * 0.3
        });
        assert!(cents(f, f0 as f32).abs() < 1.0, "got {f}");
    }

    #[test]
    fn low_b_five_string() {
        let f0 = 30.868;
        let (f, _) = run(|t| {
            (1..8).map(|h| (2.0 * PI * f0 * h as f64 * t).sin() / h as f64).sum::<f64>() * 0.3
        });
        assert!(cents(f, f0 as f32).abs() < 1.5, "got {f}");
    }

    #[test]
    fn weak_fundamental() {
        // Fundamental quieter than the 2nd and 3rd harmonics (common on guitars).
        let f0 = 110.0;
        let (f, _) = run(|t| {
            let w = 2.0 * PI * f0 * t;
            0.1 * w.sin() + 0.5 * (2.0 * w).sin() + 0.4 * (3.0 * w).sin()
        });
        assert!(cents(f, f0 as f32).abs() < 1.0, "got {f}");
    }

    #[test]
    fn high_note() {
        let (f, _) = run(|t| (2.0 * PI * 2093.0 * t).sin() * 0.3);
        assert!(cents(f, 2093.0).abs() < 1.0, "got {f}");
    }

    /// Small deterministic generator for phases, detunings and noise.
    struct Lcg(u64);
    impl Lcg {
        fn next(&mut self) -> f64 {
            self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            (self.0 >> 11) as f64 / (1u64 << 53) as f64
        }
        /// Roughly Gaussian, unit variance.
        fn gauss(&mut self) -> f64 {
            (0..12).map(|_| self.next()).sum::<f64>() - 6.0
        }
    }

    /// Harmonic tone: `amps[h-1]` for harmonic h, random phases, plus white noise at `snr_db`.
    fn tone(w: usize, f0: f64, amps: &[f64], snr_db: f64, rng: &mut Lcg) -> Vec<f32> {
        let phases: Vec<f64> = amps.iter().map(|_| rng.next() * 2.0 * PI).collect();
        let sig: Vec<f64> = (0..w)
            .map(|i| {
                let t = i as f64 / SR as f64;
                amps.iter()
                    .enumerate()
                    .filter(|(h, _)| f0 * (*h as f64 + 1.0) < SR as f64 * 0.45)
                    .map(|(h, a)| a * (2.0 * PI * f0 * (h as f64 + 1.0) * t + phases[h]).sin())
                    .sum()
            })
            .collect();
        let p = sig.iter().map(|v| v * v).sum::<f64>() / w as f64;
        let n = (p / 10f64.powf(snr_db / 10.0)).sqrt();
        sig.iter().map(|v| (v + n * rng.gauss()) as f32 * 0.3).collect()
    }

    /// Cent errors for one tone: MPM on the full 4096 window (the old tuner), and
    /// the new path: MPM on the last `w` samples, refined where `refine` accepts.
    fn measure(w: usize, f0: f64, amps: &[f64], snr_db: f64, rng: &mut Lcg) -> (Option<f64>, Option<f64>, bool) {
        let x = tone(W, f0, amps, snr_db, rng);
        let c = |v: f32| (v > 0.0).then(|| 1200.0 * (v as f64 / f0).log2());
        let mut long = Detector::new(W);
        long.input_mut().copy_from_slice(&x);
        let old = c(long.detect(SR, 27.0, 4500.0, 0.9));
        let mut d = Detector::new(w);
        d.input_mut().copy_from_slice(&x[W - w..]);
        let f = d.detect(SR, 27.0, 4500.0, 0.9);
        let r = if f > 0.0 { d.refine(SR, f, 5000.0) } else { 0.0 };
        (old, c(if r > 0.0 { r } else { f }), r > 0.0)
    }

    const SINE: &[f64] = &[1.0];
    const SAW: &[f64] = &[1.0, 0.5, 0.33, 0.25, 0.2, 0.17, 0.14, 0.12, 0.11, 0.1];
    // Brass-like: the 2nd to 4th harmonics stronger than the fundamental.
    const BRASS: &[f64] = &[0.5, 1.0, 0.9, 0.7, 0.5, 0.35, 0.25, 0.15];

    /// Periods the worklet wants in a window before it uses a shorter one.
    const PERIODS: f64 = 8.0;

    /// Error table: `cargo test --release -- --ignored --nocapture report`.
    #[test]
    #[ignore]
    fn report() {
        let mut rng = Lcg(7);
        for (name, amps) in [("sine", SINE), ("saw", SAW), ("brass", BRASS)] {
            for snr in [60.0, 20.0, 10.0] {
                println!("\n{name}, SNR {snr} dB      old: MPM w4096 rms/max    new: window, rms/max, refined");
                for f in [41.2, 82.4, 110.0, 196.0, 233.1, 440.0, 659.3, 880.0, 1318.5, 2093.0, 3520.0] {
                    // The smallest window holding PERIODS periods, as the worklet picks it.
                    let w = [1024usize, 2048, 4096]
                        .into_iter()
                        .find(|&w| w as f64 >= PERIODS * SR as f64 / f)
                        .unwrap_or(W);
                    let (mut o, mut n) = (Vec::new(), Vec::new());
                    let mut refined = 0;
                    for _ in 0..40 {
                        let f0 = f * 2f64.powf((rng.next() - 0.5) * 60.0 / 1200.0);
                        let (a, b, r) = measure(w, f0, amps, snr, &mut rng);
                        o.extend(a);
                        n.extend(b);
                        refined += r as i32;
                    }
                    let st = |v: &[f64]| {
                        let rms = (v.iter().map(|x| x * x).sum::<f64>() / v.len().max(1) as f64).sqrt();
                        (rms, v.iter().fold(0.0f64, |m, x| m.max(x.abs())))
                    };
                    let (or, om) = st(&o);
                    let (nr, nm) = st(&n);
                    println!("  {f:7.1} Hz      {or:8.3} / {om:8.3}          w{w:<4}  {nr:8.3} / {nm:8.3}  {refined:2}/40");
                }
            }
        }
    }

    /// RMS of the cent errors over `n` tones near `f` (random detuning, phases, noise).
    fn rms_errors(w: usize, f: f64, amps: &[f64], snr: f64, n: usize) -> (f64, f64) {
        let mut rng = Lcg(11);
        let (mut a, mut b) = (0.0, 0.0);
        for _ in 0..n {
            let f0 = f * 2f64.powf((rng.next() - 0.5) * 60.0 / 1200.0);
            let (old, new, _) = measure(w, f0, amps, snr, &mut rng);
            a += old.unwrap().powi(2);
            b += new.unwrap().powi(2);
        }
        ((a / n as f64).sqrt(), (b / n as f64).sqrt())
    }

    #[test]
    fn refine_removes_high_note_bias() {
        // C7, bright: MPM alone is off by cents, the refined pitch by a hundredth.
        let (old, new) = rms_errors(1024, 2093.0, SAW, 60.0, 20);
        assert!(old > 1.0, "MPM bias gone? {old}");
        assert!(new < 0.05, "refined {new}");
    }

    #[test]
    fn refine_is_steadier_in_noise() {
        for (f, w) in [(82.4, 4096), (110.0, 4096), (233.1, 2048), (2093.0, 1024)] {
            let (old, new) = rms_errors(w, f, BRASS, 15.0, 30);
            assert!(new < old, "{f} Hz: refined {new} vs MPM {old}");
        }
    }

    #[test]
    fn refine_measures_detuning() {
        let target = 440.0 * 2f64.powf(-7.3 / 1200.0);
        let mut d = Detector::new(1024);
        for (i, v) in d.input_mut().iter_mut().enumerate() {
            let t = i as f64 / SR as f64;
            *v = ((2.0 * PI * target * t).sin() * 0.4 + (4.0 * PI * target * t).sin() * 0.3) as f32;
        }
        let f = d.detect(SR, 27.0, 4500.0, 0.9);
        let r = d.refine(SR, f, 5000.0);
        assert!((1200.0 * (r as f64 / 440.0).log2() + 7.3).abs() < 0.1, "got {r}");
    }

    #[test]
    fn refine_declines_too_few_periods() {
        // E1 in a 4096 window: under 2.5 periods per half, MPM's pitch stands.
        let mut d = Detector::new(W);
        for (i, v) in d.input_mut().iter_mut().enumerate() {
            *v = (2.0 * PI * 41.2 * i as f64 / SR as f64).sin() as f32;
        }
        let f = d.detect(SR, 27.0, 4500.0, 0.9);
        assert!(f > 0.0);
        assert_eq!(d.refine(SR, f, 5000.0), 0.0);
    }

    #[test]
    fn refine_declines_an_onset() {
        // The note starts 3/8 into the window: the first half is mostly noise.
        let mut rng = Lcg(3);
        let mut d = Detector::new(2048);
        for (i, v) in d.input_mut().iter_mut().enumerate() {
            let t = i as f64 / SR as f64;
            let tone = if i > 768 { (2.0 * PI * 349.23 * t).sin() * 0.4 } else { 0.0 };
            *v = (tone + 0.003 * rng.gauss()) as f32;
        }
        let f = d.detect(SR, 27.0, 4500.0, 0.9);
        assert!(f > 0.0);
        assert_eq!(d.refine(SR, f, 5000.0), 0.0);
    }

    #[test]
    fn silence() {
        let (f, _) = run(|_| 0.0);
        assert_eq!(f, 0.0);
    }

    #[test]
    fn detuned_is_measured() {
        let target = 440.0 * 2f64.powf(-7.0 / 1200.0);
        let (f, _) = run(|t| (2.0 * PI * target * t).sin() * 0.5);
        assert!((cents(f, 440.0) + 7.0).abs() < 0.3, "got {}", cents(f, 440.0));
    }
}

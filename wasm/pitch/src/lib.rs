//! Pitch detection for the Tactus tuner: the McLeod Pitch Method (MPM).
//!
//! The normalised square difference function (NSDF) is computed from an
//! autocorrelation done with an FFT, so one frame costs O(n log n) instead of
//! O(n * lag). The detector is built once for a fixed window size; after that
//! nothing allocates, so the JavaScript views on the input buffer stay valid.
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
    clarity: f32,
    rms: f32,
}

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
}

// ── C ABI for the AudioWorklet ──────────────────────────────────────────────
// WebAssembly here is single threaded; the worklet owns the one detector.

static mut DETECTOR: Option<Detector> = None;

fn detector() -> Option<&'static mut Detector> {
    // SAFETY: wasm32 without threads, and the worklet calls these one at a time.
    unsafe { (*core::ptr::addr_of_mut!(DETECTOR)).as_mut() }
}

/// Builds the detector for `window` samples and returns the input buffer's address.
#[no_mangle]
pub extern "C" fn tp_init(window: u32) -> *mut f32 {
    // SAFETY: see `detector`.
    unsafe {
        *core::ptr::addr_of_mut!(DETECTOR) = Some(Detector::new(window as usize));
    }
    detector().map_or(core::ptr::null_mut(), |d| d.input_mut().as_mut_ptr())
}

#[no_mangle]
pub extern "C" fn tp_detect(sample_rate: f32, fmin: f32, fmax: f32, k: f32) -> f32 {
    detector().map_or(0.0, |d| d.detect(sample_rate, fmin, fmax, k))
}

#[no_mangle]
pub extern "C" fn tp_clarity() -> f32 {
    detector().map_or(0.0, |d| d.clarity())
}

#[no_mangle]
pub extern "C" fn tp_rms() -> f32 {
    detector().map_or(0.0, |d| d.rms())
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

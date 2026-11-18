// Independent check of octave disagreements between labels and the tuner, from
// the spectrum of the recording itself: if the odd harmonics of the lower
// candidate are there, the note is the lower one; if only its even harmonics
// are, it is an octave up.
//   node tools/eval-tuner/spectrum.mjs TAKE_ID [--f0 Hz]   peaks and harmonics of one take
//   node tools/eval-tuner/spectrum.mjs --octaves RUN        judge every octave-heavy take of a saved run
import { readFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DATA = join(root, 'evaluation');
const takes = JSON.parse(readFileSync(join(DATA, 'takes.json'), 'utf8'));
const sounds = JSON.parse(readFileSync(join(DATA, 'sounds.json'), 'utf8'));
const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const N = 65536;

function readMono(path) {
  const b = readFileSync(path);
  let o = 12;
  let ch = 1;
  let bits = 24;
  let sr = 48000;
  while (b.toString('ascii', o, o + 4) !== 'data') {
    if (b.toString('ascii', o, o + 4) === 'fmt ') {
      ch = b.readUInt16LE(o + 10);
      sr = b.readUInt32LE(o + 12);
      bits = b.readUInt16LE(o + 22);
    }
    o += 8 + b.readUInt32LE(o + 4);
  }
  o += 8;
  const bytes = bits / 8;
  const frames = Math.floor((b.length - o) / (bytes * ch));
  const x = new Float64Array(frames);
  for (let i = 0; i < frames; i++) {
    let v = 0;
    for (let c = 0; c < ch; c++) {
      const p = o + (i * ch + c) * bytes;
      v += bits === 16 ? b.readInt16LE(p) / 32768 : b.readIntLE(p, 3) / 8388608;
    }
    x[i] = v / ch;
  }
  return { x, sr };
}

/** Power spectrum in dB of the loudest N samples (Hann window). */
function spectrum(take) {
  const { x, sr } = readMono(join(DATA, take.filename));
  let start = 0;
  let best = -1;
  for (let i = 0; i + N <= x.length; i += 4800) {
    let e = 0;
    for (let j = i; j < i + N; j += 8) e += x[j] * x[j];
    if (e > best) (best = e), (start = i);
  }
  const re = new Float64Array(N);
  const im = new Float64Array(N);
  for (let i = 0; i < N; i++) re[i] = (x[start + i] ?? 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N));
  for (let i = 1, j = 0; i < N; i++) {
    let bit = N >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) ([re[i], re[j]] = [re[j], re[i]]), ([im[i], im[j]] = [im[j], im[i]]);
  }
  for (let len = 2; len <= N; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    for (let i = 0; i < N; i += len)
      for (let k = 0; k < len / 2; k++) {
        const wr = Math.cos(ang * k);
        const wi = Math.sin(ang * k);
        const a = i + k;
        const c = a + len / 2;
        const tr = re[c] * wr - im[c] * wi;
        const ti = re[c] * wi + im[c] * wr;
        re[c] = re[a] - tr;
        im[c] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
      }
  }
  const db = new Float64Array(N / 2);
  let top = -Infinity;
  for (let i = 0; i < N / 2; i++) {
    db[i] = 10 * Math.log10(re[i] ** 2 + im[i] ** 2 + 1e-20);
    const f = (i * sr) / N;
    if (f > 25 && f < 8000) top = Math.max(top, db[i]);
  }
  const levelAt = (f) => {
    const c = Math.round((f * N) / sr);
    const w = Math.max(2, Math.round((f * 0.015 * N) / sr)); // about ±25 cents
    let m = -Infinity;
    for (let i = Math.max(1, c - w); i <= Math.min(N / 2 - 1, c + w); i++) m = Math.max(m, db[i]);
    return m - top;
  };
  return { db, sr, start, top, levelAt };
}

const freq = (midi, a4) => a4 * 2 ** ((midi - 69) / 12);
const name = (m) => `${NAMES[((Math.round(m) % 12) + 12) % 12]}${Math.floor(Math.round(m) / 12) - 1}`;

/**
 * Which of two notes an octave (or more) apart is sounding: the lower one if its
 * odd harmonics (1st, 3rd, 5th) carry energy, the upper one if they do not.
 */
export function judge(sp, low, a4) {
  const f = freq(low, a4);
  const odd = Math.max(sp.levelAt(f), sp.levelAt(3 * f), sp.levelAt(5 * f));
  const even = Math.max(sp.levelAt(2 * f), sp.levelAt(4 * f));
  // Within 25 dB of the even harmonics: the lower note is there. 40 dB under: it is not.
  const gap = even - odd;
  return { odd, even, verdict: gap < 25 ? 'low' : gap > 40 ? 'high' : 'unclear' };
}

const args = process.argv.slice(2);
if (args[0] === '--octaves') {
  const run = JSON.parse(readFileSync(join(DATA, 'results', args[1].replace(/\.json$/, '') + '.json'), 'utf8'));
  const rows = run.rows.filter((r) => r.sus > 20 && r.octave / r.sus > 0.2 && r.shown != null && (r.shown - r.expected) % 12 === 0 && r.shown !== r.expected);
  const tally = new Map();
  const tunerWrong = [];
  for (const r of rows) {
    const s = sounds[r.sound];
    const a4 = s.pitch_reference ?? 440;
    const low = Math.min(r.expected, r.shown);
    const high = Math.max(r.expected, r.shown);
    // Only one octave apart can be judged this way.
    if (high - low !== 12) continue;
    const j = judge(spectrum(takes[r.id]), low, a4);
    const sounding = j.verdict === 'low' ? low : j.verdict === 'high' ? high : null;
    const who = sounding == null ? 'unclear' : sounding === r.shown ? 'label wrong, tuner right' : 'tuner wrong';
    const key = `${r.instrument}|${who}|${r.shown > r.expected ? 'shown up' : 'shown down'}`;
    tally.set(key, (tally.get(key) ?? 0) + 1);
    if (who === 'tuner wrong') tunerWrong.push({ r, j });
  }
  console.log(`${rows.length} takes with more than 20% octave frames in ${args[1]}\n`);
  for (const [k, n] of [...tally].sort()) {
    const [i, who, dir] = k.split('|');
    console.log(`  ${i.padEnd(14)} ${who.padEnd(26)} ${dir.padEnd(11)} ${n}`);
  }
  console.log('\nTuner octave errors (odd/even harmonic level of the lower note, dB):');
  for (const { r, j } of tunerWrong)
    console.log(`  take ${String(r.id).padEnd(6)} ${r.instrument.padEnd(12)} ${name(r.expected).padEnd(4)} shown ${name(r.shown).padEnd(4)} ${(100 * r.octave / r.sus).toFixed(0).padStart(3)}%  odd ${j.odd.toFixed(0)} even ${j.even.toFixed(0)}  ${r.file}`);
} else {
  const take = takes[args[0]];
  if (!take) throw new Error('usage: spectrum.mjs TAKE_ID [--f0 Hz] | --octaves RUN');
  const s = sounds[take.sound_id];
  const a4 = s.pitch_reference ?? 440;
  const sp = spectrum(take);
  const label = s.semitone + 12;
  const cents = (f) => {
    const m = 69 + 12 * Math.log2(f / a4);
    return `${name(m)}${(m - Math.round(m) >= 0 ? '+' : '') + ((m - Math.round(m)) * 100).toFixed(0)}`;
  };
  console.log(`take ${take.id}  ${take.filename}  label ${name(label)}  ${s.klass ?? ''}  from ${(sp.start / sp.sr).toFixed(2)}s`);
  const peaks = [];
  for (let i = 3; i < N / 2 - 3; i++) {
    const f = (i * sp.sr) / N;
    if (f < 25 || f > 8000) continue;
    const d = sp.db;
    if (d[i] > d[i - 1] && d[i] >= d[i + 1] && d[i] > d[i - 2] && d[i] > d[i + 2]) peaks.push([f, d[i] - sp.top]);
  }
  console.log('Strongest peaks (dB below the top), by frequency:');
  for (const [f, d] of peaks.sort((a, b) => b[1] - a[1]).slice(0, 10).sort((a, b) => a[0] - b[0]))
    console.log(`  ${f.toFixed(1).padStart(8)} Hz  ${cents(f).padEnd(8)} ${d.toFixed(1).padStart(6)}`);
  const fi = args.indexOf('--f0');
  const f0 = fi > 0 ? Number(args[fi + 1]) : freq(label, a4);
  console.log(`Harmonics of ${f0.toFixed(1)} Hz (${cents(f0)}):  ` + [1, 2, 3, 4, 5, 6].map((h) => `${h}: ${sp.levelAt(f0 * h).toFixed(0)}`).join('   '));
}

// Tuner evaluation on the Good-Sounds dataset (local only, evaluation/ is not committed).
//
// Every recording is replayed through the real pitch worklet and Tuner (the
// shipped WASM detector, band choice, median, hysteresis, smoothing, hold), and
// what the tuner would display is scored against the annotated note.
//
//   node tools/eval-tuner/run.mjs [options]
//     --instrument flute,violin   only these instruments
//     --pack text                 only packs whose name contains text
//     --klass text                only sounds whose klass contains text
//     --mic best|neumann|akg|iphone|all   (best: one take per sound, neumann > akg > iphone)
//     --sample N                  random N takes (seeded, repeatable)
//     --scales                    include scale exercises (unannotated, 15 notes each; skipped by default)
//     --strict                    one label offset per pack, no local relabelling (see below)
//     --engine wasm|js            detector build (default wasm)
//     --by instrument|pack|klass|mic   summary grouping (default instrument)
//     --name NAME                 result file name (default: timestamp)
//     --workers N
//     --worst N                   list the N worst takes (default 15)
//   node tools/eval-tuner/run.mjs --leaps N [--run baseline]   legato octave leaps (N, 0 = all) spliced from a saved run
//   node tools/eval-tuner/run.mjs --compare A B     compare two saved runs
//   node tools/eval-tuner/run.mjs --trace TAKE_ID [--run NAME]   dump one take's frames to CSV
//   node tools/eval-tuner/spectrum.mjs ...           check octave disagreements against the spectrum
//
// Labels: `semitone` is MIDI - 12. Octave and transposition labels differ by
// pack (written pitch for the saxes and clarinet, some flute notes an octave
// low), so each pack's label-to-sounding offset is taken as the most common
// difference between label and displayed note across its takes, and printed.
// Within packs the labels also slip in blocks (a skipped note shifts every
// later label by one), so unless --strict each take uses the most common
// offset among its neighbours (sound ids within 8): a lone wrong reading stays
// an error, a shifted run of labels does not. Takes relabelled this way are
// counted in the "relab" column; a tuner error repeated over 7+ neighbouring
// notes would be relabelled too, so check that column and listen.

import { build } from 'esbuild';
import { Worker } from 'node:worker_threads';
import { availableParallelism } from 'node:os';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..');

// ── Arguments ───────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const opt = {};
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (!a.startsWith('--')) continue;
  const key = a.slice(2);
  if (key === 'compare') opt.compare = [argv[++i], argv[++i]];
  else if (key === 'scales' || key === 'strict') opt[key] = true;
  else opt[key] = argv[++i];
}
const DATA = resolve(opt.data ?? join(root, 'evaluation'));
const RESULTS = join(DATA, 'results');
const CACHE = join(DATA, '.cache');


// ── Dataset ─────────────────────────────────────────────────────────────────
if (!existsSync(join(DATA, 'sounds.json'))) {
  console.error(`Good-Sounds not found in ${DATA} (expected sounds.json, takes.json, packs.json, sound_files/).`);
  process.exit(1);
}
const load = (f) => Object.values(JSON.parse(readFileSync(join(DATA, f), 'utf8')));
const sounds = new Map(load('sounds.json').map((s) => [s.id, s]));
const packs = new Map(load('packs.json').map((p) => [p.id, p]));
const takes = load('takes.json');

const PC = { C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11 };
const labelMidi = (s) =>
  s.semitone != null ? s.semitone + 12 : PC[s.note] != null && s.octave != null ? 12 * (s.octave + 1) + PC[s.note] : null;
const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const noteName = (m) => (m == null || m < 0 ? '–' : NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1));

function select() {
  const instr = opt.instrument?.split(',');
  const mic = opt.mic ?? 'best';
  const rank = { neumann: 0, akg: 1, iphone: 2 };
  let list = takes.filter((t) => {
    const s = sounds.get(t.sound_id);
    if (!s || labelMidi(s) == null) return false;
    if (!opt.scales && /scale/.test(s.klass ?? '')) return false;
    if (instr && !instr.includes(s.instrument)) return false;
    if (opt.pack && !packs.get(s.pack_id)?.name.includes(opt.pack)) return false;
    if (opt.klass && !(s.klass ?? '').includes(opt.klass)) return false;
    if (mic !== 'best' && mic !== 'all' && t.microphone !== mic) return false;
    return true;
  });
  if (mic === 'best') {
    const best = new Map();
    for (const t of list) {
      const b = best.get(t.sound_id);
      if (!b || (rank[t.microphone] ?? 9) < (rank[b.microphone] ?? 9)) best.set(t.sound_id, t);
    }
    list = [...best.values()];
  }
  list.sort((a, b) => a.id - b.id);
  if (opt.sample) {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    list = list.slice(0, Number(opt.sample)).sort((a, b) => a.id - b.id);
  }
  return list;
}

// ── Simulation ──────────────────────────────────────────────────────────────
async function bundle() {
  mkdirSync(CACHE, { recursive: true });
  const outfile = join(CACHE, 'sim.mjs');
  await build({
    entryPoints: [join(here, 'sim.ts')],
    bundle: true,
    format: 'esm',
    platform: 'neutral',
    outfile,
    logLevel: 'warning',
    define: {
      'performance.now': '__evalNow',
      'window.setTimeout': '__evalSetTimeout',
      clearTimeout: '__evalClearTimeout',
    },
    plugins: [
      {
        name: 'vite-url-stub',
        setup(b) {
          b.onResolve({ filter: /\?/ }, (a) => ({ path: a.path, namespace: 'stub' }));
          b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export default "";', loader: 'js' }));
        },
      },
    ],
  });
  return outfile;
}

const takeMessage = (t) => ({ id: t.id, path: join(DATA, t.filename), a4: sounds.get(t.sound_id).pitch_reference ?? 440 });

async function runAll(list, onDone, toMessage = takeMessage) {
  const bundlePath = await bundle();
  const n = Math.max(1, Math.min(Number(opt.workers ?? availableParallelism() - 1), list.length));
  const data = { bundle: bundlePath, wasmPath: join(root, 'src', 'audio', 'pitch.wasm'), engine: opt.engine ?? 'wasm' };
  let next = 0;
  let done = 0;
  const started = Date.now();
  let lastLog = 0;
  await Promise.all(
    Array.from({ length: n }, () => new Promise((res, rej) => {
      const w = new Worker(join(here, 'worker.mjs'), { workerData: data });
      const feed = () => {
        if (next >= list.length) {
          w.terminate();
          return res();
        }
        w.postMessage(toMessage(list[next++]));
      };
      w.on('message', (m) => {
        if (m.ready) return feed();
        onDone(m);
        done++;
        const now = Date.now();
        if (now - lastLog > 2000 || done === list.length) {
          lastLog = now;
          const rate = done / ((now - started) / 1000);
          process.stderr.write(`\r  ${done}/${list.length} takes  ${rate.toFixed(1)}/s  eta ${Math.round((list.length - done) / rate)}s   `);
        }
        feed();
      });
      w.on('error', rej);
    })),
  );
  process.stderr.write('\n');
}

// ── Scoring ─────────────────────────────────────────────────────────────────
/** Frames the tuner wants to have shown the note for before it counts as settled (~110 ms). */
const SETTLE_FRAMES = 10;

/**
 * When the note becomes audible: the first moment the level is within 20 dB of
 * the note's loud part (and 6 dB over the noise floor), searched from shortly
 * before the annotated attack. Some annotated attacks are off by most of a second.
 */
function audibleOnset(env, envStep, sr, from, to) {
  const i0 = Math.max(0, Math.floor((from * sr) / envStep));
  const i1 = Math.min(env.length, Math.ceil((to * sr) / envStep));
  if (i1 - i0 < 4) return from;
  const part = Array.from(env.subarray(i0, i1));
  const loud = quantile(part, 0.9);
  const noise = quantile(Array.from(env), 0.05);
  const th = Math.max(loud - 20, noise + 6);
  // Held for 30 ms, so a click or a noise burst does not count.
  const hold = Math.max(1, Math.round((0.03 * sr) / envStep));
  let run = 0;
  for (let i = i0; i < i1; i++) {
    run = env[i] >= th ? run + 1 : 0;
    if (run === hold) return ((i - hold + 1) * envStep) / sr;
  }
  return from;
}

/** Note region: annotated, or from the displayed readings when the sound has no annotation. */
function region(s, res) {
  const { sr, len, trace: tr } = res;
  if (s.attack != null) {
    const off = (s.offset ?? s.release ?? len) / sr;
    const rel = (s.release ?? s.offset ?? len) / sr;
    const a = Math.max(0, audibleOnset(res.env, res.envStep, sr, s.attack / sr - 0.3, rel));
    return { a, annotatedAttack: s.attack / sr, off, rel, sus: Math.max(a + 0.25, (s.decay ?? 0) / sr), annotated: true };
  }
  // Without annotation: the level envelope bounds the note.
  const a = audibleOnset(res.env, res.envStep, sr, 0, len / sr);
  const off = audibleOnset(res.env.slice().reverse(), res.envStep, sr, 0, len / sr);
  const end = len / sr - off;
  return { a, off: end, rel: Math.max(a, end - 0.1), sus: a + 0.3, annotated: false };
}

function dominant(tr, r) {
  const count = new Map();
  for (let i = 0; i < tr.t.length; i++) {
    if (tr.t[i] < r.sus || tr.t[i] > r.rel - 0.05 || !tr.live[i]) continue;
    count.set(tr.note[i], (count.get(tr.note[i]) ?? 0) + 1);
  }
  let best = null;
  let n = 0;
  for (const [k, v] of count) if (v > n) (best = k), (n = v);
  return best;
}

const pct = (a, b) => (b ? (100 * a) / b : NaN);
const median = (v) => quantile(v, 0.5);
function quantile(v, q) {
  const s = v.filter((x) => x != null && Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return NaN;
  const p = (s.length - 1) * q;
  const lo = Math.floor(p);
  return s[lo] + (s[Math.min(lo + 1, s.length - 1)] - s[lo]) * (p - lo);
}

function score(take, res, offset) {
  const s = sounds.get(take.sound_id);
  const tr = res.trace;
  const r = res.region;
  const E = labelMidi(s) + offset;
  const m = { sus: 0, correct: 0, octave: 0, near: 0, far: 0, drop: 0, pre: 0, ghost: 0 };
  let latency = null;
  let settle = null;
  let glitch = false;
  let run = 0;
  let tail = 0;
  const cents = [];
  const rawCents = [];
  const steps = [];
  for (let i = 0; i < tr.t.length; i++) {
    const t = tr.t[i];
    const live = tr.live[i] === 1;
    const note = tr.note[i];
    const ok = live && note === E;
    if (t < r.a - 0.05) {
      // Before the note: a reading far from it is a false one. The note itself,
      // heard while still quiet (a crescendo from nothing), is not.
      m.pre++;
      if (live && Math.abs(note - E) > 2) m.ghost++;
      run = ok ? run + 1 : 0;
      continue;
    }
    if (t <= r.rel) {
      if (ok && latency == null) latency = Math.max(0, t - r.a);
      // A neighbour note at the onset is usually the player scooping into it.
      if (latency == null && live && Math.abs(note - E) > 2) glitch = true;
      run = ok ? run + 1 : 0;
      if (run >= SETTLE_FRAMES && settle == null) settle = Math.max(0, tr.t[i - SETTLE_FRAMES + 1] - r.a);
    }
    if (t > r.off && live) tail = t - r.off;
    if (t < r.sus || t > r.rel - 0.05) continue;
    m.sus++;
    if (!live) m.drop++;
    else if (note === E) {
      m.correct++;
      cents.push(tr.cents[i]);
    } else if ((note - E) % 12 === 0) m.octave++;
    else if (Math.abs(note - E) <= 2) m.near++;
    else m.far++;
    const raw = tr.raw[i];
    if (Number.isFinite(raw) && Math.round(raw) === E) {
      rawCents.push((raw - E) * 100);
      const prev = tr.raw[i - 1];
      if (Number.isFinite(prev) && Math.round(prev) === E) steps.push(Math.abs(raw - prev) * 100);
    }
  }
  const mean = cents.reduce((a, b) => a + b, 0) / (cents.length || 1);
  return {
    id: take.id,
    sound: s.id,
    file: take.filename,
    instrument: s.instrument,
    // Note region in seconds, for the leap test.
    a: r.a,
    rel: r.rel,
    pack: packs.get(s.pack_id)?.name,
    klass: s.klass,
    mic: take.microphone,
    annotated: r.annotated,
    expected: E,
    shown: res.dominant,
    ...m,
    miss: latency == null,
    latency,
    settle,
    glitch,
    tail,
    // Spread of the displayed needle while the note is right (includes the player's vibrato).
    jitter: cents.length > 4 ? Math.sqrt(cents.reduce((a, c) => a + (c - mean) ** 2, 0) / cents.length) : null,
    // Typical frame-to-frame change of the unsmoothed pitch: detector noise, mostly.
    step: steps.length > 4 ? median(steps) : null,
    intonation: rawCents.length ? median(rawCents) : null,
  };
}

// ── Report ──────────────────────────────────────────────────────────────────
function summarise(rows) {
  const sum = (k) => rows.reduce((a, r) => a + r[k], 0);
  const sus = sum('sus');
  const pre = sum('pre');
  const ms = (v) => (Number.isFinite(v) ? Math.round(v * 1000) : NaN);
  return {
    takes: rows.length,
    relab: rows.filter((r) => r.relabelled).length,
    correct: pct(sum('correct'), sus),
    octave: pct(sum('octave'), sus),
    near: pct(sum('near'), sus),
    far: pct(sum('far'), sus),
    drop: pct(sum('drop'), sus),
    miss: pct(rows.filter((r) => r.miss).length, rows.length),
    lat50: ms(median(rows.map((r) => r.latency))),
    lat90: ms(quantile(rows.map((r) => r.latency), 0.9)),
    settle50: ms(median(rows.map((r) => r.settle))),
    settle90: ms(quantile(rows.map((r) => r.settle), 0.9)),
    glitch: pct(rows.filter((r) => r.glitch).length, rows.length),
    ghost: pct(sum('ghost'), pre),
    jitter: median(rows.map((r) => r.jitter)),
    step: median(rows.map((r) => r.step)),
    inton: median(rows.map((r) => (r.intonation == null ? null : Math.abs(r.intonation)))),
  };
}

const COLS = [
  ['takes', 6, (v) => String(v)],
  ['relab', 6, (v) => String(v)],
  ['correct', 8, (v) => v.toFixed(1)],
  ['octave', 7, (v) => v.toFixed(2)],
  ['near', 6, (v) => v.toFixed(2)],
  ['far', 6, (v) => v.toFixed(2)],
  ['drop', 6, (v) => v.toFixed(1)],
  ['miss', 6, (v) => v.toFixed(1)],
  ['lat50', 6, (v) => String(v)],
  ['lat90', 6, (v) => String(v)],
  ['settle50', 9, (v) => String(v)],
  ['settle90', 9, (v) => String(v)],
  ['glitch', 7, (v) => v.toFixed(1)],
  ['ghost', 6, (v) => v.toFixed(2)],
  ['jitter', 7, (v) => v.toFixed(2)],
  ['step', 6, (v) => v.toFixed(2)],
  ['inton', 6, (v) => v.toFixed(1)],
];
const fmt = (c, v) => (v == null || Number.isNaN(v) ? '–' : c[2](v)).padStart(c[1]);

function groups(rows, by) {
  const g = new Map();
  for (const r of rows) g.set(r[by], [...(g.get(r[by]) ?? []), r]);
  return [...g].sort((a, b) => String(a[0]).localeCompare(String(b[0])));
}

function table(rows, by) {
  const w = Math.max(10, ...groups(rows, by).map(([k]) => String(k).length)) + 1;
  console.log('\n' + by.padEnd(w) + COLS.map((c) => c[0].padStart(c[1])).join(' '));
  for (const [k, rs] of [...groups(rows, by), ['ALL', rows]]) {
    const s = summarise(rs);
    console.log(String(k).padEnd(w) + COLS.map((c) => fmt(c, s[c[0]])).join(' '));
  }
  console.log(`
  correct/octave/near/far/drop: % of sustain frames showing the right note / an octave off / 1-2 semitones off
    (mostly the player) / 3+ semitones off (harmonic errors) / nothing live
  miss: % of takes never showing the right note   lat, settle: ms from attack to first right note / to 110 ms steady (p50, p90)
  glitch: % of takes showing a note 3+ semitones off before the right one
  ghost: % of frames before the note showing a note 3+ semitones off it (noise, rumble, room)
  jitter: needle s.d. in cents on the right note (vibrato included)   step: median frame-to-frame change of the raw pitch, cents
  inton: median |cents| of the player against A4 = pitch_reference (the recording, not the tuner)`);
}

// ── Compare ─────────────────────────────────────────────────────────────────
function loadRun(name) {
  const p = existsSync(name) ? name : join(RESULTS, name.endsWith('.json') ? name : name + '.json');
  return JSON.parse(readFileSync(p, 'utf8'));
}

function compare(a, b) {
  const A = loadRun(a);
  const B = loadRun(b);
  const ids = new Set(A.rows.map((r) => r.id));
  const rowsB = B.rows.filter((r) => ids.has(r.id));
  const idsB = new Set(rowsB.map((r) => r.id));
  const rowsA = A.rows.filter((r) => idsB.has(r.id));
  const by = opt.by ?? 'instrument';
  console.log(`${a}  vs  ${b}   (${rowsA.length} takes in both)`);
  const gA = new Map(groups(rowsA, by));
  const w = Math.max(10, ...[...gA.keys()].map((k) => String(k).length)) + 1;
  console.log('\n' + by.padEnd(w) + COLS.map((c) => c[0].padStart(c[1])).join(' '));
  for (const [k, rs] of [...groups(rowsB, by), ['ALL', rowsB]]) {
    const sa = summarise(k === 'ALL' ? rowsA : gA.get(k) ?? []);
    const sb = summarise(rs);
    console.log(String(k).padEnd(w) + COLS.map((c) => fmt(c, sa[c[0]])).join(' '));
    console.log(''.padEnd(w) + COLS.map((c) => fmt(c, sb[c[0]])).join(' '));
    console.log(''.padEnd(w) + COLS.map((c) => {
      const d = sb[c[0]] - sa[c[0]];
      return (Number.isFinite(d) && d !== 0 ? (d > 0 ? '+' : '') + (Math.abs(d) >= 10 ? d.toFixed(0) : d.toFixed(2)) : '').padStart(c[1]);
    }).join(' ') + '\n');
  }
  const mapA = new Map(rowsA.map((r) => [r.id, r]));
  const changed = rowsB
    .map((r) => ({ r, d: pct(r.correct, r.sus) - pct(mapA.get(r.id).correct, mapA.get(r.id).sus) }))
    .filter((x) => Number.isFinite(x.d) && Math.abs(x.d) >= 5)
    .sort((x, y) => x.d - y.d);
  if (changed.length) {
    console.log('Takes whose correct% moved by 5 or more:');
    for (const { r, d } of [...changed.slice(0, 10), ...changed.slice(-10).filter((x) => !changed.slice(0, 10).includes(x))])
      console.log(`  ${(d > 0 ? '+' : '') + d.toFixed(0)}%`.padEnd(8) + ` take ${r.id}  ${noteName(r.expected)}  ${r.file}`);
  }
}

// ── Main ────────────────────────────────────────────────────────────────────
if (opt.compare) {
  compare(...opt.compare);
  process.exit(0);
}

// ── Leap test ───────────────────────────────────────────────────────────────
// The dataset holds one note per file, so a tuner that clings to the note it
// tracks would never be caught. This splices two clean takes of the same pack
// an octave apart into one legato line (1.2 s each, 10 ms crossfade, same
// level), up and down, and checks how fast and how surely the tuner follows.
if (opt.leaps) {
  const base = loadRun(opt.run ?? 'baseline');
  const SEG = 1.2;
  const clean = base.rows.filter((r) => r.sus > 20 && r.correct / r.sus >= 0.95 && r.octave === 0 && r.a != null && r.rel - r.a >= SEG + 0.4);
  const byKey = new Map();
  for (const r of clean) {
    const k = `${r.pack}|${r.mic}|${r.expected}`;
    if (!byKey.has(k)) byKey.set(k, r);
  }
  const pairs = [];
  for (const r of byKey.values()) {
    const hi = byKey.get(`${r.pack}|${r.mic}|${r.expected + 12}`);
    if (hi) pairs.push([r, hi], [hi, r]);
  }
  const limit = Number(opt.leaps) || pairs.length;
  const chosen = pairs.filter((_, i) => i % Math.max(1, Math.floor(pairs.length / limit)) === 0).slice(0, limit);
  console.log(`${chosen.length} octave leaps (${pairs.length} possible) from ${opt.run ?? 'baseline'}, engine ${opt.engine ?? 'wasm'}`);
  const tests = chosen.map(([p, q], i) => ({ id: i, p, q }));
  const seg = (r) => [join(DATA, r.file), r.a + 0.3, r.a + 0.3 + SEG];
  const out = [];
  await runAll(
    tests,
    (m) => {
      if (m.error) return console.log(`leap ${m.id}: ${m.error}`);
      const { p, q } = tests[m.id];
      const tr = m.trace;
      const join0 = m.joins[0];
      let first = 0;
      let firstN = 0;
      let latency = null;
      let settle = null;
      let run = 0;
      let endOk = 0;
      let endN = 0;
      for (let i = 0; i < tr.t.length; i++) {
        const t = tr.t[i];
        const live = tr.live[i] === 1;
        if (t > 0.4 && t < join0) (firstN++, live && tr.note[i] === p.expected && first++);
        if (t < join0) continue;
        const ok = live && tr.note[i] === q.expected;
        if (ok && latency == null) latency = t - join0;
        run = ok ? run + 1 : 0;
        if (run >= SETTLE_FRAMES && settle == null) settle = tr.t[i - SETTLE_FRAMES + 1] - join0;
        if (t > join0 + 0.4) (endN++, ok && endOk++);
      }
      out.push({ p, q, up: q.expected > p.expected, first: first / firstN, latency, settle, end: endOk / endN });
    },
    (x) => ({ id: x.id, segments: [seg(x.p), seg(x.q)], a4: sounds.get(x.p.sound).pitch_reference ?? 440 }),
  );
  const ms = (v) => (Number.isFinite(v) ? String(Math.round(v * 1000)) : '–');
  console.log('\ndirection  instrument     leaps  first%  end%  stuck  lat50  lat90  settle50  settle90');
  const rowsOf = (d) => [...groups(out.filter((x) => x.up === d).map((x) => ({ ...x, instrument: x.p.instrument })), 'instrument'), ['ALL', out.filter((x) => x.up === d)]];
  for (const d of [true, false])
    for (const [k, rs] of rowsOf(d)) {
      const mean = (f) => (100 * rs.reduce((a, x) => a + f(x), 0)) / rs.length;
      console.log(
        (d ? 'up' : 'down').padEnd(11) + String(k).padEnd(14) + String(rs.length).padStart(6) +
        mean((x) => x.first).toFixed(1).padStart(8) + mean((x) => x.end).toFixed(1).padStart(6) +
        String(rs.filter((x) => x.end < 0.5).length).padStart(7) +
        ms(median(rs.map((x) => x.latency))).padStart(7) + ms(quantile(rs.map((x) => x.latency), 0.9)).padStart(7) +
        ms(median(rs.map((x) => x.settle))).padStart(10) + ms(quantile(rs.map((x) => x.settle), 0.9)).padStart(10),
      );
    }
  console.log(`
  first%/end%: frames on the right note before the leap / from 0.4 s after it   stuck: leaps whose end% stays under 50
  lat, settle: ms from the join to the first right reading / to 110 ms steady on it`);
  const stuck = out.filter((x) => x.end < 0.5);
  if (stuck.length) {
    console.log('\nStuck leaps:');
    for (const x of stuck.slice(0, 20))
      console.log(`  ${noteName(x.p.expected)} -> ${noteName(x.q.expected)}  end ${(100 * x.end).toFixed(0)}%  takes ${x.p.id} ${x.q.id}  ${x.p.instrument}`);
  }
  if (opt.name) {
    mkdirSync(RESULTS, { recursive: true });
    writeFileSync(join(RESULTS, opt.name + '.json'), JSON.stringify({ options: opt, leaps: out.map((x) => ({ ...x, p: x.p.id, q: x.q.id })) }));
  }
  process.exit(0);
}

const list = opt.trace ? takes.filter((t) => String(t.id) === String(opt.trace)) : select();
if (!list.length) {
  console.error('No takes match.');
  process.exit(1);
}
console.log(`${list.length} takes, engine ${opt.engine ?? 'wasm'}`);
const results = new Map();
const errors = [];
await runAll(list, (m) => {
  if (m.error) return errors.push(`take ${m.id}: ${m.error}`);
  results.set(m.id, m);
});
if (errors.length) console.log(`${errors.length} takes failed:\n  ` + errors.slice(0, 10).join('\n  '));

const byId = new Map(list.map((t) => [t.id, t]));
for (const [id, res] of results) {
  res.region = region(sounds.get(byId.get(id).sound_id), res);
  res.dominant = dominant(res.trace, res.region);
}

// Label-to-sounding offset per pack and instrument: the most common difference.
const offsets = new Map();
for (const [id, res] of results) {
  const s = sounds.get(byId.get(id).sound_id);
  if (res.dominant == null) continue;
  const key = `${packs.get(s.pack_id)?.name} ${s.instrument}`;
  const d = res.dominant - labelMidi(s);
  const c = offsets.get(key) ?? new Map();
  c.set(d, (c.get(d) ?? 0) + 1);
  offsets.set(key, c);
}
const offsetOf = new Map();
console.log('\nLabel → sounding offset per pack (semitones, share of takes agreeing):');
for (const [key, c] of [...offsets].sort()) {
  const [d, n] = [...c].sort((a, b) => b[1] - a[1])[0];
  const total = [...c.values()].reduce((a, b) => a + b, 0);
  offsetOf.set(key, d);
  console.log(`  ${key.padEnd(52)} ${(d > 0 ? '+' : '') + d}`.padEnd(60) + `${((100 * n) / total).toFixed(0)}% of ${total}`);
}

// Local offset: the most common one among neighbouring sounds of the same pack.
const NEIGHBOURS = 8;
const byPack = new Map();
for (const [id, res] of results) {
  const s = sounds.get(byId.get(id).sound_id);
  const key = `${packs.get(s.pack_id)?.name} ${s.instrument}`;
  if (!byPack.has(key)) byPack.set(key, []);
  byPack.get(key).push({ id, sound: s.id, d: res.dominant == null ? null : res.dominant - labelMidi(s) });
}
const localOffset = new Map();
for (const [key, list] of byPack) {
  const packOffset = offsetOf.get(key) ?? 0;
  for (const x of list) {
    const c = new Map();
    let n = 0;
    for (const y of list)
      if (y.d != null && Math.abs(y.sound - x.sound) <= NEIGHBOURS) (c.set(y.d, (c.get(y.d) ?? 0) + 1), n++);
    let best = packOffset;
    let bestN = c.get(packOffset) ?? 0;
    for (const [d, k] of c) if (k > bestN) (best = d), (bestN = k);
    // Too few neighbours (a sampled run) or no clear majority: keep the pack's offset.
    localOffset.set(x.id, opt.strict || n < 5 || bestN * 2 <= n ? packOffset : best);
  }
}

const rows = [];
for (const [id, res] of results) {
  const t = byId.get(id);
  const s = sounds.get(t.sound_id);
  const packOffset = offsetOf.get(`${packs.get(s.pack_id)?.name} ${s.instrument}`) ?? 0;
  const row = score(t, res, localOffset.get(id) ?? packOffset);
  row.relabelled = (localOffset.get(id) ?? packOffset) !== packOffset;
  rows.push(row);
}
rows.sort((a, b) => a.id - b.id);

if (opt.trace) {
  const res = results.get(list[0].id);
  const tr = res.trace;
  // One take cannot calibrate its own label offset: take the expected note from
  // a saved run (--run NAME, default baseline), else the raw label.
  const t = list[0];
  const s = sounds.get(t.sound_id);
  let offset = 0;
  try {
    const saved = loadRun(opt.run ?? 'baseline').rows.find((x) => x.id === t.id);
    if (saved) offset = saved.expected - labelMidi(s);
  } catch {
    /* no saved run */
  }
  const r = score(t, res, offset);
  const lines = ['t,raw_midi,raw_note,shown_note,cents,live'];
  for (let i = 0; i < tr.t.length; i++)
    lines.push([tr.t[i].toFixed(4), Number.isFinite(tr.raw[i]) ? tr.raw[i].toFixed(3) : '', Number.isFinite(tr.raw[i]) ? noteName(Math.round(tr.raw[i])) : '', noteName(tr.note[i]), tr.cents[i].toFixed(2), tr.live[i]].join(','));
  mkdirSync(RESULTS, { recursive: true });
  const out = join(RESULTS, `trace-${r.id}.csv`);
  writeFileSync(out, lines.join('\n'));
  console.log(`\n${r.file}  expected ${noteName(r.expected)}  attack ${res.region.a.toFixed(3)}s  release ${res.region.rel.toFixed(3)}s`);
  console.log(JSON.stringify(r, null, 1));
  console.log(`frames: ${out}`);
  process.exit(0);
}

table(rows, opt.by ?? 'instrument');

// Ranked by what the tuner can be blamed for: octave and harmonic errors, dropouts.
// A note 1-2 semitones off is the player or a label, not a detector error.
const blame = (r) => (r.octave + r.far + r.drop) / r.sus;
const worst = rows
  .filter((r) => r.sus > 20 && blame(r) > 0)
  .sort((a, b) => blame(b) - blame(a))
  .slice(0, Number(opt.worst ?? 15));
console.log('\nWorst takes (octave + far + dropout frames):');
for (const r of worst)
  console.log(`  take ${String(r.id).padEnd(6)} ok ${pct(r.correct, r.sus).toFixed(0).padStart(3)}%  want ${noteName(r.expected).padEnd(4)} shown ${noteName(r.shown).padEnd(4)} oct ${pct(r.octave, r.sus).toFixed(0).padStart(3)}%  far ${pct(r.far, r.sus).toFixed(0).padStart(3)}%  drop ${pct(r.drop, r.sus).toFixed(0).padStart(3)}%  ${r.klass ?? ''}  ${r.file}`);

mkdirSync(RESULTS, { recursive: true });
const name = opt.name ?? new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const outPath = join(RESULTS, name + '.json');
writeFileSync(outPath, JSON.stringify({ options: opt, offsets: Object.fromEntries(offsetOf), rows }));
console.log(`\nSaved ${outPath}  (compare: node tools/eval-tuner/run.mjs --compare ${name} OTHER)`);

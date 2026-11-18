// Worker: decodes one take and replays it through the bundled tuner (sim.ts).
import { parentPort, workerData } from 'node:worker_threads';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const { bundle, wasmPath, engine } = workerData;
const { simulate } = await import(pathToFileURL(bundle).href);
const wasm = engine === 'js' ? null : new WebAssembly.Module(readFileSync(wasmPath));

/** PCM 16/24/32 or float 32 WAV, channels averaged to mono. */
export function readWav(path) {
  const b = readFileSync(path);
  if (b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') throw new Error('not a WAV');
  let o = 12;
  let fmt = null;
  while (o + 8 <= b.length) {
    const id = b.toString('ascii', o, o + 4);
    const size = b.readUInt32LE(o + 4);
    const body = o + 8;
    if (id === 'fmt ') {
      let tag = b.readUInt16LE(body);
      if (tag === 0xfffe) tag = b.readUInt16LE(body + 24);
      fmt = { tag, ch: b.readUInt16LE(body + 2), sr: b.readUInt32LE(body + 4), bits: b.readUInt16LE(body + 14) };
    } else if (id === 'data') {
      if (!fmt) throw new Error('data before fmt');
      const { tag, ch, sr, bits } = fmt;
      const bytes = bits / 8;
      const end = Math.min(b.length, body + size);
      const frames = Math.floor((end - body) / (bytes * ch));
      const x = new Float32Array(frames);
      const read =
        tag === 3 && bits === 32 ? (p) => b.readFloatLE(p)
        : bits === 16 ? (p) => b.readInt16LE(p) / 32768
        : bits === 24 ? (p) => b.readIntLE(p, 3) / 8388608
        : bits === 32 ? (p) => b.readInt32LE(p) / 2147483648
        : null;
      if (!read) throw new Error(`unsupported WAV format ${tag}/${bits}`);
      for (let i = 0, p = body; i < frames; i++) {
        let s = 0;
        for (let c = 0; c < ch; c++, p += bytes) s += read(p);
        x[i] = s / ch;
      }
      return { x, sr };
    }
    o = body + size + (size & 1);
  }
  throw new Error('no data chunk');
}

/**
 * Splices `[path, fromSeconds, toSeconds]` segments into one legato line: each
 * brought to the same level, joined with a short crossfade.
 */
function splice(segments) {
  const parts = segments.map(([path, from, to]) => {
    const { x, sr } = readWav(path);
    const p = x.slice(Math.round(from * sr), Math.round(to * sr));
    let e = 0;
    for (const v of p) e += v * v;
    const g = 0.1 / Math.sqrt(e / p.length + 1e-12); // -20 dBFS
    for (let i = 0; i < p.length; i++) p[i] *= g;
    return { p, sr };
  });
  const sr = parts[0].sr;
  const fade = Math.round(0.01 * sr);
  const len = parts.reduce((a, { p }) => a + p.length, 0) - fade * (parts.length - 1);
  const x = new Float32Array(len);
  const joins = [];
  let at = 0;
  for (const [k, { p }] of parts.entries()) {
    if (k > 0) joins.push((at - fade / 2) / sr);
    for (let i = 0; i < p.length; i++) {
      const w = k > 0 && i < fade ? i / fade : 1;
      const o = k < parts.length - 1 && i >= p.length - fade ? (p.length - i) / fade : 1;
      x[at + i] += p[i] * w * o;
    }
    at += p.length - fade;
  }
  return { x, sr, joins };
}

parentPort.on('message', ({ id, path, segments, a4 }) => {
  try {
    const { x, sr, joins } = segments ? splice(segments) : { ...readWav(path), joins: [] };
    const tr = simulate(x, sr, wasm, a4);
    // Level envelope in dBFS, one value per ENV_STEP samples, for onset detection.
    const step = 240;
    const env = new Float32Array(Math.floor(x.length / step));
    for (let b = 0; b < env.length; b++) {
      let s = 0;
      for (let i = b * step; i < (b + 1) * step; i++) s += x[i] * x[i];
      env[b] = 10 * Math.log10(s / step + 1e-12);
    }
    const bufs = [tr.t, tr.raw, tr.note, tr.cents, tr.live, env].map((a) => a.buffer);
    parentPort.postMessage({ id, sr, len: x.length, joins, trace: tr, env, envStep: step }, bufs);
  } catch (err) {
    parentPort.postMessage({ id, error: String(err?.message ?? err) });
  }
});
parentPort.postMessage({ ready: true });

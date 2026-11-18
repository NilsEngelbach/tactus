# Developing Tactus

Back to the [README](../README.md).

## Setup

You need Node 20 or newer. Rust is only needed if you change the pitch detector.

```sh
git clone <this repository>
cd music-tools
npm install
npm run dev          # http://localhost:5173 with live reload
```

`localhost` counts as a secure address, so the microphone works in development.

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server with live reload (no service worker) |
| `npm run build` | Typecheck (`tsc --noEmit`) and production build into `dist/` |
| `npm run preview` | Serves `dist/` on http://localhost:4173, with the service worker |
| `npm run typecheck` | Typecheck only |
| `npm run build:wasm` | Rust tests, then builds `wasm/pitch` into `src/audio/pitch.wasm` |
| `npm run icons` | Re-renders `public/apple-touch-icon.png` and `public/pwa/*.png` from the authored SVG in `tools/make-icons.mjs` |

## Trying the installable, offline build

The dev server has no service worker. To test install, offline and updates:

```sh
npm run build
npm run preview      # http://localhost:4173
```

1. Open http://localhost:4173 and install it from the address bar.
2. Stop the preview server. The installed app keeps working, because everything is in the service worker's cache.
3. To see the update prompt: start `npm run preview` again, change something, then run `npm run build`. Bring the app back to the front (or wait for the hourly check) and the **Update ready · Reload** plate appears.

In DevTools → Application → Service workers you can unregister the worker and clear the cache to start fresh.

## Hosting your own copy

Serve `dist/` from any web server over **https**. Browsers only allow the microphone and service workers on secure origins.

`public/.htaccess` is copied into the build for Apache. It sets:
- a redirect from http to https;
- the `application/wasm` and `application/manifest+json` types;
- a content security policy (`'wasm-unsafe-eval'` is needed to compile the pitch detector) and `Permissions-Policy: microphone=(self)`;
- long, immutable caching for hashed files, while `index.html`, `sw.js` and the manifest always revalidate.

On other servers, set the same headers. The app also works when `.wasm` is served with a wrong type, because it compiles the module from bytes rather than streaming.

## How it works

```
src/audio/   metronome.worklet.ts (click renderer), pitch.worklet.ts (detector host),
             metronome.ts, tuner.ts (main-thread control), mpm.ts (TS fallback),
             engine.ts (shared AudioContext, wake lock), notes.ts (names,
             transposition, tempo terms), types.ts, pitch.wasm
src/ui/      pedal.ts (enclosure), knob.ts, switch.ts (footswitch, LEDs), entry.ts
             (type a value into a readout), icons.ts, tempo-pedal.ts, tuner-pedal.ts
src/         main.ts (board, header, keyboard, install/update), i18n.ts, store.ts
wasm/pitch/  Rust pitch detector with tests
public/      .htaccess, favicon, icons
tools/       build-wasm.mjs, make-icons.mjs
```

No UI framework: plain TypeScript building DOM through a small `h()` helper (`src/ui/dom.ts`). The app is about 20 KB of gzipped JavaScript, plus 13 KB for the pitch detector.

### Metronome

- `metronome.worklet.ts` runs in the audio thread. It synthesises the click sounds once (four voices, each in accent, normal and subdivision versions; the light-only voice renders nothing but still reports every tick) and places each click on its exact sample. The next click position is kept as a fractional frame count, so long runs never drift. Timers and the main thread play no part in the timing, so the click stays steady in a background tab or with the screen off.
- Tempo, beats, accents and subdivision changes take effect from the next click.
- For every click the worklet posts a tick with its AudioContext time. `metronome.ts` queues them and lights the beat when `getOutputTimestamp()` says that sample reaches the speaker, so the light matches what you hear rather than what was computed.
- While anything plays, a screen wake lock keeps the display on (`engine.ts`). On iOS the audio session is set to `playback`, so the click is audible with the silent switch on.

### Tuner

- `pitch.worklet.ts` fills a 4096-sample ring buffer from the microphone (echo cancellation, noise suppression and auto gain off) and analyses it every 1024 samples (2048 above 60 kHz). That is about 47 readings per second at 48 kHz.
- **Two bands** (`band.ts`): every window is analysed twice, as is and band-passed (two Butterworth high-pass sections at 150 Hz, one low-pass at 5 kHz, filtered as the samples stream in). Low notes need the full band. A quiet higher note drowns in hum and rumble, which keep the NSDF positive past the note's period, so the full band finds nothing or locks onto the hum. In the band-passed copy the same note reads at about 6 dB lower SNR, at a lower level.
- The detector is the **McLeod Pitch Method**: the normalised square difference function, with the autocorrelation computed through an FFT. It takes the first key maximum above 0.9 of the highest one, then refines it with parabolic interpolation. Range: 27 Hz to 4.5 kHz.
- The main thread (`tuner.ts`):
  - **Gate:** a band counts when its clarity is at least 0.86 and its level is above about −52 dBFS (full band) or −58 dBFS (band-passed, where hum and rumble no longer add to the level).
  - **Band choice** (`choosePitch`): the full band wins when the band-passed reading is the same note, or a harmonic of a note below 225 Hz, so low notes read as they did with one band. Otherwise the band-passed reading wins: when the full band found nothing, found something unrelated (mains hum), or, above 225 Hz, a less clear subharmonic. If the band-passed reading takes over while a low note fades, a harmonic of the note on display is folded back onto it.
  - **Settling:** takes the median of the last five readings and only changes note once the pitch is more than 0.62 semitones from the current one.
  - **Display:** smooths the cents and holds the last reading for 1.6 s after the note stops.
  - **In tune:** within ±3 cents.
- The reference tone is an oscillator with a few soft harmonics, so low notes stay audible on small speakers. It is chosen as written pitch and sounds transposed for B♭, E♭ and F instruments.

### The detector in Rust and WebAssembly

The page fetches and compiles `pitch.wasm`, then passes the compiled module to the worklet, which instantiates it. If that fails (an old browser, a strict policy), the worklet keeps the TypeScript port in `src/audio/mpm.ts`; both implement the same algorithm.

Measured in Chromium through the real worklet, with test tones:

| Signal | Error |
|---|---|
| Sawtooth B0 30.87 Hz (5-string bass) | −0.01 ct |
| Sawtooth E1 41.2 Hz | 0.01 ct |
| Sawtooth A2 110 Hz | 0.11 ct |
| Triangle G3 196 Hz | 0.00 ct |
| Sine A4 440 Hz and 12 ct flat | 0.00 ct |
| Square E6 1318.5 Hz | 1.01 ct |

The metronome rendered clicks with 0.00 samples deviation at 120 BPM and 0.64 samples (0.013 ms) at 97 BPM in eighths.

### Changing the detector

The built `.wasm` is committed, so a normal build needs no Rust.

```sh
rustup target add wasm32-unknown-unknown   # once
npm run build:wasm                         # cargo test, release build, copy to src/audio/pitch.wasm
```

The Rust tests (`wasm/pitch/src/lib.rs`) cover a sine at A4, a low E and a low B with harmonics, a weak fundamental, a high note, silence and a detuned tone. Keep `src/audio/mpm.ts` in step with the Rust code.

The module exports a plain C ABI (`tp_init`, `tp_detect`, `tp_clarity`, `tp_rms`). Each call takes a slot: 0 holds the full-band detector, 1 the band-passed one. Only `tp_init` allocates, and the worklet initialises both slots before it creates its `Float32Array` views, so memory growth cannot detach them.

### Offline and updates

`vite-plugin-pwa` (Workbox, `generateSW`) precaches the app shell, scripts, the `.wasm`, icons and the Latin font files. Registration uses `prompt` mode:

- The app asks for a new `sw.js` when opened, when it comes back to the front (at most every 30 minutes) and hourly while open. Installed apps are usually resumed rather than reloaded, so the last two matter.
- A new version installs in the background and waits. The header shows **Update ready · Reload**; on phones it replaces the install plate. Tapping it activates the new worker and reloads.
- Without a tap, the new version starts the next time all windows of the app are closed.

### Settings and languages

- Settings live in `localStorage` under `tactus:v1` (`src/store.ts`). Every read is validated and clamped, so old or broken data falls back to defaults, and a missing storage only means settings last for one visit.
- All copy is in `src/i18n.ts`, with English and German side by side. The language follows the device until someone flips the switch. German uses German note names (`src/audio/notes.ts`).

### Adding a tool

Every tool is a pedal. Build it with `pedalShell()` (`src/ui/pedal.ts`) from a display window, a control deck (`Knob`) and footswitches (`Footswitch`, `led()`), and give it its own enamel colour; mustard is reserved for the next one. Add a tab in `src/main.ts`. The visual rules (LED colours, units, chrome) are in [DESIGN.md](../DESIGN.md).

## Icons and font

- `npm run icons` renders the app icons from the SVG in `tools/make-icons.mjs`. `public/favicon.svg` is drawn by hand.
- The font is Archivo (SIL Open Font License), bundled through `@fontsource-variable/archivo` with its width axis.

# Tactus

A metronome and a chromatic tuner, built like a pedalboard. Each tool is an enamel stompbox with a display window, knobs and footswitches. Installs as an app, works offline, needs no account and sends nothing anywhere.

- **Tempo** (metronome): 30–300 BPM, 1–12 beats per bar, accent per beat (tap a light: accent, normal, silent), quarter/eighth/triplet/sixteenth subdivisions, three sounds, tap tempo. To set an exact tempo, tap the number in the display, double-tap the TEMPO knob, or just type digits on a keyboard. The clicks are rendered inside the audio thread on exact samples, so they stay steady with the screen off or the tab in the background.
- **Tuner**: chromatic, from low B on a 5-string bass (31 Hz) up, reference pitch A4 415–466 Hz (tap it in the display to type it), transposition for instruments in B♭, E♭ and F. Reference tone: pick a note from C1 to C6 with the NOTE knob (written pitch for transposing instruments) and step on REF; turning the knob while it sounds changes the note. The pitch detector is the McLeod Pitch Method in Rust, compiled to WebAssembly and run inside an AudioWorklet; a TypeScript port of the same algorithm is the fallback.
- English and German (follows the device; switch top right). German uses German note names (Cis, Es, B, H).
- Keyboard: Space start/stop, T tap, ↑/↓ tempo (Shift: ±10), digits type a tempo. Every knob is a slider for arrows, Page Up/Down, Home/End and the wheel; Enter on a knob with a display value opens entry.

## Develop

Node 20+. Rust only if you change the pitch detector.

```sh
npm install
npm run dev          # http://localhost:5173 (localhost counts as secure, so the mic works)
npm run build        # typecheck + production build into dist/
npm run preview      # serve dist/ on http://localhost:4173, with the service worker
npm run build:wasm   # cargo test + build wasm/pitch → src/audio/pitch.wasm (committed)
npm run icons        # re-render public/icons from the authored SVG
```

The `.wasm` is committed, so a build needs no Rust toolchain. To change it: `rustup target add wasm32-unknown-unknown` once, then `npm run build:wasm` (it runs the Rust tests first). Keep `src/audio/mpm.ts` in step with `wasm/pitch/src/lib.rs`.

## Hosting

Tactus is static files: serve `dist/` from any web server over **https** (browsers allow the microphone and the service worker only on a secure origin; `localhost` counts as one). `public/.htaccess` ships with the build for Apache: https redirect, the `application/wasm` type, a content security policy, and long caching for hashed assets while `index.html` and `sw.js` always revalidate.

### Updates

- The service worker asks the server for a new `sw.js` whenever the app is opened, whenever it comes back to the front (at most every 30 minutes; installed apps are usually resumed, not reloaded) and hourly while it stays open.
- A new version downloads in the background. The header then shows an amber **Update ready · Reload** plate (on phones: **Reload**, in place of the install plate).
- One tap switches to the new version. Nothing reloads by itself, so a running metronome is never cut off. Without a tap, the new version starts the next time the app is closed and opened again.

## Layout

```
src/audio/   metronome.worklet.ts (click renderer), pitch.worklet.ts (detector host),
             metronome.ts, tuner.ts (main-thread control), mpm.ts (TS fallback),
             notes.ts (names, transposition, tempo terms), pitch.wasm
src/ui/      pedal.ts (enclosure), knob.ts, switch.ts (footswitch, LEDs),
             tempo-pedal.ts, tuner-pedal.ts, icons.ts
src/         main.ts (board, header, keyboard, install/update), i18n.ts, store.ts
wasm/pitch/  Rust pitch detector with tests
public/      .htaccess, favicon, icons
```

Settings are stored in the browser (`localStorage`), per device.

## Docs

- [PRODUCT.md](PRODUCT.md): who it is for and why
- [DESIGN.md](DESIGN.md): the visual system

Font: Archivo (SIL Open Font License), bundled.

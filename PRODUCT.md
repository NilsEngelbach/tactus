# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Delegated: Vite + TypeScript with no UI framework (small bundle, fast cold start on a phone that is about to play). Audio runs in AudioWorklets: a sample-accurate click scheduler for the metronome and a pitch detector for the tuner. The pitch detector's DSP core is Rust compiled to WebAssembly (cargo is available), with a TypeScript fallback for browsers without WASM SIMD. A service worker precaches everything so the app installs and works fully offline. Hosting is static files over https; no server code or database is needed.

## Users

General musicians: anyone with an instrument and a phone or laptop, from beginners to band players. They open the tool in the middle of practice or right before playing, often with the instrument already in their hands, the phone on a music stand, chair or amp, one to two metres away.

## Product Purpose

A small, installable set of practice tools that works offline and starts instantly. The first two tools are a metronome and a chromatic tuner; more tools follow (the product is a toolbox, not a single utility). Success: a musician reaches for this instead of the ad-laden app or the browser search result, because it is faster to start, more precise, and nicer to look at.

## Positioning

A precision instrument, not an app store utility: no ads, no accounts, no tracking, no network after the first visit. The audio core is built for timing accuracy (scheduled ahead in the audio thread, never `setInterval`) and pitch stability (WASM DSP), and the interface is readable from a music stand.

## Operating Context

- The device sits on a stand or table at arm's length or further; hands are on the instrument. Readability at distance and large touch targets matter more than density.
- Practice rooms, stages and rehearsal halls: bright light and dim light. Some players practise late at night.
- Tuning happens with the microphone, in rooms that may have other sound. The metronome must cut through an instrument and stay steady when the screen is off or the tab is in the background.
- Sessions are short and repeated: open, tune, set a tempo, play, adjust tempo, play again.

## Capabilities and Constraints

- Metronome: tempo, meter and accents, subdivisions, tap tempo. Precise scheduling via the Web Audio clock.
- Tuner: chromatic, microphone input, adjustable reference pitch (A4, e.g. 440/442/443 Hz). Needs microphone permission; must explain why and work without network.
- Installable PWA, fully offline after first load. Settings persist locally on the device (no server-side storage).
- UI language: English and German, following the device language, with a manual switch.
- Deployed as static files on its own subdomain, served over https.
- Undecided: which tools come after metronome and tuner.

## Brand Commitments

The product name is to be proposed as part of this work; none exists yet.

## Evidence on Hand

None. No users, testimonials, benchmarks or accuracy claims exist; do not invent any. Accuracy figures may only be stated once measured.

## Product Principles

1. Instant: from tap to sound in under a second, offline, every time.
2. Readable from the stand: what matters is legible at two metres; everything else waits.
3. Exact before pretty, and then pretty: timing and pitch accuracy are never traded for effects.
4. Quiet tool: no accounts, ads, nags or tracking. Ask for the microphone only when the tuner needs it.
5. One toolbox: tools share one instrument-like language so new tools feel native on arrival.

## Accessibility & Inclusion

Large touch targets for use with an instrument in hand. Visual beat and pitch feedback must not rely on colour alone (deuteranopia is common; in-tune vs. flat/sharp must be readable by position and shape). Respect reduced motion while keeping the beat indicator usable. Keyboard control on desktop (space to start/stop, arrows for tempo).

// The Tuner pedal: chromatic tuner with reference tone.
import { TRANSPOSITIONS, midiToFreq, noteName, noteText, transpositionLabel, type NoteName, type TranspositionId } from '../audio/notes';
import { Tuner, type Reading, type TunerError } from '../audio/tuner';
import { lang, onLang, t } from '../i18n';
import type { Settings } from '../store';
import { h } from './dom';
import { valueEntry } from './entry';
import { arrowLeft, arrowRight, flatIcon, sharpIcon } from './icons';
import { Knob } from './knob';
import { pedalShell } from './pedal';
import { Footswitch, led } from './switch';

type TunerSettings = Settings['tuner'];
const IN_TUNE = 3; // cents
const SEGMENTS = 21; // -50 … +50 in 5-cent steps

/** A note set like the window prints it: letter, drawn accidental, octave. */
function noteNode(n: NoteName, withOctave = true): DocumentFragment {
  const f = document.createDocumentFragment();
  f.append(n.base);
  if (n.acc) f.append(h('span', { class: 'acc' }, n.acc === 'sharp' ? sharpIcon() : flatIcon()));
  if (withOctave) f.append(h('sub', { class: 'octave' }, String(n.octave)));
  return f;
}

export interface TunerPedal {
  el: HTMLElement;
  tuner: Tuner;
  toggle(): void;
}

export function tunerPedal(initial: TunerSettings, persist: (s: TunerSettings) => void): TunerPedal {
  let cfg = { ...initial };
  const tuner = new Tuner();
  tuner.a4 = cfg.a4;
  let reading: Reading | null = null;

  // ── Display window ────────────────────────────────────────────────────────
  const a4Text = h('span', { class: 'readout-small' });
  const a4Button = h('button', { type: 'button', class: 'readout-button' }, a4Text);
  const setA4 = (v: number) => {
    cfg = { ...cfg, a4: v };
    tuner.a4 = v;
    tuner.retuneReference();
    calibKnob.set(v);
    persist(cfg);
    render();
  };
  const a4Entry = valueEntry({ readout: a4Button, value: () => cfg.a4, min: 415, max: 466, label: () => t.a4Entry, onCommit: setA4 });
  a4Button.addEventListener('click', () => a4Entry.open());
  const keyText = h('span', { class: 'readout-small tuner-key' });
  const flatArrow = h('span', { class: 'tuner-arrow tuner-arrow--flat' }, arrowRight());
  const sharpArrow = h('span', { class: 'tuner-arrow tuner-arrow--sharp' }, arrowLeft());
  const noteEl = h('span', { class: 'readout-big tuner-note' });
  const segs = Array.from({ length: SEGMENTS }, (_, i) =>
    h('span', { class: 'seg' + (i === (SEGMENTS - 1) / 2 ? ' seg--centre' : '') }),
  );
  const meter = h('div', { class: 'tuner-meter', 'aria-hidden': 'true' }, ...segs);
  const centsText = h('span', { class: 'readout-small tuner-cents' });
  const freqText = h('span', { class: 'readout-small tuner-freq' });
  const status = h('span', { class: 'silk-window tuner-status' });
  const message = h('div', { class: 'window-message' });
  const live = h('p', { class: 'sr-only', 'aria-live': 'polite' });

  const window_ = h(
    'div',
    { class: 'window tuner-window' },
    h('div', { class: 'window-top' }, a4Button, keyText),
    h('div', { class: 'tuner-main', 'aria-hidden': 'true' }, flatArrow, noteEl, sharpArrow),
    meter,
    h('div', { class: 'window-bottom', 'aria-hidden': 'true' }, centsText, status, freqText),
    message,
    live,
  );

  // ── Knobs ─────────────────────────────────────────────────────────────────
  const calibKnob = new Knob({
    kind: 'knurled',
    size: 'small',
    label: () => t.calib,
    ariaLabel: () => t.calibLabel,
    min: 415,
    max: 466,
    step: 1,
    value: cfg.a4,
    marks: [
      { value: 415, text: '415' },
      { value: 440, text: '440' },
      { value: 466, text: '466' },
    ],
    valueText: (v) => `${v} Hz`,
    onInput: setA4,
    onEntry: () => a4Entry.open(),
  });
  const keyKnob = new Knob({
    kind: 'chicken',
    size: 'small',
    label: () => t.transpose,
    ariaLabel: () => t.transposeLabel,
    min: 0,
    max: 3,
    step: 1,
    value: TRANSPOSITIONS.findIndex((x) => x.id === cfg.transpose),
    stops: TRANSPOSITIONS.map((x, i) => ({
      value: i,
      mark: () => noteNode(transpositionLabel(x.id, lang), false),
      text: () => t.instrumentIn(noteText(transpositionLabel(x.id, lang))),
    })),
    valueText: (v) => t.instrumentIn(noteText(transpositionLabel(TRANSPOSITIONS[v].id, lang))),
    onInput: (v) => {
      cfg = { ...cfg, transpose: TRANSPOSITIONS[v].id as TranspositionId };
      persist(cfg);
      tuner.setReference(refSounding());
      render();
    },
  });

  // The reference tone, chosen as written pitch; it sounds `shift` semitones lower.
  const shiftOf = () => TRANSPOSITIONS.find((x) => x.id === cfg.transpose)!.shift;
  const refSounding = () => cfg.refNote - shiftOf();
  const refName = (m: number) => noteText(noteName(m, lang)) + (noteName(m, lang).octave);
  const refKnob = new Knob({
    kind: 'knurled',
    size: 'small',
    label: () => t.refNote,
    ariaLabel: () => t.refNoteLabel,
    min: 24,
    max: 84,
    step: 1,
    value: cfg.refNote,
    marks: [24, 36, 48, 60, 72, 84].map((m) => ({ value: m, text: `C${m / 12 - 1}` })),
    valueText: (v) => refName(v),
    onInput: (v) => {
      cfg = { ...cfg, refNote: v };
      persist(cfg);
      tuner.setReference(refSounding());
      render();
    },
  });

  // ── Footswitches ──────────────────────────────────────────────────────────
  const onLed = led('red', 'switch-led');
  const refLed = led('red', 'switch-led');
  const toggle = () => void tuner.toggle();
  const refSwitch = new Footswitch({
    label: () => t.ref,
    ariaLabel: () => (tuner.referenceNote !== null ? t.refStop : t.refLabel),
    onPress: () => void tuner.toggleReference(refSounding()),
    toggle: true,
  });
  const onSwitch = new Footswitch({
    label: () => t.on,
    ariaLabel: () => (tuner.state === 'listening' ? t.listenStop : t.listenStart),
    onPress: toggle,
    toggle: true,
  });

  const shell = pedalShell({
    id: 'tuner',
    name: () => t.tuner,
    model: 'TT-1',
    ariaLabel: () => t.tunerPedal,
    window: window_,
    controls: h('div', { class: 'controls controls--tuner' }, calibKnob.el, keyKnob.el, refKnob.el),
    switches: [h('div', { class: 'switch-col' }, refLed, refSwitch.el), h('div', { class: 'switch-col' }, onLed, onSwitch.el)],
  });

  const errorText = (e: TunerError | null) =>
    ({
      denied: t.errDenied,
      'no-mic': t.errNoMic,
      insecure: t.errInsecure,
      unsupported: t.errUnsupported,
      failed: t.errFailed,
    })[e ?? 'failed'];

  let spoken = '';
  function render() {
    const shift = TRANSPOSITIONS.find((x) => x.id === cfg.transpose)!.shift;
    a4Text.textContent = `A4 ${cfg.a4} Hz`;
    a4Button.setAttribute('aria-label', `A4 ${cfg.a4} Hz. ${t.a4Entry}`);
    keyText.replaceChildren();
    if (shift) keyText.append(t.transpose.replace('.', '') + ' ', noteNode(transpositionLabel(cfg.transpose, lang), false));

    const state = tuner.state;
    window_.dataset.state = state;
    window_.classList.toggle('is-ref', tuner.referenceNote !== null);
    onLed.classList.toggle('is-on', state === 'listening');
    onSwitch.setPressed(state === 'listening' || state === 'starting');
    shell.el.classList.toggle('is-running', state === 'listening');

    // Message layer: idle, starting, errors.
    message.replaceChildren();
    if (state === 'off') message.append(h('p', {}, t.tunerIdle), h('p', { class: 'window-hint' }, t.tunerPrivacy));
    else if (state === 'starting') message.append(h('p', {}, t.tunerStarting));
    else if (state === 'error') message.append(h('p', { class: 'window-error' }, errorText(tuner.error)));

    const r = reading;
    window_.classList.toggle('has-reading', !!r);
    window_.classList.toggle('is-held', !!r && !r.live);
    noteEl.replaceChildren();
    let tuneState: 'flat' | 'sharp' | 'in' | null = null;
    let lit = -1;
    if (r) {
      noteEl.append(noteNode(noteName(r.note + shift, lang)));
      const c = r.cents;
      tuneState = Math.abs(c) <= IN_TUNE ? 'in' : c < 0 ? 'flat' : 'sharp';
      lit = Math.round(c / 5) + (SEGMENTS - 1) / 2;
      const rc = Math.round(c);
      centsText.textContent = `${rc > 0 ? '+' : rc < 0 ? '−' : '±'}${Math.abs(rc)} ${t.cents}`;
      freqText.textContent = `${r.freq.toFixed(1)} Hz`;
      status.textContent = tuneState === 'in' ? t.inTune : tuneState === 'flat' ? t.flat : t.sharp;
    } else if (tuner.referenceNote !== null) {
      // Nothing heard, the reference tone sounds: show what is playing.
      noteEl.append(noteNode(noteName(tuner.referenceNote + shift, lang)));
      centsText.textContent = '';
      freqText.textContent = `${midiToFreq(tuner.referenceNote, cfg.a4).toFixed(1)} Hz`;
      status.textContent = t.refPlaying;
    } else {
      noteEl.append(h('span', { class: 'tuner-dash' }, '–'));
      centsText.textContent = `– ${t.cents}`;
      freqText.textContent = '–.– Hz';
      status.textContent = state === 'listening' ? t.tunerListening : '';
    }
    window_.dataset.tune = tuneState ?? '';
    segs.forEach((s, i) => {
      const on = tuneState === 'in' ? Math.abs(i - (SEGMENTS - 1) / 2) <= 1 : i === lit;
      s.classList.toggle('is-on', on);
    });
    flatArrow.classList.toggle('is-on', tuneState === 'flat');
    sharpArrow.classList.toggle('is-on', tuneState === 'sharp');

    // Speak only note and tuned-state changes, never the moving cents.
    const say = r && r.live ? `${noteText(noteName(r.note + shift, lang))}, ${status.textContent}` : '';
    if (say !== spoken) {
      spoken = say;
      live.textContent = say;
    }
  }

  tuner.onReading((r) => {
    reading = r;
    render();
  });
  tuner.onState(() => render());
  tuner.onReference((midi) => {
    refLed.classList.toggle('is-on', midi !== null);
    refSwitch.setPressed(midi !== null);
    render();
  });
  onLang(() => {
    calibKnob.relabel();
    keyKnob.relabel();
    refKnob.relabel();
    refSwitch.relabel();
    onSwitch.relabel();
    shell.relabel();
    render();
  });
  render();

  return { el: shell.el, tuner, toggle };
}

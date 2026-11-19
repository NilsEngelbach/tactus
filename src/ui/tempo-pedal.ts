// The Tempo pedal: the metronome.
import { Metronome, TapTempo } from '../audio/metronome';
import { tempoTerm } from '../audio/notes';
import type { Accent, TempoConfig } from '../audio/types';
import { onLang, t } from '../i18n';
import { accentsFor, type TempoSettings } from '../store';
import { h } from './dom';
import { valueEntry } from './entry';
import { rhythmIcon, voiceIcon, warningIcon } from './icons';
import { Knob } from './knob';
import { pedalShell } from './pedal';
import { Footswitch, flash, led } from './switch';
import { TempoPendulum } from './tempo-pendulum';

export interface TempoPedal {
  el: HTMLElement;
  metronome: Metronome;
  toggle(): void;
  tap(): void;
  nudge(delta: number): void;
  /** Opens tempo entry, optionally starting with a typed digit. */
  enter(first?: string): void;
}

/** The voice that flashes the display instead of sounding. */
const LIGHT_ONLY = 4;
/** 3 flashes a second. */
const SAFE_FLASH_BPM = 180;
/** With Reduce Motion on, the display does not flash above SAFE_FLASH_BPM. */
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

/** The Subdiv knob's stops, in order: each shuffle follows its plain rhythm. */
const RHYTHMS: { subdiv: TempoConfig['subdiv']; shuffle: boolean }[] = [
  { subdiv: 1, shuffle: false },
  { subdiv: 2, shuffle: false },
  { subdiv: 2, shuffle: true }, // dotted shuffle
  { subdiv: 3, shuffle: false },
  { subdiv: 3, shuffle: true }, // triplet shuffle
  { subdiv: 4, shuffle: false },
];
const rhythmOf = (c: TempoConfig) =>
  RHYTHMS.findIndex((r) => r.subdiv === c.subdiv && r.shuffle === (c.shuffle && (c.subdiv === 2 || c.subdiv === 3)));

export function tempoPedal(initial: TempoSettings, persist: (c: TempoSettings) => void): TempoPedal {
  let cfg: TempoSettings = { ...initial, accents: [...initial.accents] };
  const metronome = new Metronome(cfg);
  const tapper = new TapTempo();

  const update = (patch: Partial<TempoSettings>) => {
    cfg = { ...cfg, ...patch };
    if (patch.beats !== undefined) cfg.accents = accentsFor(cfg.beats, cfg.accents);
    metronome.configure(cfg);
    persist(cfg);
    render();
  };

  // ── Display window ────────────────────────────────────────────────────────
  const bpmDigits = h('span', { class: 'readout-big tempo-bpm' });
  // The number itself is the way in: tap it and type a tempo.
  const bpmButton = h('button', { type: 'button', class: 'readout-button' }, bpmDigits);
  const entry = valueEntry({
    readout: bpmButton,
    value: () => cfg.bpm,
    min: 30,
    max: 300,
    label: () => t.tempoEntry,
    onCommit: (v) => update({ bpm: v }),
  });
  bpmButton.addEventListener('click', () => entry.open());
  const bpmUnit = h('span', { class: 'silk-window' });
  const term = h('span', { class: 'readout-small' });
  const meterText = h('span', { class: 'readout-small tempo-meter' });
  const subdivGlyph = h('span', { class: 'window-glyph' });
  const beatRow = h('div', { class: 'beat-row' });
  const hint = h('p', { class: 'window-hint' });
  const live = h('p', { class: 'sr-only', 'aria-live': 'polite' });

  // Pendulum view: an arm that swings to each beat, between tempo and lights.
  const pendulum = new TempoPendulum(
    () => metronome.now(),
    () => 60 / cfg.bpm,
  );
  const pendulumText = h('span', {});
  const pendulumButton = h(
    'button',
    { type: 'button', class: 'window-toggle silk-window' },
    h('span', { class: 'window-toggle-led' }),
    pendulumText,
  );
  pendulumButton.addEventListener('click', () => update({ pendulum: !cfg.pendulum }));

  let beatEls: HTMLButtonElement[] = [];
  const buildBeats = () => {
    beatRow.replaceChildren();
    beatRow.style.setProperty('--n', String(cfg.beats));
    beatEls = cfg.accents.map((_, i) => {
      const b = h(
        'button',
        {
          type: 'button',
          class: 'beat',
          onclick: () => {
            const next = ((cfg.accents[i] + 2) % 3) as Accent; // accent → normal → silent → accent
            const accents = [...cfg.accents];
            accents[i] = next;
            update({ accents });
          },
        },
        led('amber', 'beat-led'),
      );
      return b;
    });
    beatRow.append(...beatEls);
  };

  const window_ = h(
    'div',
    { class: 'window tempo-window' },
    h(
      'div',
      { class: 'window-top tempo-top' },
      h('span', { class: 'tempo-rhythm' }, meterText, subdivGlyph),
      term,
      pendulumButton,
    ),
    h('div', { class: 'window-main' }, bpmButton, h('span', { 'aria-hidden': 'true' }, bpmUnit)),
    pendulum.el,
    beatRow,
    hint,
    live,
  );

  // ── Knobs ─────────────────────────────────────────────────────────────────
  const tempoKnob = new Knob({
    kind: 'knurled',
    size: 'big',
    label: () => t.tempo,
    ariaLabel: () => `${t.tempo} (${t.bpm})`,
    min: 30,
    max: 300,
    step: 1,
    value: cfg.bpm,
    sweep: 300,
    marks: [30, 60, 90, 120, 150, 180, 210, 240, 270, 300].map((v) => ({ value: v, text: String(v) })),
    valueText: (v) => `${v} ${t.bpm}, ${tempoTerm(v)}`,
    onInput: (v) => update({ bpm: v }),
    onEntry: () => entry.open(),
  });
  const beatsKnob = new Knob({
    kind: 'chicken',
    size: 'small',
    label: () => t.beats,
    ariaLabel: () => t.beats,
    min: 1,
    max: 12,
    step: 1,
    value: cfg.beats,
    sweep: 300,
    stops: Array.from({ length: 12 }, (_, i) => ({
      value: i + 1,
      mark: () => String(i + 1),
      text: () => t.beatsPerBar(i + 1),
    })),
    valueText: (v) => t.beatsPerBar(v),
    onInput: (v) => update({ beats: v }),
  });
  const subdivKnob = new Knob({
    kind: 'chicken',
    size: 'small',
    label: () => t.subdiv,
    ariaLabel: () => t.subdiv,
    min: 0,
    max: RHYTHMS.length - 1,
    step: 1,
    // narrower than the 300° six stops would get by default: room at the bottom
    sweep: 250,
    value: rhythmOf(cfg),
    stops: RHYTHMS.map((_, i) => ({ value: i, mark: () => rhythmIcon[i](), text: () => t.subdivNames[i] })),
    valueText: (v) => t.subdivNames[v],
    onInput: (v) => update(RHYTHMS[v]),
  });
  const voiceKnob = new Knob({
    kind: 'chicken',
    size: 'small',
    label: () => t.voice,
    ariaLabel: () => t.voice,
    min: 0,
    max: 2,
    step: 1,
    value: cfg.voice,
    stops: [0, 1, 2, 3, 4].map((v) => ({ value: v, mark: () => voiceIcon[v](), text: () => t.voices[v] })),
    valueText: (v) => t.voices[v],
    onInput: (v) => update({ voice: v as TempoConfig['voice'] }),
  });
  const levelKnob = new Knob({
    kind: 'knurled',
    size: 'small',
    label: () => t.level,
    ariaLabel: () => t.level,
    min: 0,
    max: 1,
    step: 0.05,
    value: cfg.level,
    marks: [
      { value: 0, text: '0' },
      { value: 1, text: '10' },
    ],
    valueText: (v) => `${Math.round(v * 100)} %`,
    onInput: (v) => update({ level: v }),
  });

  // ── Footswitches ──────────────────────────────────────────────────────────
  const onLed = led('red', 'switch-led');
  const tapLed = led('amber', 'switch-led');
  const tap = () => {
    const bpm = tapper.tap();
    flash(tapLed);
    if (bpm) update({ bpm: Math.round(Math.min(300, Math.max(30, bpm))) });
    restIdle();
  };
  const toggle = () => {
    metronome.toggle().catch(() => {
      /* audio could not start; the switch falls back to off */
    });
  };
  const tapSwitch = new Footswitch({ label: () => t.tap, ariaLabel: () => t.tapTempo, onPress: tap });
  const onSwitch = new Footswitch({
    label: () => t.on,
    ariaLabel: () => (metronome.running ? t.stop : t.start),
    onPress: toggle,
    toggle: true,
  });

  const shell = pedalShell({
    id: 'tempo',
    name: () => t.tempo,
    model: 'TM-1',
    ariaLabel: () => t.tempoPedal,
    window: window_,
    controls: h(
      'div',
      { class: 'controls controls--tempo' },
      h('div', { class: 'controls-main' }, tempoKnob.el),
      h('div', { class: 'controls-side' }, beatsKnob.el, subdivKnob.el, voiceKnob.el, levelKnob.el),
    ),
    switches: [
      h('div', { class: 'switch-col' }, tapLed, tapSwitch.el),
      h('div', { class: 'switch-col' }, onLed, onSwitch.el),
    ],
  });

  // Light-only voice: the display lights up on each sounding beat, like a
  // backlight. Beats only, never subdivisions: a large surface flashing fast is
  // hard on the eyes (and a risk for photosensitive players); the beat LEDs
  // still show them.
  const displayFlash = h('span', { class: 'window-flash', 'aria-hidden': 'true' });
  window_.prepend(displayFlash);

  // ── Beat lights from the audio clock ─────────────────────────────────────
  let lastBeat = -1;
  metronome.onBeat((ev) => {
    const el = beatEls[ev.beat];
    if (!el) return;
    const l = el.firstElementChild as HTMLElement;
    const flashOff = reducedMotion.matches && cfg.bpm > SAFE_FLASH_BPM;
    if (ev.sub === 0 && cfg.voice === LIGHT_ONLY && ev.accent !== 0 && !flashOff) {
      flash(displayFlash, ev.accent === 2 ? 'is-flash-accent' : 'is-flash');
    }
    if (ev.sub === 0) {
      pendulum.beat(ev.time, ev.accent);
      beatEls.forEach((b) => b.classList.remove('is-current'));
      el.classList.add('is-current');
      flash(l, 'is-flash');
      flash(tapLed);
      lastBeat = ev.beat;
    } else if (ev.beat === lastBeat) {
      flash(l, 'is-flash-sub');
    }
  });
  metronome.onState((running) => {
    pendulum.setRunning(running);
    onLed.classList.toggle('is-on', running);
    onSwitch.setPressed(running);
    shell.el.classList.toggle('is-running', running);
    if (!running) beatEls.forEach((b) => b.classList.remove('is-current'));
    live.textContent = running ? `${cfg.bpm} ${t.bpm}` : '';
  });

  // While stopped, the TAP light blinks the set tempo, like a delay pedal.
  // Each blink schedules the next one, so a tempo change only changes the gap
  // that follows (no extra or skipped blink), and a tap restarts the rhythm
  // from itself instead of blinking in between the taps.
  let idleNext = 0;
  const restIdle = () => {
    idleNext = performance.now() + 60000 / cfg.bpm;
  };
  const idle = (now: number) => {
    if (metronome.running || document.hidden) {
      idleNext = 0;
    } else if (!idleNext) {
      restIdle();
    } else if (now >= idleNext) {
      flash(tapLed, 'is-flash-dim');
      idleNext += 60000 / cfg.bpm;
      if (idleNext < now) restIdle(); // after a stall, no catch-up burst
    }
    requestAnimationFrame(idle);
  };
  requestAnimationFrame(idle);

  function render() {
    bpmDigits.textContent = String(cfg.bpm);
    bpmButton.setAttribute('aria-label', `${cfg.bpm} ${t.bpm}. ${t.tempoEntry}`);
    bpmUnit.textContent = t.bpm;
    term.textContent = tempoTerm(cfg.bpm);
    meterText.textContent = `${t.beats} ${cfg.beats}`;
    const rhythm = rhythmOf(cfg);
    subdivGlyph.replaceChildren(rhythmIcon[rhythm]());
    subdivGlyph.setAttribute('title', t.subdivNames[rhythm]);
    window_.classList.toggle('is-pendulum', cfg.pendulum);
    pendulumText.textContent = t.pendulum;
    pendulumButton.setAttribute('aria-pressed', String(cfg.pendulum));
    pendulumButton.setAttribute('aria-label', t.pendulumLabel);
    pendulum.show(cfg.pendulum);
    pendulum.setTempo(cfg.bpm);
    // More than 3 flashes a second is the photosensitive-epilepsy limit
    // (WCAG 2.3.1); the light-only voice flashes the whole display once a beat.
    // With Reduce Motion on, the flash is off up there instead, and the line says so.
    const fastFlash = cfg.voice === LIGHT_ONLY && cfg.bpm > SAFE_FLASH_BPM;
    hint.classList.toggle('is-warning', fastFlash);
    if (fastFlash)
      hint.replaceChildren(warningIcon(), h('span', {}, reducedMotion.matches ? t.flashOffReduced : t.flashWarning));
    else hint.textContent = t.accentHint;
    if (beatEls.length !== cfg.beats) buildBeats();
    beatEls.forEach((b, i) => {
      const a = cfg.accents[i];
      b.dataset.accent = String(a);
      b.setAttribute('aria-label', t.beatLabel(i + 1, t.accents[a]));
    });
    tempoKnob.set(cfg.bpm);
    beatsKnob.set(cfg.beats);
    subdivKnob.set(rhythm);
    voiceKnob.set(cfg.voice);
    levelKnob.set(cfg.level);
  }

  reducedMotion.addEventListener('change', () => render());
  onLang(() => {
    [tempoKnob, beatsKnob, subdivKnob, voiceKnob, levelKnob].forEach((k) => k.relabel());
    tapSwitch.relabel();
    onSwitch.relabel();
    shell.relabel();
    render();
  });
  buildBeats();
  render();

  return {
    el: shell.el,
    metronome,
    toggle,
    tap,
    enter: (first) => entry.open(first),
    nudge: (d) => {
      update({ bpm: Math.min(300, Math.max(30, cfg.bpm + d)) });
      restIdle();
    },
  };
}

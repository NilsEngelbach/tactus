// The enclosure every tool is built in: enamel box, side jacks, silkscreen
// head, display window, control deck and footswitch row.
import { h } from './dom';

export interface PedalParts {
  id: string;
  name: () => string;
  model: string;
  ariaLabel: () => string;
  window: HTMLElement;
  controls: HTMLElement;
  switches: HTMLElement[];
}

export function pedalShell(p: PedalParts) {
  const nameEl = h('h2', { class: 'pedal-name', id: `pedal-${p.id}-name` });
  const el = h(
    'section',
    { class: `pedal pedal--${p.id}`, id: `pedal-${p.id}`, 'aria-labelledby': `pedal-${p.id}-name` },
    h('span', { class: 'jack jack--in', 'aria-hidden': 'true' }),
    h('span', { class: 'jack jack--out', 'aria-hidden': 'true' }),
    h(
      'div',
      { class: 'pedal-face' },
      h('header', { class: 'pedal-head' }, nameEl, h('span', { class: 'silk pedal-model', 'aria-hidden': 'true' }, `Tactus ${p.model}`)),
      p.window,
      p.controls,
      h('div', { class: 'switch-row' }, ...p.switches),
    ),
  );
  const relabel = () => {
    nameEl.textContent = p.name();
    nameEl.setAttribute('aria-label', p.ariaLabel());
  };
  relabel();
  return { el, relabel };
}

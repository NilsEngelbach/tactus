import { h, svg } from './dom';

// Polished chrome: a hard horizon line in the reflection (bright sky above, dark
// ground below, a lighter band near the bottom) and one sharp specular highlight.
// The gradients live once in the document and every switch references them.
let defsReady = false;
function chromeDefs() {
  if (defsReady) return;
  defsReady = true;
  document.body.append(
    svg(`<svg width="0" height="0" style="position:absolute" aria-hidden="true" focusable="false"><defs>
      <linearGradient id="chrome-nut" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#fbfbfc"/><stop offset=".36" stop-color="#c7cacd"/>
        <stop offset=".37" stop-color="#585c61"/><stop offset=".62" stop-color="#8d9196"/>
        <stop offset=".86" stop-color="#d9dcdf"/><stop offset="1" stop-color="#7a7e83"/>
      </linearGradient>
      <linearGradient id="chrome-ring" x1="0" y1="1" x2="0" y2="0">
        <stop offset="0" stop-color="#f4f5f6"/><stop offset=".4" stop-color="#b3b7bb"/>
        <stop offset=".41" stop-color="#4e5257"/><stop offset="1" stop-color="#9ea2a7"/>
      </linearGradient>
      <linearGradient id="chrome-dome" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#ffffff"/><stop offset=".40" stop-color="#d8dbde"/>
        <stop offset=".44" stop-color="#3f4348"/><stop offset=".66" stop-color="#6f7479"/>
        <stop offset=".9" stop-color="#cfd3d6"/><stop offset="1" stop-color="#8a8e93"/>
      </linearGradient>
      <radialGradient id="chrome-spec" cx=".5" cy=".5" r=".5">
        <stop offset="0" stop-color="#fff"/><stop offset=".55" stop-color="#fff" stop-opacity=".85"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="chrome-edge" cx=".5" cy=".5" r=".5">
        <stop offset=".78" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".45"/>
      </radialGradient>
    </defs></svg>`),
  );
}

const FOOTSWITCH = `<svg class="footswitch-art" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
  <polygon points="26,6 74,6 99,50 74,94 26,94 1,50" fill="#1b1c1e" transform="translate(0 3)" opacity=".55"/>
  <polygon points="26,6 74,6 99,50 74,94 26,94 1,50" fill="url(#chrome-nut)"/>
  <polygon points="26,6 74,6 99,50 74,94 26,94 1,50" fill="none" stroke="#2b2e31" stroke-width="1.2"/>
  <path d="M26 6 50 50 74 6M99 50H50M74 94 50 50 26 94M1 50h49" stroke="#000" stroke-opacity=".12" stroke-width="1"/>
  <circle cx="50" cy="50" r="35" fill="url(#chrome-ring)" stroke="#2b2e31" stroke-width="1"/>
  <g class="footswitch-cap">
    <circle cx="50" cy="53" r="27" fill="#000" opacity=".45"/>
    <circle cx="50" cy="50" r="27" fill="url(#chrome-dome)"/>
    <circle cx="50" cy="50" r="27" fill="url(#chrome-edge)"/>
    <ellipse cx="40" cy="34" rx="7.5" ry="4.2" fill="url(#chrome-spec)" transform="rotate(-24 40 34)"/>
    <circle cx="50" cy="50" r="27" fill="none" stroke="#25282b" stroke-width="1.2"/>
  </g>
</svg>`;

export type LedColor = 'red' | 'amber' | 'green';

export function led(color: LedColor, extra = ''): HTMLElement {
  return h('span', { class: `led led--${color} ${extra}`.trim(), 'aria-hidden': 'true' });
}

/** Lights an LED briefly; restarting the class restarts the flash. */
export function flash(el: HTMLElement, cls = 'is-flash') {
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
}

export interface FootswitchOptions {
  label: () => string;
  ariaLabel: () => string;
  /** Fires on press, not release: a stomp acts the moment it lands. */
  onPress: () => void;
  toggle?: boolean;
}

/** A chrome stomp switch. The whole zone around it is the hit area. */
export class Footswitch {
  readonly el: HTMLElement;
  readonly button: HTMLButtonElement;
  private readonly labelEl: HTMLElement;

  constructor(private o: FootswitchOptions) {
    this.labelEl = h('span', { class: 'silk footswitch-label' });
    chromeDefs();
    this.button = h('button', { type: 'button', class: 'footswitch' }, svg(FOOTSWITCH));
    if (o.toggle) this.button.setAttribute('aria-pressed', 'false');
    this.el = h('div', { class: 'footswitch-zone' }, this.button, this.labelEl);

    // Press on pointerdown for instant response (tap tempo needs it). Clicks that
    // follow a pointer press are ignored; any other click (keyboard, screen
    // reader) presses the switch.
    let lastPointer = -Infinity;
    this.button.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      lastPointer = performance.now();
      this.button.classList.add('is-down');
      this.o.onPress();
    });
    const up = () => this.button.classList.remove('is-down');
    this.button.addEventListener('pointerup', up);
    this.button.addEventListener('pointerleave', up);
    this.button.addEventListener('pointercancel', up);
    this.button.addEventListener('click', () => {
      if (performance.now() - lastPointer < 1500) return;
      this.button.classList.add('is-down');
      setTimeout(up, 120);
      this.o.onPress();
    });
    // Hits around the switch count too, up to the zone edge.
    this.el.addEventListener('pointerdown', (e) => {
      if (e.target === this.el || e.target === this.labelEl) {
        this.button.dispatchEvent(new PointerEvent('pointerdown', e));
        this.button.focus({ preventScroll: true });
      }
    });
    this.el.addEventListener('pointerup', up);
    this.relabel();
  }

  setPressed(on: boolean) {
    if (this.o.toggle) this.button.setAttribute('aria-pressed', String(on));
    this.relabel();
  }

  relabel() {
    this.labelEl.textContent = this.o.label();
    this.button.setAttribute('aria-label', this.o.ariaLabel());
  }
}

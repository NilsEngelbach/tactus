// A rotary control: knurled knob (continuous) or chicken-head selector (stops).
// Turn it by dragging around it (the pointer follows your finger), drag up/down
// from its centre, use the wheel or the keyboard, or tap a printed stop label.
import { h } from './dom';

export interface KnobStop {
  value: number;
  /** What is printed around the knob at this stop. */
  mark: () => Node | string;
  /** Spoken value. */
  text: () => string;
}

export interface KnobOptions {
  kind: 'knurled' | 'chicken';
  size: 'big' | 'small';
  label: () => string;
  ariaLabel: () => string;
  min: number;
  max: number;
  step: number;
  value: number;
  /** Selector stops; the knob snaps to these and prints them around itself. */
  stops?: KnobStop[];
  /** Printed scale for continuous knobs. */
  marks?: { value: number; text: string }[];
  /** Sweep in degrees, centred on 12 o'clock. */
  sweep?: number;
  valueText: (v: number) => string;
  onInput: (v: number) => void;
  /** Double tap / double click: type a value instead of turning. */
  onEntry?: () => void;
}

export class Knob {
  readonly el: HTMLElement;
  value: number;
  private readonly cap: HTMLElement;
  private readonly labelEl: HTMLElement;
  private readonly sweep: number;
  private readonly scale: HTMLElement;
  private stopEls: HTMLElement[] = [];

  constructor(private o: KnobOptions) {
    this.value = o.value;
    this.sweep = o.sweep ?? (o.stops ? Math.min(300, 60 * (o.stops.length - 1)) : 280);
    this.cap = h('div', { class: 'knob-cap' }, h('span', { class: 'knob-pointer' }));
    const dial = h(
      'div',
      {
        class: 'knob-dial',
        role: 'slider',
        tabindex: '0',
        'aria-valuemin': String(o.stops ? 0 : o.min),
        'aria-valuemax': String(o.stops ? o.stops.length - 1 : o.max),
      },
      this.cap,
      h('span', { class: 'knob-shine', 'aria-hidden': 'true' }),
    );
    this.scale = h('div', { class: 'knob-scale', 'aria-hidden': 'true' });
    this.labelEl = h('span', { class: 'silk knob-label' });
    this.el = h(
      'div',
      { class: `knob knob--${o.kind} knob--${o.size}` },
      h('div', { class: 'knob-body' }, this.scale, dial),
      this.labelEl,
    );
    this.buildScale();
    this.bind(dial);
    this.render();
    this.relabel();
  }

  private angleOf(v: number): number {
    const { stops, min, max } = this.o;
    const f = stops ? this.stopIndex(v) / Math.max(1, stops.length - 1) : (v - min) / (max - min);
    return -this.sweep / 2 + f * this.sweep;
  }

  private stopIndex(v: number): number {
    const stops = this.o.stops!;
    let best = 0;
    stops.forEach((s, i) => {
      if (Math.abs(s.value - v) < Math.abs(stops[best].value - v)) best = i;
    });
    return best;
  }

  private buildScale() {
    this.scale.replaceChildren();
    this.stopEls = [];
    const place = (el: HTMLElement, angle: number) => {
      el.style.setProperty('--a', `${angle}deg`);
      this.scale.append(el);
    };
    if (this.o.stops) {
      this.o.stops.forEach((s, i) => {
        // Printed stops are also buttons: one tap jumps there.
        const b = h(
          'button',
          {
            type: 'button',
            class: 'knob-stop',
            tabindex: '-1',
            onclick: () => this.set(s.value, true),
          },
          h('span', { class: 'knob-stop-mark' }, s.mark()),
        );
        b.setAttribute('aria-label', s.text());
        this.stopEls[i] = b;
        place(b, this.angleOf(s.value));
      });
    } else {
      const ticks = 28;
      for (let i = 0; i <= ticks; i++) {
        place(h('span', { class: 'knob-tick' + (i % 4 === 0 ? ' knob-tick--major' : '') }), -this.sweep / 2 + (i / ticks) * this.sweep);
      }
      for (const m of this.o.marks ?? []) place(h('span', { class: 'knob-mark' }, h('span', {}, m.text)), this.angleOf(m.value));
    }
  }

  /** Rebuild printed text after a language change. */
  relabel() {
    this.labelEl.textContent = this.o.label();
    const dial = this.el.querySelector('.knob-dial')!;
    dial.setAttribute('aria-label', this.o.ariaLabel());
    if (this.o.stops) this.buildScale();
    this.render();
  }

  set(v: number, emit = false) {
    const { min, max, step, stops } = this.o;
    let nv = stops ? stops[this.stopIndex(v)].value : Math.min(max, Math.max(min, Math.round(v / step) * step));
    nv = Number(nv.toFixed(4));
    if (nv === this.value) return;
    this.value = nv;
    this.render();
    if (emit) this.o.onInput(nv);
  }

  private render() {
    const a = this.angleOf(this.value);
    this.cap.style.setProperty('--angle', `${a}deg`);
    const dial = this.el.querySelector('.knob-dial')!;
    if (this.o.stops) {
      const i = this.stopIndex(this.value);
      dial.setAttribute('aria-valuenow', String(i));
      this.stopEls.forEach((el, j) => el.classList.toggle('is-on', j === i));
    } else {
      dial.setAttribute('aria-valuenow', String(this.value));
    }
    dial.setAttribute('aria-valuetext', this.o.valueText(this.value));
  }

  private nudge(dir: number, big = false) {
    if (this.o.stops) {
      const i = this.stopIndex(this.value) + dir;
      const s = this.o.stops[Math.max(0, Math.min(this.o.stops.length - 1, i))];
      this.set(s.value, true);
    } else {
      this.set(this.value + dir * this.o.step * (big ? 10 : 1), true);
    }
  }

  private bind(dial: HTMLElement) {
    dial.addEventListener('keydown', (e) => {
      const k = e.key;
      if (k === 'ArrowUp' || k === 'ArrowRight') this.nudge(1, e.shiftKey);
      else if (k === 'ArrowDown' || k === 'ArrowLeft') this.nudge(-1, e.shiftKey);
      else if (k === 'PageUp') this.nudge(1, true);
      else if (k === 'PageDown') this.nudge(-1, true);
      else if (k === 'Home') this.set(this.o.stops ? this.o.stops[0].value : this.o.min, true);
      else if (k === 'End') this.set(this.o.stops ? this.o.stops[this.o.stops.length - 1].value : this.o.max, true);
      else return;
      e.preventDefault();
      e.stopPropagation();
    });

    let wheelAcc = 0;
    dial.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        wheelAcc += e.deltaY;
        const unit = e.deltaMode === 1 ? 1 : 40;
        while (Math.abs(wheelAcc) >= unit) {
          this.nudge(wheelAcc < 0 ? 1 : -1);
          wheelAcc -= Math.sign(wheelAcc) * unit;
        }
      },
      { passive: false },
    );

    // Drag. Around the knob, the value follows the angle of the finger 1:1 (so the
    // pointer line stays under it); from the centre, vertical drag.
    let drag: {
      id: number;
      cx: number;
      cy: number;
      last: number;
      y: number;
      acc: number;
      radial: boolean;
      x0: number;
      y0: number;
      moved: boolean;
    } | null = null;
    let lastTap = -Infinity;
    const angleAt = (e: PointerEvent, cx: number, cy: number) => (Math.atan2(e.clientX - cx, cy - e.clientY) * 180) / Math.PI;

    dial.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const r = dial.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const dist = Math.hypot(e.clientX - cx, e.clientY - cy);
      drag = {
        id: e.pointerId,
        cx,
        cy,
        last: angleAt(e, cx, cy),
        y: e.clientY,
        acc: 0,
        radial: dist > r.width * 0.2,
        x0: e.clientX,
        y0: e.clientY,
        moved: false,
      };
      try {
        dial.setPointerCapture(e.pointerId);
      } catch {
        /* pointer already gone: the drag simply ends on the next event */
      }
      dial.classList.add('is-turning');
      dial.focus({ preventScroll: true });
      e.preventDefault();
    });
    dial.addEventListener('pointermove', (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      if (Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0) > 6) drag.moved = true;
      let deg: number;
      if (drag.radial) {
        const a = angleAt(e, drag.cx, drag.cy);
        deg = a - drag.last;
        if (deg > 180) deg -= 360;
        if (deg < -180) deg += 360;
        drag.last = a;
      } else {
        deg = (drag.y - e.clientY) * 0.9;
        drag.y = e.clientY;
      }
      if (this.o.stops) {
        // One stop per slice of the sweep.
        const per = this.sweep / Math.max(1, this.o.stops.length - 1);
        drag.acc += deg;
        while (Math.abs(drag.acc) >= per * 0.6) {
          const dir = Math.sign(drag.acc);
          this.nudge(dir);
          drag.acc -= dir * per;
        }
      } else {
        drag.acc += (deg / this.sweep) * (this.o.max - this.o.min);
        if (Math.abs(drag.acc) >= this.o.step) {
          const steps = Math.trunc(drag.acc / this.o.step);
          drag.acc -= steps * this.o.step;
          this.set(this.value + steps * this.o.step, true);
        }
      }
    });
    const end = (e: PointerEvent) => {
      if (!drag || e.pointerId !== drag.id) return;
      const tapped = e.type === 'pointerup' && !drag.moved;
      drag = null;
      dial.classList.remove('is-turning');
      // Two taps in quick succession without turning: open value entry.
      if (tapped && this.o.onEntry) {
        const now = performance.now();
        if (now - lastTap < 350) {
          lastTap = -Infinity;
          this.o.onEntry();
        } else lastTap = now;
      }
    };
    dial.addEventListener('pointerup', end);
    dial.addEventListener('pointercancel', end);
    dial.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && this.o.onEntry) {
        e.preventDefault();
        this.o.onEntry();
      }
    });
  }
}

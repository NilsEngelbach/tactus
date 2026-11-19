// The tempo window's pendulum: a metronome arm that swings side to side and
// reaches the end of its travel on every beat, where its weight lights up
// (amber, red on an accent, dark on a silent beat).
//
// Only the upper part of the arm shows: the pivot sits below the window, so the
// weight sweeps (nearly) the full width of the glass on a flat arc.
//
// It moves like a real pendulum, slow at the ends and fast through the middle,
// and is timed from the audio clock, not from frames: it stays on the click
// however late a frame comes. The weight sits high on the arm for slow tempos
// and low for fast ones, like the sliding weight of a clockwork metronome.
import type { Accent } from '../audio/types';

const MAX_ANGLE = 34; // degrees either side of upright
const SETTLE_MS = 260; // easing into the swing, and back to rest
const BOB_W = 26; // weight size in CSS pixels
const BOB_H = 16;
const MARGIN = 8; // room between the swing and the window edge

const NS = 'http://www.w3.org/2000/svg';
const ease = (x: number) => 1 - (1 - x) ** 3;
const el = <K extends keyof SVGElementTagNameMap>(tag: K, cls: string) => {
  const e = document.createElementNS(NS, tag);
  e.setAttribute('class', cls);
  return e;
};

export class TempoPendulum {
  readonly el: HTMLDivElement;
  private svg = el('svg', 'pendulum-art');
  private scale = el('path', 'pendulum-scale');
  private marks = el('path', 'pendulum-mark');
  private centre = el('path', 'pendulum-centre');
  private arm = el('g', 'pendulum-arm');
  private rod = el('path', 'pendulum-rod');
  private weight = el('g', 'pendulum-weight');
  private glow = el('path', 'pendulum-glow');
  private on = false;
  private running = false;
  private bpm = 120;
  /** Arm length and pivot, in CSS pixels of the box; pivot may lie below it. */
  private len = 0;
  private pivotX = 0;
  private pivotY = 0;
  private boxH = 0;
  /** Audio time of the last beat; null until the first beat of a run. */
  private beatAt: number | null = null;
  /** The side the arm is on at the last beat, -1 left, 1 right. */
  private side = 1;
  private shown = 0;
  /** A jump in the motion (start, stop, a missed beat) eases out over SETTLE_MS. */
  private offset = 0;
  private offsetAt = 0;
  private frame = 0;

  /**
   * @param now   the audio time now reaching the speaker (null while stopped)
   * @param beatS seconds per beat at the current tempo
   */
  constructor(
    private now: () => number | null,
    private beatS: () => number,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'tempo-pendulum';
    this.el.setAttribute('aria-hidden', 'true');
    const bob = `M${-BOB_W / 2} ${-BOB_H / 2}H${BOB_W / 2}L${BOB_W / 2 - 3} ${BOB_H / 2}H${-BOB_W / 2 + 3}Z`;
    const body = el('path', 'pendulum-bob');
    body.setAttribute('d', bob);
    this.glow.setAttribute('d', bob);
    this.weight.append(body, this.glow);
    this.arm.append(this.rod, this.weight);
    this.svg.setAttribute('aria-hidden', 'true');
    this.svg.setAttribute('focusable', 'false');
    this.svg.append(this.scale, this.centre, this.marks, this.arm);
    this.el.append(this.svg);
    new ResizeObserver(() => this.layout()).observe(this.el);
  }

  /** Shown or hidden; the animation only runs while shown. */
  show(on: boolean) {
    if (on === this.on) return;
    this.on = on;
    this.offset = 0;
    this.schedule();
  }

  setTempo(bpm: number) {
    this.bpm = bpm;
    this.placeWeight();
  }

  setRunning(running: boolean) {
    if (running === this.running) return;
    this.running = running;
    this.beatAt = null;
    this.jumpFrom(this.shown);
    this.schedule();
  }

  /** A beat reaches the speaker: the arm is at one end. */
  beat(time: number, accent: Accent) {
    if (!this.running) return;
    const before = this.shown;
    this.side = this.beatAt === null ? -1 : -this.side;
    this.beatAt = time;
    if (Math.abs(before - this.side) > 0.05) this.jumpFrom(before);
    if (this.on && accent !== 0) {
      this.glow.style.setProperty('--c', accent === 2 ? 'var(--led-red)' : 'var(--led-amber)');
      this.glow.animate([{ opacity: 1 }, { opacity: 1, offset: 0.2 }, { opacity: 0 }], {
        duration: accent === 2 ? 260 : 220,
        easing: 'ease-out',
      });
    }
    this.schedule();
  }

  /**
   * Sizes the arm to the box: at full swing the weight nearly touches the side
   * edges, upright it nearly touches the top. In a tall box the pivot shows;
   * in the usual wide one it sits below the bottom edge.
   */
  private layout() {
    const r = this.el.getBoundingClientRect();
    const w = r.width;
    const h = r.height;
    if (!w || !h) return;
    this.boxH = h;
    this.svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
    const sin = Math.sin((MAX_ANGLE * Math.PI) / 180);
    const reach = w / 2 - MARGIN - BOB_W / 2;
    const top = MARGIN + BOB_H / 2;
    this.len = Math.max(20, Math.min(reach / sin, 4 * h));
    this.pivotX = w / 2;
    this.pivotY = top + this.len;
    this.rod.setAttribute('d', `M0 0V${-this.len}`);

    // The scale: an arc just above the weight's path, marks where the beats land.
    const R = this.len + BOB_H / 2 + 5;
    const pt = (rad: number, deg: number) => {
      const a = (deg * Math.PI) / 180;
      return `${(this.pivotX + rad * Math.sin(a)).toFixed(1)} ${(this.pivotY - rad * Math.cos(a)).toFixed(1)}`;
    };
    this.scale.setAttribute('d', `M${pt(R, -MAX_ANGLE - 3)}A${R} ${R} 0 0 1 ${pt(R, MAX_ANGLE + 3)}`);
    this.marks.setAttribute('d', [-MAX_ANGLE, MAX_ANGLE].map((a) => `M${pt(R - 7, a)}L${pt(R + 1, a)}`).join(''));
    this.centre.setAttribute('d', `M${pt(R - 4, 0)}L${pt(R + 1, 0)}`);
    this.placeWeight();
    this.draw();
  }

  /** High on the arm for slow tempos, low for fast; always inside the box. */
  private placeWeight() {
    if (!this.len) return;
    const f = Math.min(1, Math.max(0, (this.bpm - 30) / 270));
    // The lowest spot that stays clear of the faded bottom edge at full swing
    // (leaning, the arm reaches cos(angle) as high) and, upright, above the
    // tempo readout over the lower middle; never more than 65 % down the arm.
    const cos = Math.cos((MAX_ANGLE * Math.PI) / 180);
    const atSide = (this.pivotY - this.boxH * 0.8 + BOB_H / 2) / cos;
    const upright = this.pivotY - this.boxH * 0.42 + BOB_H / 2;
    const low = Math.min(this.len * 0.8, Math.max(this.len * 0.35, atSide, upright));
    const at = this.len - (this.len - low) * f;
    this.weight.setAttribute('transform', `translate(0 ${-at.toFixed(1)})`);
  }

  /** The position the motion calls for right now, -1 … 1. */
  private target(): number {
    if (!this.running || this.beatAt === null) return 0;
    const t = this.now();
    if (t === null) return 0;
    // From one end at the beat to the other end at the next beat; a beat that
    // comes late (tempo lowered) finds the arm waiting at the end.
    const p = Math.min(1, Math.max(0, (t - this.beatAt) / this.beatS()));
    return this.side * Math.cos(Math.PI * p);
  }

  /** Keeps the arm where it is and eases it onto the new motion. */
  private jumpFrom(pos: number) {
    this.offset = pos - this.target();
    this.offsetAt = performance.now();
  }

  private schedule() {
    if (!this.frame && this.on) this.frame = requestAnimationFrame(this.draw);
  }

  private draw = () => {
    this.frame = 0;
    if (!this.on) return;
    const k = Math.min(1, (performance.now() - this.offsetAt) / SETTLE_MS);
    const settling = k < 1 && this.offset !== 0;
    this.shown = this.target() + (settling ? this.offset * (1 - ease(k)) : 0);
    const angle = (this.shown * MAX_ANGLE).toFixed(2);
    this.arm.setAttribute('transform', `translate(${this.pivotX} ${this.pivotY.toFixed(1)}) rotate(${angle})`);
    if (this.running || settling) this.schedule();
  };
}

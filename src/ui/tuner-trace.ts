// The tuner's trace: a short history line of the pitch, for watching how a note
// starts and settles (a brass attack that scoops up, a long tone that sags).
//
// Time runs right to left, newest at the right edge, cents up (sharp) and down
// (flat). The clock only moves while a pitch comes in; a silence leaves a short
// gap and the line waits, so a finished note stays on the glass to look at.
// Each note gets its own stretch of line, labelled with its name, and once it
// ends, with the median of its sustain (the attack left out).

const SPAN_S = 5; // seconds of sound across the strip
const GAP_S = 0.3; // room left between two notes
const MAX_DT_S = 0.1; // a late frame never stretches the line more than this
const RANGE = 50; // cents at the top and bottom edge
const ATTACK_S = 0.15; // left out of the sustain median
const MIN_SUMMARY_S = 0.6; // shorter notes get no median
const MIN_POINTS = 5; // shorter stretches (about 55 ms) are dropped as glitches
const SILENT_FRAMES = 5; // about 55 ms without pitch ends a note

interface Point {
  t: number;
  c: number;
}
interface Segment {
  note: number;
  pts: Point[];
  open: boolean;
  /** performance.now() of its last point. */
  lastReal: number;
}

export interface TraceOptions {
  /** Pitch band shown in green, in cents either side of the centre. */
  inTune: number;
  /** Display name of a sounding MIDI note (transposition applied by the caller). */
  label: (midi: number) => string;
}

export class TunerTrace {
  readonly el: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private segs: Segment[] = [];
  private t = 0; // trace clock, seconds of sound
  private lastReal = 0; // performance.now() of the last point
  private raw: number[] = []; // last few cents, for a 3-point median
  private silent = 0; // frames without pitch in a row
  private frame = 0;
  private w = 0;
  private h = 0;
  private dpr = 1;

  constructor(private opts: TraceOptions) {
    this.canvas = document.createElement('canvas');
    this.el = document.createElement('div');
    this.el.className = 'tuner-trace';
    this.el.setAttribute('aria-hidden', 'true');
    this.el.append(this.canvas);
    this.ctx = this.canvas.getContext('2d')!;
    new ResizeObserver(() => this.resize()).observe(this.el);
  }

  /**
   * One analysis frame: the unsmoothed pitch as a MIDI number. The trace keeps
   * its own note, without the display's median: a new attack must start its own
   * line at once, not be drawn against the old note for a few frames.
   */
  push(midi: number) {
    const now = performance.now();
    let seg: Segment | undefined = this.segs[this.segs.length - 1];
    const recent = !!seg?.open && now - this.lastReal < 250;
    this.silent = 0;
    // Stay on the note until the pitch is clearly closer to another one.
    const note = recent && seg && Math.abs(midi - seg.note) <= 0.62 ? seg.note : Math.round(midi);
    if (recent && seg && note === seg.note) {
      this.t += Math.min((now - this.lastReal) / 1000, MAX_DT_S);
    } else {
      // A stretch of a frame or two is an attack transient, not a note: drop it,
      // and if the note before it goes on, carry on with that line.
      if (seg && seg.pts.length < MIN_POINTS) {
        this.segs.pop();
        const prev: Segment | undefined = this.segs[this.segs.length - 1];
        seg = recent && prev?.note === note && now - prev.lastReal < 250 ? prev : undefined;
        if (seg) seg.open = true;
      }
      if (seg?.open && seg.note === note) {
        this.t += Math.min((now - this.lastReal) / 1000, MAX_DT_S);
      } else {
        // A new note: after a silence leave a gap, on a slur just break the line.
        if (seg) seg.open = false;
        if (!recent && this.segs.length) this.t += GAP_S;
        seg = { note, pts: [], open: true, lastReal: now };
        this.segs.push(seg);
        this.raw = [];
      }
    }
    this.lastReal = now;
    seg.lastReal = now;
    this.raw.push((midi - note) * 100);
    if (this.raw.length > 3) this.raw.shift();
    const c = [...this.raw].sort((a, b) => a - b)[this.raw.length >> 1];
    seg.pts.push({ t: this.t, c: Math.max(-RANGE, Math.min(RANGE, c)) });

    // Forget what has scrolled out.
    const cut = this.t - SPAN_S - 1;
    while (this.segs.length > 1 && this.segs[0].pts[this.segs[0].pts.length - 1].t < cut) this.segs.shift();
    this.schedule();
  }

  /** No pitch in this frame. A few in a row end the note (a dropout of one or two does not). */
  silence() {
    const seg = this.segs[this.segs.length - 1];
    if (seg?.open && ++this.silent >= SILENT_FRAMES) {
      seg.open = false;
      if (seg.pts.length < MIN_POINTS) this.segs.pop();
      this.schedule();
    }
  }

  clear() {
    this.segs = [];
    this.t = 0;
    this.raw = [];
    this.schedule();
  }

  /** Redraw, e.g. after the language or transposition changed the labels. */
  refresh() {
    this.schedule();
  }

  private resize() {
    const r = this.el.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.w = r.width;
    this.h = r.height;
    this.canvas.width = Math.round(r.width * this.dpr);
    this.canvas.height = Math.round(r.height * this.dpr);
    this.draw();
  }

  private schedule() {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.draw();
    });
  }

  private draw() {
    const { ctx, w, h, dpr } = this;
    if (!w || !h) return;
    const css = getComputedStyle(this.el);
    const amber = css.getPropertyValue('--led-amber').trim() || '#ffad1f';
    const green = css.getPropertyValue('--led-green').trim() || '#3cf08e';
    const dim = css.getPropertyValue('--readout-dim').trim() || 'rgba(247,240,225,.56)';
    const font = css.fontFamily;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const pad = 14; // room for the labels at top and bottom
    const mid = h / 2;
    const yScale = (h / 2 - pad) / RANGE;
    const y = (c: number) => mid - c * yScale;
    const x = (t: number) => w - ((this.t - t) / SPAN_S) * w;
    const band = this.opts.inTune * yScale;

    // Grid: the in-tune band, centre line, ±10 and ±25 cents, the edges.
    ctx.fillStyle = 'rgba(60, 240, 142, 0.07)';
    ctx.fillRect(0, mid - band, w, band * 2);
    ctx.lineWidth = 1;
    for (const c of [-50, -25, -10, 10, 25, 50]) {
      ctx.strokeStyle = Math.abs(c) === 50 ? 'rgba(247,240,225,0.10)' : 'rgba(247,240,225,0.06)';
      ctx.setLineDash(Math.abs(c) === 10 ? [2, 4] : []);
      ctx.beginPath();
      ctx.moveTo(0, Math.round(y(c)) + 0.5);
      ctx.lineTo(w, Math.round(y(c)) + 0.5);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.strokeStyle = 'rgba(60, 240, 142, 0.28)';
    ctx.beginPath();
    ctx.moveTo(0, Math.round(mid) + 0.5);
    ctx.lineTo(w, Math.round(mid) + 0.5);
    ctx.stroke();

    ctx.font = `600 10px ${font}`;
    ctx.fillStyle = 'rgba(247,240,225,0.32)';
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillText('+25', 2, y(25) - 6);
    ctx.fillText('−25', 2, y(-25) + 7);

    // The line: drawn amber, then again in green clipped to the in-tune band.
    const path = new Path2D();
    for (const s of this.segs) {
      s.pts.forEach((p, i) => (i ? path.lineTo(x(p.t), y(p.c)) : path.moveTo(x(p.t), y(p.c))));
      if (s.pts.length === 1) path.lineTo(x(s.pts[0].t) + 1, y(s.pts[0].c));
    }
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.lineWidth = 2.2;
    ctx.shadowBlur = 8;
    ctx.shadowColor = amber;
    ctx.strokeStyle = amber;
    ctx.stroke(path);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, mid - band, w, band * 2);
    ctx.clip();
    ctx.shadowColor = green;
    ctx.strokeStyle = green;
    ctx.stroke(path);
    ctx.restore();
    ctx.shadowBlur = 0;

    // The head of a sounding note.
    const last = this.segs[this.segs.length - 1];
    if (last?.open && last.pts.length) {
      const p = last.pts[last.pts.length - 1];
      ctx.fillStyle = Math.abs(p.c) <= this.opts.inTune ? green : amber;
      ctx.beginPath();
      ctx.arc(x(p.t), y(p.c), 3.2, 0, Math.PI * 2);
      ctx.fill();
    }

    // Labels: the note at the start of its line, the sustain median at its end.
    ctx.font = `700 10px ${font}`;
    ctx.textBaseline = 'top';
    let free = 0; // labels never overlap: each starts right of the last one
    for (const s of this.segs) {
      if (s.pts.length < MIN_POINTS && !s.open) continue;
      const x0 = x(s.pts[0].t);
      const x1 = x(s.pts[s.pts.length - 1].t);
      if (x1 < 0) continue;
      ctx.fillStyle = 'rgba(247,240,225,0.16)';
      ctx.fillRect(Math.round(x0) - 0.5, 0, 1, 12);
      const name = this.opts.label(s.note);
      const lx = Math.max(2, x0 + 3, free);
      if (lx < Math.max(x1, x0 + 3) + 4) {
        ctx.fillStyle = dim;
        ctx.textAlign = 'left';
        ctx.fillText(name, lx, 2);
        free = lx + ctx.measureText(name).width + 6;
      }

      const med = s.open ? null : sustainMedian(s);
      if (med !== null) {
        const r = Math.round(med);
        const text = `Ø ${r > 0 ? '+' : r < 0 ? '−' : '±'}${Math.abs(r)}`;
        ctx.fillStyle = Math.abs(med) <= this.opts.inTune ? green : amber;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.fillText(text, Math.min(w - 2, x1), h - 1);
        ctx.textBaseline = 'top';
      }
    }
  }
}

/** Median cents of a finished note, attack left out; null for short notes. */
function sustainMedian(s: Segment): number | null {
  const t0 = s.pts[0].t;
  const t1 = s.pts[s.pts.length - 1].t;
  if (t1 - t0 < MIN_SUMMARY_S) return null;
  const v = s.pts.filter((p) => p.t - t0 >= ATTACK_S).map((p) => p.c).sort((a, b) => a - b);
  return v[v.length >> 1];
}

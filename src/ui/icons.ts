// Authored glyphs, drawn on one 24-unit grid with filled shapes like silkscreen ink.
import { svg } from './dom';

const wrap = (body: string, vb = '0 0 24 24') =>
  `<svg viewBox="${vb}" aria-hidden="true" focusable="false" fill="currentColor">${body}</svg>`;

// A notehead tilted like engraved music, its stem rising from the right edge.
const head = (cx: number, cy: number) =>
  `<ellipse cx="${cx}" cy="${cy}" rx="3.3" ry="2.4" transform="rotate(-22 ${cx} ${cy})"/>`;
const stem = (x: number, top: number, bottom: number) => `<rect x="${x}" y="${top}" width="1.4" height="${bottom - top}"/>`;
/** A beamed triplet group with a "3": the outer notes, and the middle given. */
const triplet = (middle: string) =>
  head(4.2, 19) + stem(6.1, 7, 18.5) + middle + head(18.2, 19) + stem(20.1, 7, 18.5) +
  '<rect x="6.1" y="7" width="15.4" height="2.6"/><text x="13.8" y="5.6" font-size="7" font-weight="800" text-anchor="middle" font-family="inherit">3</text>';

/** The rhythms of the Subdiv knob, in its order. */
export const rhythmIcon = [
  // quarter
  () => svg(wrap(head(10.5, 18.5) + stem(12.6, 3, 18))),
  // two eighths
  () => svg(wrap(head(6, 18.5) + stem(8.1, 5, 18) + head(16, 18.5) + stem(18.1, 5, 18) + '<rect x="8.1" y="4" width="11.4" height="2.8"/>')),
  // dotted shuffle: dotted eighth and sixteenth
  () =>
    svg(
      wrap(
        head(5, 18.5) + stem(7.1, 5, 18) + '<circle cx="10.6" cy="17.4" r="1.35"/>' + head(16, 18.5) + stem(18.1, 5, 18) +
          '<rect x="7.1" y="4" width="12.4" height="2.8"/><rect x="13.6" y="8.2" width="5.9" height="2.4"/>',
      ),
    ),
  // triplet
  () => svg(wrap(triplet(head(11.2, 19) + stem(13.1, 7, 18.5)))),
  // triplet shuffle: the middle triplet is an eighth rest
  () =>
    svg(
      wrap(
        triplet(
          '<circle cx="11.6" cy="13.6" r="1.6"/>' +
            '<path d="M12 15.1c1.2.2 2.2-.3 2.9-1.4l.9.3-3.3 7.6h-1.3l2.5-5.8c-.5.2-1.1.2-1.7.1z"/>',
        ),
      ),
    ),
  // four sixteenths
  () =>
    svg(
      wrap(
        [2.8, 8.4, 14, 19.6].map((x) => head(x, 19.5) + stem(x + 1.9, 5, 19)).join('') +
          '<rect x="4.7" y="4" width="18.2" height="2.4"/><rect x="4.7" y="8" width="18.2" height="2.4"/>',
      ),
    ),
];

export const sharpIcon = () =>
  svg(
    wrap(
      '<rect x="7.2" y="1" width="1.9" height="22"/><rect x="14.4" y="0" width="1.9" height="22"/>' +
        '<path d="M4 8.6 20 4.4v4L4 12.6z"/><path d="M4 17.6 20 13.4v4L4 21.6z"/>',
    ),
  );

export const flatIcon = () =>
  svg(wrap('<rect x="6" y="0" width="2" height="23"/><path d="M8 13.2c3.5-3 8.5-3.4 9.4-0.2 0.8 3-2.7 6.6-9.4 10.4v-2.9c4.3-2.6 6.6-5 6-6.8-0.5-1.6-3.3-1-6 1.4z"/>'));

/** Tuner arrows: a solid triangle pointing toward the centre of the meter. */
export const arrowRight = () => svg(wrap('<path d="M5 3.5 20 12 5 20.5z"/>'));
export const arrowLeft = () => svg(wrap('<path d="M19 3.5 4 12l15 8.5z"/>'));

/** A warning triangle with an exclamation mark cut out. */
export const warningIcon = () =>
  svg(wrap('<path fill-rule="evenodd" d="M12 2.5 23 21.5H1zM11 9.5h2v6h-2zm0 7.6h2v2h-2z"/>'));

export const downloadIcon = () =>
  svg(wrap('<path d="M11 3h2v10.2l3.6-3.6 1.4 1.4-6 6-6-6 1.4-1.4 3.6 3.6z"/><rect x="4" y="19" width="16" height="2"/>'));

export const voiceIcon = [
  // click: a short spike
  () => svg(wrap('<path d="M11 3h2v18h-2z"/><path d="M6 9h2v6H6zM16 9h2v6h-2z"/>')),
  // wood: a block
  () => svg(wrap('<rect x="4" y="8" width="16" height="9" rx="1.5"/><rect x="7" y="11" width="10" height="1.6" fill="#000" opacity=".35"/>')),
  // beep: a sine
  () => svg(wrap('<path d="M2 12c2.2-6.4 4.4-6.4 6.6 0s4.4 6.4 6.6 0 4.4-6.4 6.6 0" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>')),
  // claves: two sticks crossing
  () => svg(wrap('<rect x="1.5" y="10.6" width="21" height="2.8" rx="1.4" transform="rotate(-28 12 12)"/><rect x="1.5" y="10.6" width="21" height="2.8" rx="1.4" transform="rotate(28 12 12)"/>')),
  // light only: a lamp with rays
  () =>
    svg(
      wrap(
        '<circle cx="12" cy="12" r="4.6"/>' +
          [0, 45, 90, 135, 180, 225, 270, 315].map((a) => `<rect x="11" y="1.2" width="2" height="4" rx="1" transform="rotate(${a} 12 12)"/>`).join(''),
      ),
    ),
];

---
name: Tactus
description: A metronome and a chromatic tuner built as enamel stompboxes on a dark railed pedalboard.
colors:
  enamel-tempo: "#b83a28"
  enamel-tuner: "#2f6d5a"
  enamel-mustard: "#e2b33c"
  board: "#141416"
  board-rail: "#1c1c20"
  board-gap: "#0b0b0d"
  glass: "#0a0b0a"
  cream: "#f3ead8"
  cream-dim: "rgba(243, 234, 216, 0.66)"
  readout: "#f7f0e1"
  readout-dim: "rgba(247, 240, 225, 0.56)"
  led-red: "#ff3d2e"
  led-amber: "#ffad1f"
  led-green: "#3cf08e"
  chrome-hi: "#f5f5f3"
  chrome-mid: "#a6a9ad"
  chrome-lo: "#4d5054"
typography:
  display:
    fontFamily: "'Archivo Variable', 'Archivo', system-ui, sans-serif"
    fontSize: "max(20px, calc(7.4 * var(--u)))"
    fontWeight: 900
    lineHeight: 1
    letterSpacing: "0.04em"
    fontVariation: "'wdth' 125"
  wordmark:
    fontFamily: "'Archivo Variable', 'Archivo', system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 900
    letterSpacing: "0.22em"
    fontVariation: "'wdth' 125"
  reading:
    fontFamily: "'Archivo Variable', 'Archivo', system-ui, sans-serif"
    fontSize: "min(calc(32 * var(--u)), 22cqh)"
    fontWeight: 620
    lineHeight: 0.8
    letterSpacing: "-0.01em"
    fontFeature: "'tnum', 'lnum'"
    fontVariation: "'wdth' 62"
  readout-small:
    fontFamily: "'Archivo Variable', 'Archivo', system-ui, sans-serif"
    fontSize: "max(13px, calc(4 * var(--u)))"
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: "0.03em"
    fontFeature: "'tnum'"
    fontVariation: "'wdth' 80"
  body:
    fontFamily: "'Archivo Variable', 'Archivo', system-ui, sans-serif"
    fontSize: "max(13px, calc(3.6 * var(--u)))"
    fontWeight: 560
    lineHeight: 1.3
  label:
    fontFamily: "'Archivo Variable', 'Archivo', system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 750
    lineHeight: 1.1
    letterSpacing: "0.1em"
    fontVariation: "'wdth' 125"
  scale-mark:
    fontFamily: "'Archivo Variable', 'Archivo', system-ui, sans-serif"
    fontSize: "max(9px, calc(2.6 * var(--u)))"
    fontWeight: 700
    lineHeight: 1
    fontFeature: "'tnum'"
    fontVariation: "'wdth' 85"
rounded:
  pedal: "18px"
  window: "calc(2.6 * var(--u))"
  tab: "7px"
  plate: "6px"
  segment: "2px"
  round: "50%"
spacing:
  u: "min(1cqw, 0.6cqh)"
  pedal-pad: "calc(5 * var(--u))"
  pedal-gap: "calc(3.2 * var(--u))"
  window-pad: "calc(3.4 * var(--u)) calc(4 * var(--u)) calc(3 * var(--u))"
  rack-gap: "16px"
  rail: "72px"
components:
  pedal-tempo:
    backgroundColor: "{colors.enamel-tempo}"
    textColor: "{colors.cream}"
    rounded: "{rounded.pedal}"
    padding: "{spacing.pedal-pad}"
  pedal-tuner:
    backgroundColor: "{colors.enamel-tuner}"
    textColor: "{colors.cream}"
    rounded: "{rounded.pedal}"
    padding: "{spacing.pedal-pad}"
  display-window:
    backgroundColor: "{colors.glass}"
    textColor: "{colors.readout}"
    rounded: "{rounded.window}"
    padding: "{spacing.window-pad}"
  footswitch:
    size: "max(56px, calc(17 * var(--u)))"
    rounded: "{rounded.round}"
  knob-knurled-big:
    size: "calc(25 * var(--u))"
    rounded: "{rounded.round}"
  knob-small:
    size: "calc(11.5 * var(--u))"
    rounded: "{rounded.round}"
  tab-tempo:
    backgroundColor: "{colors.enamel-tempo}"
    textColor: "{colors.cream}"
    typography: "{typography.label}"
    rounded: "{rounded.tab}"
    height: "36px"
  tab-tuner:
    backgroundColor: "{colors.enamel-tuner}"
    textColor: "{colors.cream}"
    typography: "{typography.label}"
    rounded: "{rounded.tab}"
    height: "36px"
  plate:
    textColor: "{colors.cream}"
    typography: "{typography.label}"
    rounded: "{rounded.plate}"
    padding: "0 11px"
    height: "34px"
  led:
    rounded: "{rounded.round}"
    size: "12px"
---

# Design System: Tactus

## Overview

**Creative North Star: "The Pedalboard"**

Every tool is one stompbox: a powder-coated enamel enclosure with a recessed black glass window, rotary knobs printed with their own scale, chrome footswitches with hex nuts, and side jacks. The app is the board they stand on: a near-black surface striped with horizontal mounting rails. Nothing on screen is an app panel, a pill button or a stepper; every control is a part you could buy for a real pedal, and it behaves like one (turn, stomp, flip).

The world is dark and material. Colour comes from three places only: the enamel of each enclosure, the cream silkscreen ink printed on it, and the LEDs behind the glass. Depth is physical, built from layered inset and drop shadows, chrome gradients with a hard horizon line, and a fine powder-coat speckle. Readings are large and condensed so they hold at two metres from a music stand; everything else is small, wide, uppercase silkscreen.

Every pedal part is sized in one unit, `--u`, derived from the pedal's own container, so a pedal is the same object at 390px and at 1440px, only bigger. A new tool arrives as a new pedal in a new enamel colour, built in the same shell.

**Key Characteristics:**
- One enclosure per tool, one enamel colour per enclosure.
- Recessed black glass windows with warm-white numerals and LEDs.
- Real hardware controls: knurled and chicken-head knobs, chrome stomp switches, a bat-handle toggle.
- One type family, Archivo Variable, used across its width axis.
- Every pedal dimension scales from one container unit.
- Motion is physical, short and state-only.

## Colors

A dark board, saturated enamels, cream ink and three LED colours with fixed meanings.

### Primary
- **Vermilion Enamel** (`enamel-tempo`): the Tempo pedal's enclosure and its header tab. Also the source for the window bezel and switch-row rule, mixed toward black (62% and 70% enamel).
- **Bottle Green Enamel** (`enamel-tuner`): the Tuner pedal's enclosure and tab.

### Secondary
- **Mustard Enamel** (`enamel-mustard`): reserved for the next pedal. Defined in the build but unused on any surface so far.

### Tertiary
- **Status Red LED** (`led-red`): power and running, the accented beat, the reference tone sounding, an update waiting.
- **Beat Amber LED** (`led-amber`): the beat LEDs, off-pitch segments and arrows on the tuner, the value-entry underline and caret, text selection.
- **In-Tune Green LED** (`led-green`): the tuner's centre segment and status when the note is in tune. Nothing else.

### Neutral
- **Board Black** (`board`): page and board ground; **Rail Charcoal** (`board-rail`) and **Rail Gap** (`board-gap`) stripe the board every 72px.
- **Black Glass** (`glass`): every display window.
- **Silkscreen Cream** (`cream`, dimmed `cream-dim`): all printing on enamel (names, model numbers, knob labels and scales), knob pointers, focus outlines.
- **Readout White** (`readout`, dimmed `readout-dim`): numerals and text inside the glass. Dimmed for units, secondary readings and hints.
- **Chrome** (`chrome-hi`, `chrome-mid`, `chrome-lo`): switches, jacks, plugs, the language toggle and name plates.

### Named Rules
**The LED Grammar Rule.** Red is status and accent, amber is beat and off-pitch, green means in tune and nothing else. A new tool reuses this grammar; it does not add a fourth LED colour or move green to "on" or "OK".

**The One Enamel per Pedal Rule.** Each tool owns exactly one enamel colour across its enclosure and its tab. Enamel never appears as text colour, and never inside the glass.

## Typography

**Display Font:** Archivo Variable (with Archivo, system-ui, sans-serif)
**Body Font:** Archivo Variable
**Label Font:** Archivo Variable, expanded

**Character:** One grotesque family stretched across its width axis: expanded heavy caps read as ink printed on a pedal; condensed numerals read as an instrument display.

### Hierarchy
- **Display** (900, `wdth` 125, max(20px, 7.4u), 1, 0.04em, uppercase): the pedal name in the enclosure head.
- **Wordmark** (900, `wdth` 125, 17px, 0.22em, uppercase): TACTUS in the header only.
- **Reading** (620, `wdth` 62, up to 32u for BPM and 34u for the note, 0.8, tabular lining figures): the main value in the window.
- **Readout Small** (600, `wdth` 80, max(13px, 4u), 1.1, tabular): tempo name, meter, cents, Hz, reference pitch.
- **Body** (560, `wdth` 100, max(13px, 3.6u), 1.3, max 36ch, balanced): window messages such as the microphone prompt.
- **Label / Silkscreen** (750, `wdth` 125, 11px base, 0.1em, uppercase): knob labels, switch labels, model number, tabs, plates, the keyboard hint on desktop. Inside the glass the same style runs at 700 in `readout-dim`.
- **Scale Mark** (700, `wdth` 85, max(9px, 2.6u), tabular): numbers and glyphs printed around knobs.

### Named Rules
**The Width Axis Rule.** Hierarchy is carried by width as much as by size: expanded (125%) for anything printed on enamel, condensed (62-80%) for anything lit in the glass. Never introduce a second family.

**The Two-Metre Rule.** The reading is the largest thing on a pedal and is always tabular. Labels stay small; they are learned once, the reading is read every second.

## Layout

The app is a two-row grid: a header strip and the board. The board fills the rest of the dynamic viewport (min 520px) and draws its rails as a repeating gradient.

Inside a pedal, a vertical stack in fixed order: head (name left, model number right), display window (flexes to fill, min 38u), control deck, footswitch row (two columns, divided from the deck by an enamel-dark rule). All internal spacing, sizes and type are multiples of `--u` (`min(1cqw, 0.6cqh)` of the pedal container), with px floors on text and touch targets.

**Phone (below 880px):** the header wraps to two rows: wordmark and tools, then two mini-pedal tabs side by side. Pedals sit in a horizontal scroll-snap rack (16px gap, each `100vw - 32px`, max 460px wide, max 820px tall, snapping to centre). Jacks and cables are hidden. The install plate collapses to its icon; a waiting update outranks install.

**Desktop (880px and up):** tabs disappear; both pedals stand side by side at full height (up to 780px, aspect 0.6), joined by a cable from jack to jack with right-angle plugs. A one-line keyboard hint is printed in silkscreen at the board's foot.

### Named Rules
**The One Unit Rule.** Every pedal part is sized in `--u`. A fixed pixel size inside a pedal is allowed only as a minimum (legibility or touch-target floor).

## Elevation & Depth

Fully physical. Depth comes from layered shadows that describe real objects: the enclosure has a bright top bevel, a dark bottom bevel and a cast shadow; the window is recessed with a deep inset shadow inside an enamel-dark bezel; knobs and switches cast drop shadows onto the enamel; chrome uses gradients with a hard horizon band and one specular highlight. The enamel carries a fine fractal-noise speckle and a soft highlight from the top left.

### Shadow Vocabulary
- **Enclosure** (`inset 0 2px 0 rgba(255,255,255,.28), inset 0 -3px 0 rgba(0,0,0,.28), 0 10px 18px rgba(0,0,0,.55), 0 2px 3px rgba(0,0,0,.6)` plus soft inner bevels): every pedal.
- **Recessed glass** (`inset 0 3px 8px rgba(0,0,0,.95)` with a 1.1u enamel-dark bezel ring): every display window.
- **Knob cast** (`0 1u 1.8u rgba(0,0,0,.5), 0 2px 2px rgba(0,0,0,.45)`): knurled knobs; chicken-heads use the same as a drop-shadow filter.
- **Raised tab** (`inset 0 1px 0 rgba(255,255,255,.24), 0 3px 5px rgba(0,0,0,.6)`, lifted 2px) versus **pressed tab** (`inset 0 2px 4px rgba(0,0,0,.5)`).
- **LED glow** (`0 0 0.9s 0.12s` of the LED colour at 70%): lit LEDs and meter segments only.

### Named Rules
**The Light from Above Rule.** All highlights sit on top and top-left edges, all cast shadows fall downward. A new part follows the same light.

## Shapes

Enclosures are rounded rectangles (18px). Windows are softly rounded in the pedal unit (2.6u). Knobs, LEDs, switch domes and the language toggle are circles; the footswitch nut is a hexagon. Meter segments are short rounded bars (2px), the centre segment wider (2.6 times) and taller. The chicken-head is a tapered teardrop over a round hub. Header tabs (7px) and name plates (6px) are small hardware rectangles, never pills.

## Components

### Pedal (signature)
Built with `pedalShell()` in `src/ui/pedal.ts`: enamel enclosure, side jacks, silkscreen head, window, control deck, footswitch row. A new tool is a new pedal in a new enamel colour; the shell does not change.

### Display Window
Black glass, warm-white readings, one faint diagonal reflection across the top. Readings that hold a value (BPM, A4 reference) are buttons: tap to type in place. The input keeps the readout's type and shows an amber underline (3px, 2px for small readouts) and an amber caret. Off, starting and error states show a message under a hairline divider; a held tuner reading dims to 40%.

### Knobs
- **Knurled** (continuous): a ridged conic skirt, smooth dark top, cream pointer, printed tick scale (major every fourth tick) and numbers. Big (25u) for the pedal's main value, small (11.5u) for levels.
- **Chicken-head** (stops): a tapered black pointer over a hub with a cream line. Each printed stop is a tap target (28px hit area); the selected stop is printed at weight 900 with a small cream dot outside it.
- **Input:** drag around or up/down, wheel, arrow keys, Home/End. Focus is a 2px cream outline.

### Footswitch
An authored inline SVG: hex nut, ring and dome in polished chrome. The chrome gradients are defined once per document (`src/ui/switch.ts`) and shared. It acts on press, not release; the dome drops 2px for 70ms. The whole zone around it, including its label, is the hit area. A status LED with a chrome bezel sits above each switch.

### LEDs
Round, dark lens when off; a radial lit core with a coloured glow when on. Beat LEDs flash from audio-clock timestamps (190ms, with dimmer variants for subdivisions). An accented beat is a larger red LED; a muted beat is an empty ring. Tapping a beat LED changes its accent. In the light-only voice the whole Tempo display glass lights up solid on each sounding beat, behind the readouts, in the beat LED colours: amber for a beat, red for an accent; silent beats stay dark (softer under reduced motion). Subdivisions never flash the display, only the beat LEDs. Above 180 BPM (more than 3 flashes a second, the WCAG 2.3.1 limit) the hint line becomes an amber warning on a dark plate, so it stays readable while the glass flashes. With reduced motion on, the display does not flash at all above 180 BPM (the beat LEDs still do) and the plate says so instead.

### Tuner Meter
21 segments from -50 to +50 cents with a wide centre; longer ticks every fifth segment. Lit segments are amber, all green when in tune. Direction arrows either side of the note light amber. In-tune is readable by position and shape, not colour alone.

### Navigation
- **Header:** wordmark left; plates and the language toggle right.
- **Tabs (phone only):** two mini pedals in their enamel, each with an LED and a silkscreen name. Current tab is raised 2px with a short cream rule; the other is pressed in.
- **Name plates:** chrome plates for install and update; the update plate is amber enamel with dark text.
- **Language:** a chrome bat-handle toggle between EN and DE (flips 76 degrees, 110ms).

## Do's and Don'ts

### Do:
- **Do** build every new tool with `pedalShell()` in its own enamel colour, next in line `enamel-mustard`.
- **Do** size every pedal part in `--u`, with px minimums for text and touch targets.
- **Do** keep LED meanings fixed: red for status and accent, amber for beat and off-pitch, green for in tune only.
- **Do** print labels in expanded uppercase silkscreen on enamel, and set readings condensed with tabular figures in the glass.
- **Do** make values directly enterable by tapping the reading, with the amber underline and caret.
- **Do** keep motion physical and short (70-190ms), state-only, and drop transitions under reduced motion.

### Don't:
- **Don't** use app panels, pill buttons, plus/minus steppers or a round needle gauge; every control is a pedal part.
- **Don't** add a second type family or use system faces for display.
- **Don't** use green for anything but in tune.
- **Don't** put enamel colour inside the glass or use it as text colour.
- **Don't** draw a footswitch or chrome part in CSS when the shared SVG chrome gradients exist; reuse them.
- **Don't** use emoji or font glyphs for icons; icons are authored SVG on the 24-unit grid in `src/ui/icons.ts`.

export type Lang = 'en' | 'de';

const en = {
  appTitle: 'Tactus',
  tagline: 'Metronome and tuner',
  language: 'Language',
  pedals: 'Pedals',
  install: 'Install',
  updateReady: 'Update ready',
  reload: 'Reload',
  offlineReady: 'Ready offline',

  tempo: 'Tempo',
  tempoPedal: 'Tempo pedal (metronome)',
  bpm: 'BPM',
  beats: 'Beats',
  subdiv: 'Subdiv',
  voice: 'Voice',
  level: 'Level',
  tap: 'Tap',
  on: 'On',
  start: 'Start metronome',
  stop: 'Stop metronome',
  tapTempo: 'Tap tempo',
  tempoEntry: 'Type a tempo',
  a4Entry: 'Type the A4 pitch in Hz',
  voices: ['Click', 'Wood', 'Beep', 'Claves', 'Light only, no sound'],
  subdivNames: ['Quarter notes', 'Eighth notes', 'Dotted shuffle (dotted eighth and sixteenth)', 'Triplets', 'Triplet shuffle (middle triplet silent)', 'Sixteenth notes'],
  beatsPerBar: (n: number) => `${n} beat${n === 1 ? '' : 's'} per bar`,
  beatLabel: (n: number, accent: string) => `Beat ${n}: ${accent}. Tap to change.`,
  accents: ['silent', 'normal', 'accent'],
  accentHint: 'Tap a light to change its accent',
  flashWarning: 'Caution: flashes more than 3 times a second. Risk for photosensitive epilepsy.',
  flashOffReduced: 'Reduce Motion is on: the display does not flash above 180 BPM.',
  pendulum: 'Pendulum',
  pendulumLabel: 'Pendulum: swings to each beat',

  tuner: 'Tuner',
  tunerPedal: 'Tuner pedal',
  calib: 'A4',
  calibLabel: 'Reference pitch A4',
  transpose: 'Transp.',
  transposeLabel: 'Instrument key',
  instrumentIn: (k: string) => `Instrument in ${k}`,
  ref: 'Ref',
  refNote: 'Note',
  refNoteLabel: 'Reference note',
  refPlaying: 'Reference',
  refLabel: 'Play reference tone',
  refStop: 'Stop reference tone',
  listenStart: 'Start tuner (uses the microphone)',
  listenStop: 'Stop tuner',
  tunerIdle: 'Step on ON, then play one note.',
  tunerPrivacy: 'The sound stays on this device.',
  tunerStarting: 'Waiting for the microphone…',
  tunerListening: 'Play a note',
  flat: 'flat',
  sharp: 'sharp',
  inTune: 'in tune',
  trace: 'Trace',
  traceLabel: 'Pitch trace: show how the pitch moved',
  cents: 'ct',
  errDenied: 'The microphone is blocked. Allow it for this site in the browser settings, then step on ON again.',
  errNoMic: 'No microphone found. Connect one and step on ON again.',
  errInsecure: 'The tuner needs a secure connection. Open this page over https.',
  errUnsupported: 'This browser cannot listen to the microphone. Try a current Chrome, Safari or Firefox.',
  errFailed: 'The microphone could not start. Step on ON to try again.',
  shortcuts: 'Space: start/stop · T: tap · ↑↓ or digits: tempo',
};

type Dict = typeof en;

const de: Dict = {
  appTitle: 'Tactus',
  tagline: 'Metronom und Stimmgerät',
  language: 'Sprache',
  pedals: 'Pedale',
  install: 'Installieren',
  updateReady: 'Update bereit',
  reload: 'Neu laden',
  offlineReady: 'Offline bereit',

  tempo: 'Tempo',
  tempoPedal: 'Tempo-Pedal (Metronom)',
  bpm: 'BPM',
  beats: 'Takt',
  subdiv: 'Teilung',
  voice: 'Klang',
  level: 'Pegel',
  tap: 'Tap',
  on: 'An',
  start: 'Metronom starten',
  stop: 'Metronom stoppen',
  tapTempo: 'Tempo tippen',
  tempoEntry: 'Tempo eingeben',
  a4Entry: 'Kammerton A4 in Hz eingeben',
  voices: ['Klick', 'Holz', 'Piep', 'Claves', 'Nur Licht, kein Ton'],
  subdivNames: ['Viertel', 'Achtel', 'Punktierter Shuffle (punktierte Achtel und Sechzehntel)', 'Triolen', 'Triolen-Shuffle (mittlere Triole stumm)', 'Sechzehntel'],
  beatsPerBar: (n: number) => `${n} ${n === 1 ? 'Schlag' : 'Schläge'} pro Takt`,
  beatLabel: (n: number, accent: string) => `Schlag ${n}: ${accent}. Antippen zum Ändern.`,
  accents: ['stumm', 'normal', 'betont'],
  accentHint: 'Licht antippen: Betonung ändern',
  flashWarning: 'Achtung: blinkt mehr als 3-mal pro Sekunde. Risiko bei fotosensitiver Epilepsie.',
  flashOffReduced: 'Bewegung reduzieren ist an: über 180 BPM blinkt die Anzeige nicht.',
  pendulum: 'Pendel',
  pendulumLabel: 'Pendel: schwingt zu jedem Schlag',

  tuner: 'Stimmer',
  tunerPedal: 'Stimmgerät-Pedal',
  calib: 'A4',
  calibLabel: 'Kammerton A4',
  transpose: 'Transp.',
  transposeLabel: 'Stimmung des Instruments',
  instrumentIn: (k: string) => `Instrument in ${k}`,
  ref: 'Ref',
  refNote: 'Ton',
  refNoteLabel: 'Referenzton',
  refPlaying: 'Referenz',
  refLabel: 'Referenzton spielen',
  refStop: 'Referenzton aus',
  listenStart: 'Stimmgerät starten (nutzt das Mikrofon)',
  listenStop: 'Stimmgerät stoppen',
  tunerIdle: 'Auf AN treten, dann einen Ton spielen.',
  tunerPrivacy: 'Der Ton bleibt auf diesem Gerät.',
  tunerStarting: 'Warte auf das Mikrofon …',
  tunerListening: 'Spiel einen Ton',
  flat: 'zu tief',
  sharp: 'zu hoch',
  inTune: 'gestimmt',
  trace: 'Verlauf',
  traceLabel: 'Tonhöhenverlauf: zeigt, wie sich der Ton bewegt hat',
  cents: 'ct',
  errDenied: 'Das Mikrofon ist blockiert. In den Website-Einstellungen des Browsers erlauben, dann wieder auf AN treten.',
  errNoMic: 'Kein Mikrofon gefunden. Eins anschließen und wieder auf AN treten.',
  errInsecure: 'Das Stimmgerät braucht eine sichere Verbindung. Seite über https öffnen.',
  errUnsupported: 'Dieser Browser kann nicht aufs Mikrofon hören. Ein aktuelles Chrome, Safari oder Firefox geht.',
  errFailed: 'Das Mikrofon ist nicht angesprungen. Auf AN treten, um es nochmal zu versuchen.',
  shortcuts: 'Leertaste: Start/Stopp · T: Tap · ↑↓ oder Ziffern: Tempo',
};

const dicts: Record<Lang, Dict> = { en, de };

export function detectLang(): Lang {
  for (const l of navigator.languages ?? [navigator.language]) {
    if (l.toLowerCase().startsWith('de')) return 'de';
    if (l.toLowerCase().startsWith('en')) return 'en';
  }
  return 'en';
}

export let lang: Lang = 'en';
export let t: Dict = en;

const listeners = new Set<() => void>();
export function setLang(l: Lang) {
  lang = l;
  t = dicts[l];
  document.documentElement.lang = l;
  for (const fn of listeners) fn();
}
export function onLang(fn: () => void) {
  listeners.add(fn);
}

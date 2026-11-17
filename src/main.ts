import '@fontsource-variable/archivo/wdth.css';
import './styles/main.css';
import { registerSW } from 'virtual:pwa-register';
import { detectLang, lang, onLang, setLang, t, type Lang } from './i18n';
import { load, save } from './store';
import { h } from './ui/dom';
import { downloadIcon } from './ui/icons';
import { led } from './ui/switch';
import { tempoPedal } from './ui/tempo-pedal';
import { tunerPedal } from './ui/tuner-pedal';

const settings = load();
setLang(settings.lang ?? detectLang());

const tempo = tempoPedal(settings.tempo, (c) => {
  settings.tempo = c;
  save(settings);
});
const tuner = tunerPedal(settings.tuner, (c) => {
  settings.tuner = c;
  save(settings);
});

// ── Header: wordmark, pedal tabs (phones), install/update, language ──────────
const pedals = [
  { id: 'tempo', el: tempo.el, name: () => t.tempo },
  { id: 'tuner', el: tuner.el, name: () => t.tuner },
];

const tabs = pedals.map((p) => {
  const label = h('span', { class: 'silk' });
  const light = led('red', 'tab-led');
  const b = h(
    'button',
    {
      type: 'button',
      class: `tab tab--${p.id}`,
      'aria-controls': `pedal-${p.id}`,
      onclick: () => p.el.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', inline: 'center', block: 'nearest' }),
    },
    light,
    label,
  );
  return { ...p, b, label, light };
});
tempo.metronome.onState((on) => tabs[0].light.classList.toggle('is-on', on));
tuner.tuner.onState((s) => tabs[1].light.classList.toggle('is-on', s === 'listening'));

const langBtn = h(
  'button',
  {
    type: 'button',
    class: 'lang',
    onclick: () => {
      const next: Lang = lang === 'en' ? 'de' : 'en';
      settings.lang = next;
      save(settings);
      setLang(next);
    },
  },
  h('span', { class: 'silk lang-opt', 'data-l': 'en' }, 'EN'),
  h('span', { class: 'lang-toggle', 'aria-hidden': 'true' }, h('span', { class: 'lang-bat' })),
  h('span', { class: 'silk lang-opt', 'data-l': 'de' }, 'DE'),
);

const installBtn = h('button', { type: 'button', class: 'plate', hidden: true }, downloadIcon(), h('span', {}));
const updateBtn = h(
  'button',
  { type: 'button', class: 'plate plate--update', hidden: true },
  led('red', 'plate-led is-on'),
  h('span', { class: 'plate-long' }),
  h('span', {}),
);
const nav = h('nav', { class: 'tabs' }, ...tabs.map((x) => x.b));

const header = h(
  'header',
  { class: 'board-head' },
  h('span', { class: 'wordmark', translate: 'no' }, 'Tactus'),
  nav,
  h('div', { class: 'head-tools' }, updateBtn, installBtn, langBtn),
);

const rack = h(
  'div',
  { class: 'rack' },
  tempo.el,
  h(
    'div',
    { class: 'cable', 'aria-hidden': 'true' },
    // a patch cable from jack to jack, sagging under its own weight
    (() => {
      const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      s.setAttribute('viewBox', '0 0 100 100');
      s.setAttribute('preserveAspectRatio', 'none');
      s.innerHTML =
        '<path class="cable-shadow" d="M20 23 C 20 37, 30 40, 50 40 S 80 37, 80 23"/><path class="cable-line" d="M20 22 C 20 36, 30 39, 50 39 S 80 36, 80 22"/>';
      return s;
    })(),
    h('span', { class: 'plug plug--l' }),
    h('span', { class: 'plug plug--r' }),
  ),
  tuner.el,
);
const foot = h('p', { class: 'board-foot silk' });
const main = h('main', { class: 'board' }, rack, foot);
document.getElementById('app')!.replaceChildren(header, main);

function relabel() {
  tabs.forEach((x) => {
    x.label.textContent = x.name();
  });
  nav.setAttribute('aria-label', t.pedals);
  langBtn.setAttribute('aria-label', `${t.language}: ${lang === 'de' ? 'Deutsch' : 'English'}`);
  langBtn.dataset.lang = lang;
  installBtn.lastElementChild!.textContent = t.install;
  installBtn.setAttribute('aria-label', t.install);
  updateBtn.querySelector('.plate-long')!.textContent = `${t.updateReady} · `;
  updateBtn.lastElementChild!.textContent = t.reload;
  updateBtn.setAttribute('aria-label', `${t.updateReady}: ${t.reload}`);
  foot.textContent = t.shortcuts;
  document.title = `Tactus · ${t.tagline}`;
}
onLang(relabel);
relabel();

// Which pedal is in front (phones): the tab follows the scroll; the most visible pedal wins.
const ratios = new Map<Element, number>();
const io = new IntersectionObserver(
  (entries) => {
    for (const e of entries) ratios.set(e.target, e.intersectionRatio);
    let best = tabs[0];
    for (const x of tabs) if ((ratios.get(x.el) ?? 0) > (ratios.get(best.el) ?? 0)) best = x;
    tabs.forEach((x) => x.b.setAttribute('aria-current', String(x === best)));
  },
  { root: rack, threshold: [0, 0.25, 0.5, 0.75, 1] },
);
pedals.forEach((p) => io.observe(p.el));

// ── Keyboard ────────────────────────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const el = e.target instanceof Element ? e.target : document.body;
  const busy = el.closest('button, input, select, textarea, [role="slider"]');
  if (e.key === ' ' && !busy) {
    e.preventDefault();
    tempo.toggle();
  } else if ((e.key === 't' || e.key === 'T') && !el.closest('input, textarea')) {
    tempo.tap();
  } else if (/^[0-9]$/.test(e.key) && !el.closest('input, textarea')) {
    // Typing a number anywhere sets the tempo.
    e.preventDefault();
    tempo.enter(e.key);
  } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !busy) {
    e.preventDefault();
    tempo.nudge((e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1));
  }
});

// ── Install and offline ─────────────────────────────────────────────────────
interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: string }>;
}
let deferred: InstallPrompt | null = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferred = e as InstallPrompt;
  installBtn.hidden = false;
});
installBtn.addEventListener('click', async () => {
  if (!deferred) return;
  installBtn.hidden = true;
  await deferred.prompt();
  deferred = null;
});
window.addEventListener('appinstalled', () => {
  installBtn.hidden = true;
});

// New versions: the service worker downloads them in the background and the
// header shows an "Update ready" plate. Nothing reloads under a playing musician;
// the switch happens when the plate is tapped.
if (import.meta.env.PROD) {
  const update = registerSW({
    onNeedRefresh() {
      updateBtn.hidden = false;
    },
    onRegisteredSW(_url, reg) {
      if (!reg) return;
      // Installed apps are resumed, not reloaded, so ask the server again when the
      // app comes back to the front (at most every 30 min) and hourly while open.
      let last = Date.now();
      const check = (minGap: number) => {
        if (!navigator.onLine || Date.now() - last < minGap) return;
        last = Date.now();
        reg.update().catch(() => {
          /* offline or server unreachable: try again later */
        });
      };
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') check(30 * 60_000);
      });
      setInterval(() => check(0), 60 * 60_000);
    },
  });
  updateBtn.addEventListener('click', () => {
    updateBtn.disabled = true;
    void update(true);
  });
}

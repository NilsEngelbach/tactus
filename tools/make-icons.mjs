// Renders the app icons from one authored SVG (the Tempo pedal, seen from above).
//   npm run icons
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';

const pedal = (pad) => `
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#141416"/>
  <g transform="translate(${256 - (256 - pad) * 0.75} ${pad}) scale(${((512 - 2 * pad) / 512)})">
    <rect x="0" y="0" width="${0.75 * 512}" height="512" rx="44" fill="#b83a28"/>
    <rect x="0" y="0" width="${0.75 * 512}" height="512" rx="44" fill="url(#hi)"/>
    <rect x="40" y="44" width="304" height="196" rx="18" fill="#0a0b0a"/>
    <path d="M110 92h164v34h-64v84h-36v-84h-64z" fill="#f7f0e1"/>
    <circle cx="192" cy="384" r="74" fill="#8c8f93"/>
    <circle cx="192" cy="384" r="56" fill="url(#cap)"/>
    <circle cx="318" cy="292" r="15" fill="#ff3d2e"/>
  </g>
  <defs>
    <linearGradient id="hi" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".14"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/></linearGradient>
    <radialGradient id="cap" cx=".38" cy=".3" r=".8"><stop offset="0" stop-color="#fff"/><stop offset=".45" stop-color="#a0a3a7"/><stop offset="1" stop-color="#3e4044"/></radialGradient>
  </defs>
</svg>`;

mkdirSync('public/pwa', { recursive: true });
const jobs = [
  ['public/pwa/icon-192.png', 192, 40],
  ['public/pwa/icon-512.png', 512, 40],
  ['public/pwa/maskable-512.png', 512, 96],
  ['public/apple-touch-icon.png', 180, 56],
];
for (const [file, size, pad] of jobs) {
  await sharp(Buffer.from(pedal(pad))).resize(size, size).png().toFile(file);
  console.log(file);
}

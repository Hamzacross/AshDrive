// Generates the app icon and tray icons from inline SVG using sharp.
// Run: npm run icon
import sharp from 'sharp';
import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const buildDir = join(__dirname, '..', 'build');
const assetsDir = join(__dirname, '..', 'src', 'assets');

const appIconSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#4f46e5"/>
      <stop offset="1" stop-color="#06b6d4"/>
    </linearGradient>
  </defs>
  <rect x="64" y="64" width="896" height="896" rx="224" fill="url(#bg)"/>
  <!-- USB drive body -->
  <rect x="370" y="360" width="240" height="380" rx="56" fill="#ffffff"/>
  <!-- connector neck -->
  <rect x="460" y="240" width="92" height="130" fill="#e2e8f0"/>
  <!-- metal tip -->
  <rect x="440" y="180" width="132" height="72" rx="14" fill="#cbd5e1"/>
  <rect x="462" y="198" width="24" height="44" rx="4" fill="#94a3b8"/>
  <rect x="526" y="198" width="24" height="44" rx="4" fill="#94a3b8"/>
  <!-- label panel -->
  <rect x="410" y="470" width="160" height="200" rx="28" fill="#4f46e5" opacity="0.16"/>
  <circle cx="490" cy="570" r="14" fill="#4f46e5" opacity="0.5"/>
  <!-- green backup badge with circular arrow -->
  <circle cx="704" cy="704" r="150" fill="#22c55e"/>
  <path d="M704 612 A92 92 0 1 1 612 704" fill="none" stroke="#ffffff" stroke-width="26" stroke-linecap="round"/>
  <polygon points="744,612 676,586 676,638" fill="#ffffff"/>
</svg>`;

// macOS menu bar: black on transparent (template image)
const trayTemplateSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
  <rect x="22" y="30" width="20" height="28" rx="5" fill="#000"/>
  <rect x="28" y="14" width="8" height="16" fill="#000"/>
  <rect x="26" y="6" width="12" height="10" rx="2" fill="#000"/>
</svg>`;

// Windows tray: small gradient tile with white USB glyph
const trayWinSvg = `
<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#4f46e5"/>
      <stop offset="1" stop-color="#06b6d4"/>
    </linearGradient>
  </defs>
  <rect x="2" y="2" width="28" height="28" rx="8" fill="url(#g)"/>
  <rect x="11" y="13" width="10" height="14" rx="3" fill="#fff"/>
  <rect x="14" y="7" width="4" height="6" fill="#fff"/>
</svg>`;

// Brand logo used in the UI header (reuses the app-icon art)
const logoSvg = appIconSvg.replace('width="1024" height="1024"', 'width="128" height="128"');

await mkdir(buildDir, { recursive: true });
await mkdir(assetsDir, { recursive: true });

await sharp(Buffer.from(appIconSvg)).png().toFile(join(buildDir, 'icon.png'));
await sharp(Buffer.from(trayTemplateSvg)).png().toFile(join(buildDir, 'trayTemplate.png'));
await sharp(Buffer.from(trayWinSvg)).png().toFile(join(buildDir, 'tray.png'));

const { writeFile } = await import('node:fs/promises');
await writeFile(join(assetsDir, 'logo.svg'), logoSvg.trim() + '\n', 'utf8');

console.log('Generated: build/icon.png, build/trayTemplate.png, build/tray.png, src/assets/logo.svg');

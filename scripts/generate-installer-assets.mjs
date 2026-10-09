// Deterministic, code-drawn installer artwork. The existing logo is embedded unchanged.
// Optional renderer is installed outside the project; see src-tauri/installer/README.md.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { Resvg } = require(process.argv[2] || '@resvg/resvg-js');
const output = path.join(root, 'src-tauri/installer/assets');
fs.mkdirSync(output, { recursive: true });
const logo = `data:image/png;base64,${fs.readFileSync(path.join(root, 'src-tauri/icons/128x128@2x.png')).toString('base64')}`;
const svg = (width, height, content) => `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><linearGradient id="night" x2="0.8" y2="1"><stop stop-color="#071922"/><stop offset="1" stop-color="#151126"/></linearGradient><linearGradient id="accent"><stop stop-color="#55e6ec"/><stop offset="1" stop-color="#b97bf5"/></linearGradient></defs>${content}</svg>`;
const mark = (x, y, size) => `<image href="${logo}" x="${x}" y="${y}" width="${size}" height="${size}"/>`;
const text = (x, y, size, color, value, weight = 400) => `<text x="${x}" y="${y}" font-family="Segoe UI, Arial, sans-serif" font-size="${size}" font-weight="${weight}" fill="${color}">${value}</text>`;
const sidebar = (height) => `<rect width="164" height="${height}" fill="url(#night)"/><path d="M22 26H68 M22 27V29" stroke="#55e6ec" stroke-width="2"/>${mark(28, 48, 108)}${text(22, 186, 24, '#f0f7fb', 'FlashRun', 600)}${text(23, 208, 9, '#80c9d7', 'PROJECT WORKSPACE', 500)}<rect x="23" y="232" width="118" height="1" fill="#354253"/>${text(23, 254, 11, '#c3ceda', 'One workspace.')}${text(23, 271, 11, '#c3ceda', 'Every project.')}<rect y="${height - 3}" width="164" height="3" fill="url(#accent)"/>`;
const artworks = [
  { name: 'nsis-sidebar', width: 164, height: 314, content: sidebar(314) },
  { name: 'nsis-header', width: 150, height: 57, content: `<rect width="150" height="57" fill="white"/>${mark(5, 8, 40)}${text(53, 28, 16, '#162331', 'FlashRun', 600)}${text(54, 42, 8, '#617184', 'Run. Build. Repeat.')}` },
  // WiX draws its own title/body text over these images. Keep those areas white.
  { name: 'wix-banner', width: 493, height: 58, content: `<rect width="493" height="58" fill="white"/><rect x="426" y="13" width="1" height="32" fill="#d8e5ec"/>${mark(439, 7, 44)}` },
  { name: 'wix-dialog', width: 493, height: 312, content: `<rect width="493" height="312" fill="white"/>${sidebar(312)}` },
];

function render(source) {
  return new Resvg(source, { font: { loadSystemFonts: true, defaultFontFamily: 'Segoe UI' } }).render();
}

// Windows installers expect conventional uncompressed, opaque 24-bit BMP files.
function bitmap(image) {
  const { width, height, pixels } = image;
  const stride = (width * 3 + 3) & ~3;
  const result = Buffer.alloc(54 + stride * height);
  result.write('BM');
  result.writeUInt32LE(result.length, 2);
  result.writeUInt32LE(54, 10);
  result.writeUInt32LE(40, 14);
  result.writeInt32LE(width, 18);
  result.writeInt32LE(height, 22);
  result.writeUInt16LE(1, 26);
  result.writeUInt16LE(24, 28);
  result.writeUInt32LE(stride * height, 34);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const source = (y * width + x) * 4;
      if (pixels[source + 3] !== 255) throw new Error('Artwork must be fully opaque');
      const dest = 54 + (height - 1 - y) * stride + x * 3;
      result[dest] = pixels[source + 2];
      result[dest + 1] = pixels[source + 1];
      result[dest + 2] = pixels[source];
    }
  }
  return result;
}

const previews = new Map();
for (const asset of artworks) {
  const source = svg(asset.width, asset.height, asset.content);
  const image = render(source);
  fs.writeFileSync(path.join(output, `${asset.name}.bmp`), bitmap(image));
  previews.set(asset.name, `data:image/png;base64,${image.asPng().toString('base64')}`);
  console.log(`${asset.name}.bmp: ${image.width} x ${image.height}, 24-bit BMP`);
}

// Asset board only: deliberately not a simulated installer screenshot.
const preview = svg(1040, 730, `<rect width="1040" height="730" fill="#eef2f6"/>${text(34, 43, 25, '#142234', 'FlashRun / Installer artwork', 600)}${text(35, 69, 13, '#53657b', 'ASSET PREVIEW ONLY — NOT AN INSTALLER SCREENSHOT')}${text(35, 107, 13, '#31485c', 'EXE · Welcome / finish sidebar · 164 × 314')}
<image href="${previews.get('nsis-sidebar')}" x="35" y="124" width="246" height="471"/>
${text(329, 107, 13, '#31485c', 'EXE · Page header · 150 × 57')}<image href="${previews.get('nsis-header')}" x="330" y="124" width="300" height="114"/>
${text(329, 278, 13, '#31485c', 'MSI · Page banner · 493 × 58')}<image href="${previews.get('wix-banner')}" x="330" y="293" width="493" height="58"/>
${text(329, 389, 13, '#31485c', 'MSI · Welcome / finish background · 493 × 312')}<image href="${previews.get('wix-dialog')}" x="330" y="404" width="493" height="312"/>
${text(35, 630, 12, '#53657b', 'Original FlashRun logo.')}${text(35, 650, 12, '#53657b', 'Cyan / violet accents.')}${text(35, 670, 12, '#53657b', 'Native installer controls retained.')}`);
fs.writeFileSync(path.join(root, 'src-tauri/installer/preview.png'), render(preview).asPng());

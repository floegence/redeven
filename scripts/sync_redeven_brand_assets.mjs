import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const brandDir = path.join(repoRoot, 'assets', 'brand', 'redeven');
const svgDir = path.join(brandDir, 'svg');
const pngDir = path.join(brandDir, 'png');
const icoDir = path.join(brandDir, 'ico');
const icnsDir = path.join(brandDir, 'icns');

const appIconSvg = path.join(svgDir, 'app-icon.svg');
const faviconSvg = path.join(svgDir, 'favicon.svg');
const logoLightSvg = path.join(svgDir, 'logo-light.svg');
const logoDarkSvg = path.join(svgDir, 'logo-dark.svg');
const logoMarkHorizontalLightSvg = path.join(svgDir, 'logo-mark-horizontal-light.svg');
const logoMarkHorizontalDarkSvg = path.join(svgDir, 'logo-mark-horizontal-dark.svg');

const appIconPngSizes = [16, 32, 48, 64, 128, 256, 512, 1024];
const faviconPngSizes = [16, 32, 48, 64, 128, 256];
const logoPngSizes = [128, 256, 512, 1024];
const horizontalLogoWidths = [512, 1024, 1536];

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function run(command, args) {
  execFileSync(command, args, { cwd: repoRoot, stdio: 'inherit' });
}

function copy(source, target) {
  ensureDir(path.dirname(target));
  fs.copyFileSync(source, target);
}

function renderPng(svgPath, targetPath, width, height = width) {
  ensureDir(path.dirname(targetPath));
  execFileSync('sips', ['-s', 'format', 'png', '-z', String(height), String(width), svgPath, '--out', targetPath], {
    cwd: repoRoot,
    stdio: 'ignore',
  });
}

function buildPngIco(pngPaths, targetPath) {
  ensureDir(path.dirname(targetPath));
  const images = pngPaths.map((pngPath) => {
    const size = Number(path.basename(pngPath).match(/-(\d+)\.png$/u)?.[1]);
    if (!Number.isInteger(size) || size <= 0 || size > 256) {
      throw new Error(`ICO input must end with a 1..256 size suffix: ${pngPath}`);
    }
    return {
      size,
      data: fs.readFileSync(pngPath),
    };
  });

  const headerSize = 6;
  const entrySize = 16;
  const directorySize = headerSize + images.length * entrySize;
  let imageOffset = directorySize;
  const directory = Buffer.alloc(directorySize);
  directory.writeUInt16LE(0, 0);
  directory.writeUInt16LE(1, 2);
  directory.writeUInt16LE(images.length, 4);

  images.forEach((image, index) => {
    const entryOffset = headerSize + index * entrySize;
    directory.writeUInt8(image.size === 256 ? 0 : image.size, entryOffset);
    directory.writeUInt8(image.size === 256 ? 0 : image.size, entryOffset + 1);
    directory.writeUInt8(0, entryOffset + 2);
    directory.writeUInt8(0, entryOffset + 3);
    directory.writeUInt16LE(1, entryOffset + 4);
    directory.writeUInt16LE(32, entryOffset + 6);
    directory.writeUInt32LE(image.data.length, entryOffset + 8);
    directory.writeUInt32LE(imageOffset, entryOffset + 12);
    imageOffset += image.data.length;
  });

  fs.writeFileSync(targetPath, Buffer.concat([directory, ...images.map((image) => image.data)]));
}

function buildIcns() {
  const iconsetDir = path.join(brandDir, 'generated.iconset');
  fs.rmSync(iconsetDir, { recursive: true, force: true });
  ensureDir(iconsetDir);

  const iconsetEntries = [
    ['icon_16x16.png', 16],
    ['icon_16x16@2x.png', 32],
    ['icon_32x32.png', 32],
    ['icon_32x32@2x.png', 64],
    ['icon_128x128.png', 128],
    ['icon_128x128@2x.png', 256],
    ['icon_256x256.png', 256],
    ['icon_256x256@2x.png', 512],
    ['icon_512x512.png', 512],
    ['icon_512x512@2x.png', 1024],
  ];

  for (const [name, size] of iconsetEntries) {
    renderPng(appIconSvg, path.join(iconsetDir, name), size);
  }

  run('iconutil', ['-c', 'icns', iconsetDir, '-o', path.join(icnsDir, 'app-icon.icns')]);
  fs.rmSync(iconsetDir, { recursive: true, force: true });
}

ensureDir(pngDir);
ensureDir(icoDir);
ensureDir(icnsDir);

for (const size of appIconPngSizes) {
  renderPng(appIconSvg, path.join(pngDir, `app-icon-${size}.png`), size);
}

for (const size of faviconPngSizes) {
  renderPng(faviconSvg, path.join(pngDir, `favicon-${size}.png`), size);
}

for (const size of logoPngSizes) {
  renderPng(logoLightSvg, path.join(pngDir, `logo-light-${size}.png`), size);
  renderPng(logoDarkSvg, path.join(pngDir, `logo-dark-${size}.png`), size);
}

for (const width of horizontalLogoWidths) {
  const height = Math.round(width / 3);
  renderPng(logoMarkHorizontalLightSvg, path.join(pngDir, `logo-mark-horizontal-light-${width}x${height}.png`), width, height);
  renderPng(logoMarkHorizontalDarkSvg, path.join(pngDir, `logo-mark-horizontal-dark-${width}x${height}.png`), width, height);
}

buildPngIco(
  appIconPngSizes.filter((size) => size <= 256).map((size) => path.join(pngDir, `app-icon-${size}.png`)),
  path.join(icoDir, 'app-icon.ico'),
);
buildPngIco(
  faviconPngSizes.filter((size) => size <= 256).map((size) => path.join(pngDir, `favicon-${size}.png`)),
  path.join(icoDir, 'favicon.ico'),
);
buildIcns();

copy(appIconSvg, path.join(repoRoot, 'desktop', 'build', 'icon.svg'));
copy(path.join(pngDir, 'app-icon-512.png'), path.join(repoRoot, 'desktop', 'build', 'icon.png'));
copy(path.join(icnsDir, 'app-icon.icns'), path.join(repoRoot, 'desktop', 'build', 'icon.icns'));

copy(faviconSvg, path.join(repoRoot, 'internal', 'envapp', 'ui_src', 'public', 'favicon.svg'));
copy(logoLightSvg, path.join(repoRoot, 'internal', 'envapp', 'ui_src', 'public', 'logo.svg'));
copy(logoDarkSvg, path.join(repoRoot, 'internal', 'envapp', 'ui_src', 'public', 'logo-dark.svg'));
copy(path.join(pngDir, 'logo-light-512.png'), path.join(repoRoot, 'internal', 'envapp', 'ui_src', 'public', 'logo.png'));

console.log('Redeven brand assets synced.');

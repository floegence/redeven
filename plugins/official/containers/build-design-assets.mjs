import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const APPICA_VERSION = '1.0.0';
const LUCIDE_VERSION = '1.27.0';
const APPICA_TOKENS = ['--radius-sm', '--radius-md', '--shadow-sm', '--shadow-md', '--text-xs', '--text-sm'];
const ICONS = [
  'activity', 'box', 'boxes', 'circle-stop', 'database', 'download', 'ellipsis',
  'folder-kanban', 'images', 'layout-dashboard', 'minus', 'package-plus', 'play',
  'plus', 'refresh-cw', 'rotate-cw', 'search', 'square', 'trash-2', 'x',
];

export async function generateDesignAssets(root, dist) {
  const licensesRoot = join(dist, 'licenses');
  const iconAssetsRoot = join(dist, 'ui', 'assets', 'icons');
  mkdirSync(licensesRoot, { recursive: true });
  mkdirSync(iconAssetsRoot, { recursive: true });
  const appicaRoot = join(root, 'node_modules', '@appica', 'ui-react');
  assertPackageVersion(appicaRoot, '@appica/ui-react', APPICA_VERSION);
  const appicaSource = readFileSync(join(appicaRoot, 'styles.css'), 'utf8');
  for (const token of APPICA_TOKENS) {
    if (!appicaSource.includes(token)) throw new Error('Appica UI design token is missing: ' + token);
  }
  writeFileSync(join(dist, 'ui', 'assets', 'appica-theme.css'), appicaThemeCSS());
  cpSync(join(appicaRoot, 'LICENSE'), join(licensesRoot, 'appica-ui-MIT.txt'));

  const lucideRoot = join(root, 'node_modules', 'lucide-static');
  assertPackageVersion(lucideRoot, 'lucide-static', LUCIDE_VERSION);
  const rules = await Promise.all(ICONS.map(async (name) => {
    const source = readFileSync(join(lucideRoot, 'icons', name + '.svg'), 'utf8');
    if (!source.includes('<svg') || !source.includes('</svg>')) {
      throw new Error('Lucide SVG icon is invalid: ' + name);
    }
    const svg = source
      .replace(/\r?\n|\t/gu, ' ')
      .replace(/\s{2,}/gu, ' ')
      .replaceAll('currentColor', '#000000')
      .trim();
    await sharp(Buffer.from(svg)).resize(48, 48).png({ compressionLevel: 9, palette: true }).toFile(join(iconAssetsRoot, name + '.png'));
    return '.lucide-' + name + '::before { --lucide-icon: url("icons/' + name + '.png"); }';
  }));
  cpSync(join(lucideRoot, 'LICENSE'), join(licensesRoot, 'lucide-ISC-MIT.txt'));
  writeFileSync(join(dist, 'ui', 'assets', 'lucide-icons.css'), lucideCSS(rules));
}

function assertPackageVersion(root, name, expected) {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  if (manifest.version !== expected) {
    throw new Error('expected ' + name + '@' + expected + ', found ' + String(manifest.version ?? 'missing'));
  }
}

function appicaThemeCSS() {
  return [
    '/* Generated from @appica/ui-react@1.0.0 design tokens. Host colors remain authoritative. */',
    ':root {',
    '  --appica-radius-control: 6px;',
    '  --appica-radius-panel: 8px;',
    '  --appica-shadow-xs: 0 1px 4px 0 color-mix(in srgb, var(--redevplugin-color-text, #20252c) 8%, transparent);',
    '  --appica-shadow-sm: 0 2px 8px -2px color-mix(in srgb, var(--redevplugin-color-text, #20252c) 14%, transparent);',
    '  --appica-shadow-md: 0 4px 8px -2px color-mix(in srgb, var(--redevplugin-color-text, #20252c) 18%, transparent);',
    '  --appica-duration-fast: 150ms;',
    '  --appica-duration-base: 180ms;',
    '  --appica-ease-out: cubic-bezier(.2, .8, .2, 1);',
    '}',
    '',
  ].join('\n');
}

function lucideCSS(rules) {
  return [
    '/* Generated from lucide-static@1.27.0. */',
    '/* Package-local masks are rewritten to opaque surface asset bindings by ReDevPlugin. */',
    '.lucide-icon::before { content: ""; display: block; width: 1em; height: 1em; flex: 0 0 auto; background-color: currentColor; -webkit-mask: var(--lucide-icon) center / contain no-repeat; mask: var(--lucide-icon) center / contain no-repeat; }',
    ...rules,
    '',
  ].join('\n');
}

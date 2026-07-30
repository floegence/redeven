import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const APPICA_VERSION = '1.0.0';
const LUCIDE_VERSION = '1.27.0';
const APPICA_TOKENS = ['--radius-sm', '--radius-md', '--shadow-sm', '--shadow-md', '--text-xs', '--text-sm'];
const ICONS = [
  'activity', 'box', 'boxes', 'circle-stop', 'database', 'download', 'ellipsis',
  'folder-kanban', 'images', 'layout-dashboard', 'minus', 'package-plus', 'play',
  'plus', 'refresh-cw', 'rotate-cw', 'search', 'square', 'trash-2', 'x',
];

export function generateDesignAssets(root, dist) {
  const licensesRoot = join(dist, 'licenses');
  mkdirSync(licensesRoot, { recursive: true });
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
  const codepoints = JSON.parse(readFileSync(join(lucideRoot, 'font', 'codepoints.json'), 'utf8'));
  const rules = ICONS.map((name) => {
    const codepoint = codepoints[name];
    if (!Number.isInteger(codepoint)) throw new Error('Lucide codepoint is missing: ' + name);
    return '.lucide-' + name + '::before { content: "\\' + codepoint.toString(16) + '"; }';
  });
  cpSync(join(lucideRoot, 'font', 'lucide.woff2'), join(dist, 'ui', 'assets', 'lucide.woff2'));
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
    '@font-face { font-family: "Lucide"; src: url("lucide.woff2") format("woff2"); font-display: block; }',
    '.lucide-icon::before { display: block; font-family: "Lucide"; font-style: normal; font-weight: 400; line-height: 1; speak: never; -webkit-font-smoothing: antialiased; }',
    ...rules,
    '',
  ].join('\n');
}

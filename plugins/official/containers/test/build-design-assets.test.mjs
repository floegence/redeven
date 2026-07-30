import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { generateDesignAssets } from '../build-design-assets.mjs';

const requiredAppicaTokens = ['--radius-sm', '--radius-md', '--shadow-sm', '--shadow-md', '--text-xs', '--text-sm'];
const requiredLucideIcons = [
  'activity', 'box', 'boxes', 'circle-stop', 'database', 'download', 'ellipsis',
  'folder-kanban', 'images', 'layout-dashboard', 'minus', 'package-plus', 'play',
  'plus', 'refresh-cw', 'rotate-cw', 'search', 'square', 'trash-2', 'x',
];

test('generates a bounded Appica token bridge and Lucide font subset', async () => {
  const fixture = await designFixture();
  generateDesignAssets(fixture.root, fixture.dist);
  const theme = await readFile(join(fixture.dist, 'ui', 'assets', 'appica-theme.css'), 'utf8');
  const icons = await readFile(join(fixture.dist, 'ui', 'assets', 'lucide-icons.css'), 'utf8');
  const font = await readFile(join(fixture.dist, 'ui', 'assets', 'lucide.woff2'), 'utf8');
  const appicaLicense = await readFile(join(fixture.dist, 'licenses', 'appica-ui-MIT.txt'), 'utf8');
  const lucideLicense = await readFile(join(fixture.dist, 'licenses', 'lucide-ISC-MIT.txt'), 'utf8');
  assert.match(theme, /@appica\/ui-react@1\.0\.0/u);
  assert.match(theme, /--appica-radius-control/u);
  assert.match(icons, /lucide-static@1\.27\.0/u);
  const generatedRules = icons.match(/\.lucide-(?!icon\b)[a-z0-9-]+::before/g) ?? [];
  assert.equal(generatedRules.length, requiredLucideIcons.length);
  assert.equal(font, 'font-fixture');
  assert.equal(appicaLicense, 'appica-license-fixture');
  assert.equal(lucideLicense, 'lucide-license-fixture');
});

test('fails closed when Appica tokens or Lucide codepoints drift', async () => {
  const missingToken = await designFixture({ appicaTokens: requiredAppicaTokens.slice(1) });
  assert.throws(() => generateDesignAssets(missingToken.root, missingToken.dist), /design token is missing/u);
  const missingIcon = await designFixture({ lucideIcons: requiredLucideIcons.slice(1) });
  assert.throws(() => generateDesignAssets(missingIcon.root, missingIcon.dist), /codepoint is missing/u);
});

test('fails closed when a design dependency version changes', async () => {
  const fixture = await designFixture({ appicaVersion: '1.0.1' });
  assert.throws(() => generateDesignAssets(fixture.root, fixture.dist), /expected @appica\/ui-react@1\.0\.0/u);
});

async function designFixture({ appicaTokens = requiredAppicaTokens, lucideIcons = requiredLucideIcons, appicaVersion = '1.0.0' } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'redeven-containers-design-'));
  const dist = join(root, 'dist');
  const appica = join(root, 'node_modules', '@appica', 'ui-react');
  const lucide = join(root, 'node_modules', 'lucide-static');
  await mkdir(join(dist, 'ui', 'assets'), { recursive: true });
  await mkdir(appica, { recursive: true });
  await mkdir(join(lucide, 'font'), { recursive: true });
  await writeFile(join(appica, 'package.json'), JSON.stringify({ version: appicaVersion }));
  await writeFile(join(appica, 'styles.css'), appicaTokens.map((token) => token + ': 1px;').join('\n'));
  await writeFile(join(appica, 'LICENSE'), 'appica-license-fixture');
  await writeFile(join(lucide, 'package.json'), JSON.stringify({ version: '1.27.0' }));
  await writeFile(join(lucide, 'font', 'codepoints.json'), JSON.stringify(Object.fromEntries(lucideIcons.map((name, index) => [name, 0xe000 + index]))));
  await writeFile(join(lucide, 'font', 'lucide.woff2'), 'font-fixture');
  await writeFile(join(lucide, 'LICENSE'), 'lucide-license-fixture');
  return { root, dist };
}

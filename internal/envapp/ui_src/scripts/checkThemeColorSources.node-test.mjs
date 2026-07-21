import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  checkThemeColorSources,
  findThemeColorViolations,
  listThemeColorSourceFiles,
  THEME_COLOR_EXCEPTIONS,
} from './checkThemeColorSources.mjs';

function withFixtureRepository(files, callback) {
  const repositoryRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'redeven-theme-colors-'));
  try {
    for (const [relativePath, source] of Object.entries(files)) {
      const absolutePath = path.join(repositoryRoot, relativePath);
      fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
      fs.writeFileSync(absolutePath, source);
    }
    callback(repositoryRoot);
  } finally {
    fs.rmSync(repositoryRoot, { recursive: true, force: true });
  }
}

test('reports raw and fixed Tailwind product colors with their source line', () => {
  const violations = findThemeColorViolations(
    '.panel { color: #58a6ff; }\nconst badge = "text-violet-500";\nconst shadow = "rgba(0,0,0,.2)";',
    'panel.tsx',
    [],
  );

  assert.deepEqual(violations, [
    'panel.tsx:1: replace #58a6ff with a semantic theme token or add a precise owner/path/use exception',
    'panel.tsx:2: replace text-violet-500 with a semantic theme token or add a precise owner/path/use exception',
    'panel.tsx:3: replace rgba(0,0,0,.2) with a semantic theme token or add a precise owner/path/use exception',
  ]);
});

test('accepts semantic variables and color functions derived from them', () => {
  const violations = findThemeColorViolations(
    '.panel { color: var(--redeven-status-info); background: hsl(var(--primary)); }',
    'panel.css',
    [],
  );

  assert.deepEqual(violations, []);
});

test('reports arbitrary-opacity Tailwind colors as one complete violation', () => {
  assert.deepEqual(findThemeColorViolations(
    'const surface = "bg-white/[0.08]";',
    'surface.tsx',
    [],
  ), [
    'surface.tsx:1: replace bg-white/[0.08] with a semantic theme token or add a precise owner/path/use exception',
  ]);
});

test('reports standalone named colors without matching comments or white-space', () => {
  assert.deepEqual(findThemeColorViolations(
    [
      '/* black and white are discussed here. */',
      '.copy { white-space: pre-wrap; }',
      '.surface { color: white; box-shadow: 0 1px black; }',
      'const note = "white"; // black is only a comment',
    ].join('\n'),
    'surface.ts',
    [],
  ), [
    'surface.ts:3: replace white with a semantic theme token or add a precise owner/path/use exception',
    'surface.ts:3: replace black with a semantic theme token or add a precise owner/path/use exception',
    'surface.ts:4: replace white with a semantic theme token or add a precise owner/path/use exception',
  ]);
});

test('does not treat TypeScript color template types as runtime colors', () => {
  assert.deepEqual(findThemeColorViolations(
    'type CssColor = `rgb(${string})` | `hsl(${string})` | `oklch(${string})`;',
    'desktop/src/shared/desktopTheme.ts',
    [],
  ), []);
});

test('recursively discovers Desktop, Env App Git, and Flower production sources but excludes tests', () => {
  withFixtureRepository({
    'desktop/src/welcome/NestedWelcome.css': '.welcome { color: #abcdef; }',
    'desktop/src/welcome/NestedWelcome.test.tsx': 'export const fixture = "text-red-500";',
    'internal/envapp/ui_src/src/ui/widgets/git/NestedGit.tsx': 'export const value = "text-violet-500";',
    'internal/envapp/ui_src/src/ui/widgets/git/NestedGit.test.tsx': 'export const fixture = "text-red-500";',
    'internal/flower_ui/src/chat/NestedFlower.css': '.flower { color: #123456; }',
    'internal/flower_ui/src/chat/NestedFlower.browser.test.tsx': 'export const fixture = "bg-blue-500";',
  }, (repositoryRoot) => {
    const files = listThemeColorSourceFiles(repositoryRoot);
    assert.deepEqual(files, [
      'desktop/src/welcome/NestedWelcome.css',
      'internal/envapp/ui_src/src/ui/widgets/git/NestedGit.tsx',
      'internal/flower_ui/src/chat/NestedFlower.css',
    ]);
    assert.deepEqual(checkThemeColorSources({ repositoryRoot, exceptions: [] }), [
      'desktop/src/welcome/NestedWelcome.css:1: replace #abcdef with a semantic theme token or add a precise owner/path/use exception',
      'internal/envapp/ui_src/src/ui/widgets/git/NestedGit.tsx:1: replace text-violet-500 with a semantic theme token or add a precise owner/path/use exception',
      'internal/flower_ui/src/chat/NestedFlower.css:1: replace #123456 with a semantic theme token or add a precise owner/path/use exception',
    ]);
  });
});

test('allows only the exact Desktop preload bootstrap and QR paper surface', () => {
  const preload = [
    'function fallbackDesktopThemeSnapshot() {',
    "  return { background: '#f4f1ed' };",
    '}',
    'function readDesktopThemeSnapshot() {',
    "  return '#123456';",
    '}',
  ].join('\n');
  assert.deepEqual(findThemeColorViolations(
    preload,
    'desktop/src/preload/windowTheme.ts',
    THEME_COLOR_EXCEPTIONS,
  ), [
    'desktop/src/preload/windowTheme.ts:5: replace #123456 with a semantic theme token or add a precise owner/path/use exception',
  ]);

  const welcome = [
    '.redeven-endpoint-qr-card { background: #fff; }',
    '.ordinary-card { background: #fff; }',
  ].join('\n');
  assert.deepEqual(findThemeColorViolations(
    welcome,
    'desktop/src/welcome/index.css',
    THEME_COLOR_EXCEPTIONS,
  ), [
    'desktop/src/welcome/index.css:2: replace #fff with a semantic theme token or add a precise owner/path/use exception',
  ]);
});

test('theme-source exceptions require exact Classic selectors or global neutral source tokens', () => {
  const declaration = [
    ":root[data-floe-shell-theme='classic-light'],",
    ':root:not([data-floe-shell-theme]):not(.dark),',
    ':root:not([data-floe-shell-theme]).light {',
    '  --background: #f4f1ed;',
    '}',
    ':root {',
    '  --redeven-surface-highlight-source: white;',
    '  --redeven-surface-shadow-source: black;',
    '  --unowned-color: #123456;',
    '}',
    '.panel { --private-color: #654321; color: #f4f1ed; }',
  ].join('\n');
  assert.deepEqual(findThemeColorViolations(
    declaration,
    'internal/envapp/ui_src/src/styles/redeven.css',
    THEME_COLOR_EXCEPTIONS,
  ), [
    'internal/envapp/ui_src/src/styles/redeven.css:9: replace #123456 with a semantic theme token or add a precise owner/path/use exception',
    'internal/envapp/ui_src/src/styles/redeven.css:11: replace #654321 with a semantic theme token or add a precise owner/path/use exception',
    'internal/envapp/ui_src/src/styles/redeven.css:11: replace #f4f1ed with a semantic theme token or add a precise owner/path/use exception',
  ]);
  assert.equal(findThemeColorViolations(
    'const color = "#f4f1ed";',
    'internal/envapp/ui_src/src/ui/widgets/Panel.tsx',
    THEME_COLOR_EXCEPTIONS,
  ).length, 1);
});

test('categorical supplement exceptions require exact root selectors and graph roles 6-8', () => {
  const declaration = [
    ':root {',
    '  --redeven-categorical-graph-6: oklch(0.48 0.17 30);',
    '  --redeven-categorical-graph-9: oklch(0.48 0.17 40);',
    '}',
    ':root.dark {',
    '  --redeven-categorical-graph-7: oklch(0.78 0.13 195);',
    '}',
    '.panel {',
    '  --redeven-categorical-graph-8: oklch(0.78 0.15 320);',
    '}',
  ].join('\n');
  assert.deepEqual(findThemeColorViolations(
    declaration,
    'internal/envapp/ui_src/src/styles/redeven.css',
    THEME_COLOR_EXCEPTIONS,
  ), [
    'internal/envapp/ui_src/src/styles/redeven.css:3: replace oklch(0.48 0.17 40) with a semantic theme token or add a precise owner/path/use exception',
    'internal/envapp/ui_src/src/styles/redeven.css:9: replace oklch(0.78 0.15 320) with a semantic theme token or add a precise owner/path/use exception',
  ]);
});

test('brand exceptions require both the exact path and authored SVG use', () => {
  const iconPath = 'internal/flower_ui/src/icons/FlowerIcon.tsx';
  assert.deepEqual(findThemeColorViolations(
    '<stop stop-color="#fde68a" />',
    iconPath,
    THEME_COLOR_EXCEPTIONS,
  ), []);
  assert.equal(findThemeColorViolations(
    '<div style={{ color: "#fde68a" }} />',
    iconPath,
    THEME_COLOR_EXCEPTIONS,
  ).length, 1);
  assert.equal(findThemeColorViolations(
    '<stop stop-color="#fde68a" />',
    'internal/flower_ui/src/FlowerSurface.tsx',
    THEME_COLOR_EXCEPTIONS,
  ).length, 1);
});

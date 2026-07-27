import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const css = await readFile(new URL('../ui/assets/styles.css', import.meta.url), 'utf8');

test('consumes released plugin-ui-v7 surface appearance tokens', () => {
  for (const token of ['canvas', 'surface', 'surface-elevated', 'text', 'text-muted', 'border', 'accent', 'accent-text', 'success', 'warning', 'danger', 'focus']) {
    assert.match(css, new RegExp(`--redevplugin-color-${token}`, 'u'));
  }
  assert.doesNotMatch(css, /\.containers-app\s*\{[^}]*background:\s*#[0-9a-f]{3,8}/isu);
});

test('keeps stable dense resource geometry and mobile touch controls', () => {
  assert.match(css, /\.resource-row\s*\{[^}]*display:\s*grid/isu);
  assert.match(css, /\.resource-row\s*\{[^}]*grid-template-columns:/isu);
  assert.match(css, /\.container-row\s*\{[^}]*grid-template-columns:/isu);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*?\.row-button\s*\{[^}]*min-height:\s*44px/isu);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/u);
  assert.match(css, /button:not\(:disabled\):active\s*\{[^}]*scale\(\.97\)[^}]*100ms/isu);
  assert.match(css, /@keyframes inspector-enter/u);
  assert.match(css, /\.operation progress::-webkit-progress-value\s*\{[^}]*300ms/isu);
});

test('uses one unframed workspace and a single-layer side dialog', () => {
  assert.match(css, /\.workspace\s*\{/u);
  assert.match(css, /\.operations\s*\{[^}]*position:\s*fixed[^}]*bottom:/isu);
  assert.match(css, /\.containers-app:has\(\.operations\)\s+\.workspace\s*\{[^}]*padding-bottom:\s*calc/isu);
  assert.match(css, /\.dialog-panel\s*\{[^}]*height:\s*100%/isu);
  assert.match(css, /\.form-section\s*\{[^}]*grid-column:\s*1\s*\/\s*-1/isu);
  assert.match(css, /\.detail-sections\s*\{[^}]*overflow:\s*auto/isu);
  assert.match(css, /\.destructive-warning\s*\{[^}]*var\(--danger\)/isu);
  assert.doesNotMatch(css, /border-radius:\s*(?:1[0-9]|[2-9][0-9])px/u);
});

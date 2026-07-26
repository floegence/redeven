import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const css = await readFile(new URL('../ui/assets/styles.css', import.meta.url), 'utf8');

test('uses semantic light and dark color contracts without a fixed light canvas', () => {
  assert.match(css, /color-scheme:\s*light dark/u);
  assert.match(css, /@media \(prefers-color-scheme: dark\)/u);
  for (const token of [
    '--surface-main',
    '--surface-panel',
    '--surface-control',
    '--stroke',
    '--text',
    '--accent',
    '--success',
    '--warning',
    '--danger',
  ]) {
    assert.match(css, new RegExp(`${token}:`, 'u'));
  }
  assert.doesNotMatch(css, /\.containers-app\s*\{[^}]*background:\s*#[0-9a-f]{3,8}/isu);
});

test('keeps compact resource rows and accessible mobile controls', () => {
  assert.match(css, /\.container-card\s*\{[^}]*display:\s*grid/isu);
  assert.match(css, /grid-template-columns:\s*repeat\(5,/u);
  assert.match(css, /@media \(max-width: 720px\)[\s\S]*?\.action-button\s*\{[^}]*min-height:\s*44px/isu);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/u);
});

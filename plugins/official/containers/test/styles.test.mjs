import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const css = await readFile(new URL('../ui/assets/styles.css', import.meta.url), 'utf8');

test('consumes the complete plugin surface appearance palette', () => {
  for (const token of ['canvas', 'surface', 'surface-elevated', 'text', 'text-muted', 'border', 'accent', 'accent-text', 'success', 'warning', 'danger', 'focus']) {
    assert.match(css, new RegExp(`--redevplugin-color-${token}`, 'u'));
  }
  assert.doesNotMatch(css, /transition-all/u);
  assert.doesNotMatch(css, /letter-spacing:\s*-/u);
  assert.doesNotMatch(css, /border-radius:\s*(?:1[0-9]|[2-9][0-9])px/u);
});

test('implements the desktop, compact, and mobile application shell', () => {
  assert.match(css, /\.application-shell\s*\{[^}]*grid-template-columns:\s*168px\s+minmax\(0,\s*1fr\)/isu);
  assert.match(css, /@media \(max-width:\s*959px\) and \(min-width:\s*768px\)[\s\S]*?\.application-shell\s*\{[^}]*grid-template-columns:\s*56px/isu);
  assert.match(css, /@media \(max-width:\s*767px\)[\s\S]*?\.navigation-links\s*\{[^}]*flex-direction:\s*row/isu);
  assert.match(css, /@media \(max-width:\s*767px\)[\s\S]*?\.dialog-panel\s*\{[^}]*width:\s*100vw/isu);
  assert.match(css, /\.context-bar\s*\{[^}]*grid-template-columns:/isu);
});

test('uses dense resource-specific tables without hover layout movement', () => {
  assert.match(css, /\.table-containers \.table-header,\s*\.container-row\s*\{[^}]*grid-template-columns:/isu);
  assert.match(css, /\.table-images \.table-header,\s*\.image-row/isu);
  assert.match(css, /\.table-projects \.table-header,\s*\.project-row/isu);
  assert.match(css, /\.resource-row:hover[^}]*background:/isu);
  assert.doesNotMatch(css, /\.resource-row:hover[^}]*transform:/isu);
  assert.match(css, /@media \(max-width:\s*767px\)[\s\S]*?\.row-menu > summary\s*\{[^}]*width:\s*44px[^}]*height:\s*44px/isu);
});

test('keeps operations, confirmations, and accessibility states stable', () => {
  assert.match(css, /\.operations\s*\{[^}]*position:\s*fixed[^}]*bottom:/isu);
  assert.match(css, /\.form-footer,\s*\.plan-body > \.dialog-actions\s*\{[^}]*position:\s*sticky[^}]*bottom:/isu);
  assert.match(css, /\.dialog-panel\s*\{[^}]*height:\s*100%/isu);
  assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)/u);
  assert.match(css, /@media \(forced-colors:\s*active\)/u);
  assert.match(css, /\.operation progress::-webkit-progress-value\s*\{[^}]*180ms/isu);
});

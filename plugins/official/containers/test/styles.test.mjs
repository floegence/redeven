import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const css = await readFile(new URL('../ui/assets/styles.css', import.meta.url), 'utf8');
const index = await readFile(new URL('../ui/index.html', import.meta.url), 'utf8');

test('consumes the complete plugin surface appearance palette', () => {
  for (const token of ['canvas', 'surface', 'surface-elevated', 'text', 'text-muted', 'border', 'accent', 'accent-text', 'success', 'warning', 'danger', 'focus']) {
    assert.match(css, new RegExp(`--redevplugin-color-${token}`, 'u'));
  }
  assert.doesNotMatch(css, /transition-all/u);
  assert.doesNotMatch(css, /letter-spacing:\s*-/u);
  assert.doesNotMatch(css, /border-radius:\s*(?:1[0-9]|[2-9][0-9])px/u);
  for (const token of ['radius-control', 'radius-panel', 'shadow-xs', 'shadow-sm', 'duration-fast', 'duration-base', 'ease-out']) {
    assert.match(css, new RegExp('--appica-' + token, 'u'));
  }
  assert.match(index, /assets\/appica-theme\.css/u);
  assert.match(index, /assets\/lucide-icons\.css/u);
});

test('implements the desktop, compact, and mobile application shell', () => {
  assert.match(css, /\.application-shell\s*\{[^}]*grid-template-columns:\s*168px\s+minmax\(0,\s*1fr\)/isu);
  assert.match(css, /@media \(max-width:\s*959px\) and \(min-width:\s*768px\)[\s\S]*?\.application-shell\s*\{[^}]*grid-template-columns:\s*56px/isu);
  assert.match(css, /@media \(max-width:\s*767px\)[\s\S]*?\.navigation-links\s*\{[^}]*flex-direction:\s*row/isu);
  assert.match(css, /@media \(max-width:\s*767px\)[\s\S]*?\.dialog-panel\s*\{[^}]*width:\s*100vw/isu);
  assert.match(css, /\.context-bar\s*\{[^}]*grid-template-columns:/isu);
  assert.match(css, /\.context-bar\.has-target-picker\s*\{[^}]*grid-template-columns:/isu);
});

test('uses dense resource-specific tables without hover layout movement', () => {
  assert.match(css, /\.table-containers \.table-header,\s*\.container-row\s*\{[^}]*grid-template-columns:/isu);
  assert.match(css, /\.table-images \.table-header,\s*\.image-row/isu);
  assert.match(css, /\.table-projects \.table-header,\s*\.project-row/isu);
  assert.match(css, /\.resource-row:hover[^}]*background:/isu);
  const resourceRowHoverRules = css.match(/\.resource-row:hover\s*,\s*\.resource-row:focus-within\s*\{[^}]*\}/gisu) ?? [];
  assert.ok(resourceRowHoverRules.length > 0);
  for (const rule of resourceRowHoverRules) assert.doesNotMatch(rule, /transform\s*:/iu);
  assert.doesNotMatch(css, /\.resource-table\s*\{[^}]*min-width:\s*760px/isu);
  assert.match(css, /@media \(max-width:\s*1279px\) and \(min-width:\s*960px\)[\s\S]*?\.cell-created[^}]*display:\s*none/isu);
  assert.match(css, /@media \(max-width:\s*959px\) and \(min-width:\s*768px\)[\s\S]*?\.cell-group[^}]*display:\s*none/isu);
  assert.match(css, /\.navigation-link::before\s*\{[^}]*font-size:\s*16px/isu);
  assert.match(css, /\.resource-icon\s*\{[^}]*place-items:\s*center[^}]*font-size:\s*15px/isu);
  assert.match(css, /\.appica-action\s*\{[^}]*white-space:\s*nowrap/isu);
  assert.doesNotMatch(css, /content:\s*["'](?:↻|⋯|−|\+)["']/u);
  assert.doesNotMatch(css, /\.(?:brand-mark|search|resource-icon)::after/u);
  assert.doesNotMatch(css, /\.navigation-link\.icon-/u);
  assert.match(css, /@media \(max-width:\s*767px\)[\s\S]*?\.row-menu > summary\s*\{[^}]*width:\s*44px[^}]*height:\s*44px/isu);
  assert.match(css, /\.filter-group,\s*\.toolbar-actions\s*\{[^}]*scrollbar-width:\s*none/isu);
  assert.match(css, /@media \(max-width:\s*767px\)[\s\S]*?\.navigation-links\s*\{[^}]*scrollbar-width:\s*none/isu);
  assert.match(css, /\.navigation-links::?-webkit-scrollbar\s*\{[^}]*display:\s*none/isu);
});

test('keeps operations, confirmations, and accessibility states stable', () => {
  assert.match(css, /\.operations\s*\{[^}]*position:\s*fixed[^}]*bottom:/isu);
  assert.match(css, /\.form-footer,\s*\.plan-body > \.dialog-actions\s*\{[^}]*position:\s*sticky[^}]*bottom:/isu);
  assert.match(css, /\.dialog-panel\s*\{[^}]*height:\s*100%/isu);
  assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)/u);
  assert.match(css, /@media \(forced-colors:\s*active\)/u);
  assert.match(css, /\.operation progress::-webkit-progress-value\s*\{[^}]*180ms/isu);
});

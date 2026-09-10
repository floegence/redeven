import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('both first-party renderers select the released shared material', () => {
  for (const file of ['internal/envapp/ui_src/src/ui/App.tsx', 'desktop/src/welcome/App.tsx']) {
    assert.match(read(file), /defaultSurfaceStyle: 'soft-neumorphic'/, file);
  }
});

test('Desktop leaves dialog decoration and environment card depth to Floe', () => {
  const css = read('desktop/src/welcome/index.css');
  assert.doesNotMatch(css, /backdrop-filter: blur\((?:10|14)px\)/);
  assert.doesNotMatch(css, /^\.dark \[data-floe-dialog-panel\] \{/m);
  for (const block of css.matchAll(/(?:^|\n)[^{}]*\.redeven-environment-card(?::hover|--featured|--open)?\s*\{([^{}]*)\}/g)) {
    assert.doesNotMatch(block[1], /box-shadow|translateY/, 'Cards keep static shared depth');
  }
});

test('product floating boundaries opt into upstream material without copying shadows', () => {
  for (const file of [
    'desktop/src/welcome/DesktopAnchoredOverlaySurface.tsx',
    'internal/envapp/ui_src/src/ui/EnvAppThemePicker.tsx',
    'internal/envapp/ui_src/src/ui/widgets/WindowModal.tsx',
  ]) {
    assert.match(read(file), /data-floe-surface="floating"/, file);
  }
  const modal = read('internal/envapp/ui_src/src/ui/widgets/WindowModal.tsx');
  assert.doesNotMatch(modal, /backdrop-blur|shadow-\[/);
});

test('debug settings use the shared Switch with native disabled semantics', () => {
  const source = read('internal/envapp/ui_src/src/ui/pages/EnvDebugConsoleSettingsPanel.tsx');
  assert.match(source, /import \{ Switch \} from '@floegence\/floe-webapp-core\/ui'/);
  assert.doesNotMatch(source, /function DebugConsoleSwitch|role="switch"/);
});

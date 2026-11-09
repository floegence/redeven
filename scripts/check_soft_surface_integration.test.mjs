import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

test('both shared canvas hosts pin the same published graph engine', () => {
  const env = JSON.parse(read('internal/envapp/ui_src/package.json'));
  const desktop = JSON.parse(read('desktop/package.json'));
  assert.equal(desktop.dependencies['@floegence/floe-webapp-core'], undefined,
    'Desktop core stays build-only to preserve the offline payload contract');
  assert.equal(desktop.devDependencies['@floegence/floe-webapp-core'],
    env.dependencies['@floegence/floe-webapp-core'],
    'Desktop Welcome and Env App must provide the same graph capabilities');
});

test('both first-party renderers select the released shared material', () => {
  for (const file of ['internal/envapp/ui_src/src/ui/App.tsx', 'desktop/src/welcome/App.tsx']) {
    assert.match(read(file), /defaultSurfaceStyle: 'soft-neumorphic'/, file);
  }
});

test('both renderers install the published optional diagram peers used by Floe', () => {
  const env = JSON.parse(read('internal/envapp/ui_src/package.json'));
  const desktop = JSON.parse(read('desktop/package.json'));
  for (const [name, version] of Object.entries({ pele: '1.13.0', katex: '0.18.10' })) {
    assert.equal(env.dependencies[name], version);
    assert.equal(desktop.devDependencies[name], version,
      'Renderer diagram engines remain build-only Desktop dependencies');
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
    'internal/envapp/ui_src/src/ui/widgets/WindowModal.tsx',
  ]) {
    assert.match(read(file), /data-floe-surface="floating"/, file);
  }
  const appearance = read('internal/envapp/ui_src/src/ui/EnvAppThemePicker.tsx');
  assert.doesNotMatch(appearance, /data-floe-surface|TopBarIconButton|createFloatingPresence/);
  assert.match(appearance, /<ThemePicker /, 'inline settings consume the published non-floating appearance surface');
  const modal = read('internal/envapp/ui_src/src/ui/widgets/WindowModal.tsx');
  assert.doesNotMatch(modal, /backdrop-blur|shadow-\[/);
});

test('debug settings use the shared Switch with native disabled semantics', () => {
  const source = read('internal/envapp/ui_src/src/ui/pages/EnvDebugConsoleSettingsPanel.tsx');
  assert.match(source, /import \{ Switch \} from '@floegence\/floe-webapp-core\/ui'/);
  assert.doesNotMatch(source, /function DebugConsoleSwitch|role="switch"/);
});

test('high-frequency product actions keep stable geometry under the refined material', () => {
  for (const file of [
    'internal/envapp/ui_src/src/ui/downloads/DownloadTaskPanel.tsx',
    'internal/envapp/ui_src/src/ui/plugins/ExternalPluginInstallDialog.tsx',
    'internal/envapp/ui_src/src/ui/plugins/pluginPresentation.ts',
  ]) {
    assert.doesNotMatch(read(file), /active:scale/, file);
  }
});

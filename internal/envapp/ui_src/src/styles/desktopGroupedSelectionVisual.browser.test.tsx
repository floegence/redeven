import '../index.css';
import welcomeStyles from '../../../../../desktop/src/welcome/index.css?raw';
import { builtInShellThemePresets } from '@floegence/floe-webapp-core/themes';
import { SegmentedControl } from '@floegence/floe-webapp-core/ui';
import { render } from 'solid-js/web';
import { afterAll, afterEach, expect, it } from 'vitest';
import { page, commands } from 'vitest/browser';
import { expectClearSelection } from './selectionContrast.test-support';

// Both renderers consume the same published Floe CSS. Add Welcome's real
// product rules without asking this browser fixture to load Desktop-only fonts.
const welcomeSheet = document.createElement('style');
welcomeSheet.textContent = welcomeStyles.replace(/^@(?:import|source)[^;]+;\s*/gm, '');
document.head.append(welcomeSheet);
afterAll(() => welcomeSheet.remove());

const media = commands as unknown as {
  emulateMediaPreferences: (preferences: { forcedColors: 'active' | 'none'; reducedMotion: 'reduce' | 'no-preference' }) => Promise<void>;
};
let dispose: (() => void) | undefined;
afterEach(async () => {
  await media.emulateMediaPreferences({ forcedColors: 'none', reducedMotion: 'no-preference' });
  dispose?.();
  document.body.replaceChildren();
  document.documentElement.classList.remove('light', 'dark');
  delete document.documentElement.dataset.floeShellTheme;
  delete document.documentElement.dataset.floeSurfaceStyle;
});
it.each(['standard', 'soft-neumorphic'])('keeps Welcome and settings selections distinct with %s', async (material) => {
  for (const preset of builtInShellThemePresets) {
    dispose?.();
    document.body.replaceChildren();
    document.documentElement.classList.toggle('dark', preset.mode === 'dark');
    document.documentElement.classList.toggle('light', preset.mode === 'light');
    document.documentElement.dataset.floeShellTheme = preset.name;
    document.documentElement.dataset.floeSurfaceStyle = material;
    const host = document.createElement('main');
    host.style.cssText = 'background:var(--card);padding:20px;display:grid;gap:12px';
    document.body.append(host);
    dispose = render(() => <>
      <div class="ssh-settings-form"><SegmentedControl value="local" onChange={() => {}} options={[{ value: 'local', label: 'Only this device' }, { value: 'network', label: 'Network devices' }]} /></div>
      <div><button class="redeven-console-tab" data-active="true">Environments</button></div>
      <div><button class="redeven-console-filter" data-active="true">Local</button></div>
      <div><button class="redeven-provider-pill" data-active="true">All</button></div>
      <div><button class="redeven-runtime-chip" data-active="true">Selected host</button></div>
      <div class="redeven-theme-picker__modes"><button class="redeven-theme-picker__mode" aria-checked="true">Light</button></div>
    </>, host);
    const selected = [...host.querySelectorAll<HTMLElement>('button[aria-checked="true"], button[data-active="true"]')];
    expect(selected).toHaveLength(6);
    for (const element of selected) expectClearSelection(element, `${preset.name}/${material}`);
    if (['classic-light', 'classic-dark', 'porcelain-light', 'porcelain-dark'].includes(preset.name)) {
      await media.emulateMediaPreferences({ forcedColors: 'active', reducedMotion: 'reduce' });
      for (const element of selected) expectClearSelection(element, `${preset.name}/${material}/system colors`);
      await media.emulateMediaPreferences({ forcedColors: 'none', reducedMotion: 'reduce' });
      // Media emulation changes the global palette; inspect its settled colors.
      await Promise.all(document.getAnimations().map((animation) => animation.finished.catch(() => undefined)));
      for (const element of selected) expectClearSelection(element, `${preset.name}/${material}/reduced motion`);
      await media.emulateMediaPreferences({ forcedColors: 'none', reducedMotion: 'no-preference' });
      for (const element of selected) {
        await page.elementLocator(element).hover();
        expectClearSelection(element, `${preset.name}/${material}/hover`);
      }
    }
  }
});

import '../index.css';
import '../ui/pages/env-containers.css';
import '../../../../flower_ui/src/styles/flower.css';
import { builtInShellThemePresets } from '@floegence/floe-webapp-core/themes';
import { SegmentedControl } from '@floegence/floe-webapp-core/ui';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, expect, it } from 'vitest';
import { page, userEvent, commands } from 'vitest/browser';
import { GitHistoryModeSwitch } from '../ui/widgets/GitHistoryModeSwitch';
import { BrowserEditorInstallMethodSelector } from '../ui/pages/BrowserEditorInstallMethodSelector';
import { expectClearSelection } from './selectionContrast.test-support';

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
it.each(['standard', 'soft-neumorphic'])('keeps product compact selections distinct with %s', async (material) => {
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
    const [mode, setMode] = createSignal<'files' | 'git'>('files');
    dispose = render(() => <>
      <SegmentedControl value="list" onChange={() => {}} options={[{ value: 'list', label: 'List' }, { value: 'grid', label: 'Grid' }]} />
      <GitHistoryModeSwitch mode={mode()} onChange={setMode} />
      <BrowserEditorInstallMethodSelector installMethod="desktop_transfer" desktopTransferAvailable onChange={() => {}} />
      <div class="redeven-surface-segmented"><button class="redeven-surface-segmented__item redeven-surface-segmented__item--active" aria-selected="true">Settings</button></div>
      <div class="redeven-surface-segmented"><button class="git-browser-segmented-tab redeven-surface-segmented__item redeven-surface-segmented__item--active" aria-selected="true">Workspace</button></div>
      <div><button class="git-browser-interactive redeven-surface-segmented__item redeven-surface-segmented__item--active" aria-pressed="true">Changes <span class="text-inherit">2</span></button></div>
      <div class="container-filter-switch"><button aria-pressed="true">Active containers</button></div>
      <div class="service-template-switcher"><button class="service-template-switcher__item" aria-selected="true">Host <span class="service-template-switcher__count">3</span></button></div>
      <div class="service-template-scheme-picker"><button class="service-template-scheme-picker__option" aria-checked="true">HTTPS</button></div>
      <div class="flower-reasoning-segmented"><button class="flower-reasoning-segment flower-reasoning-segment-active" aria-pressed="true">Medium</button></div>
      <div class="flower-input-request-text-targets"><button class="flower-input-request-text-target flower-input-request-text-target-active" aria-selected="true">Second question</button></div>
      <div><button class="flower-input-request-choice-custom" aria-checked="true">Custom answer</button></div>
    </>, host);
    const selected = [...host.querySelectorAll<HTMLElement>('button[aria-checked="true"], button[aria-selected="true"], button[aria-pressed="true"]')];
    expect(selected).toHaveLength(12);
    for (const element of selected) expectClearSelection(element, `${preset.name}/${material}`);
    if (['classic-dark', 'classic-light', 'porcelain-light', 'porcelain-dark'].includes(preset.name)) {
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
      const files = host.querySelector<HTMLElement>('[data-browser-mode-switch] button[aria-checked="true"]')!;
      const git = host.querySelector<HTMLButtonElement>('[data-browser-mode-switch] button[aria-checked="false"]')!;
      git.focus();
      await userEvent.keyboard(' ');
      expect(git.getAttribute('aria-checked')).toBe('true');
      expectClearSelection(git, `${preset.name}/switch frame`);
      files.click();
      expectClearSelection(files, `${preset.name}/reverse frame`);
      expect(document.activeElement).toBe(git);
    }
  }
});

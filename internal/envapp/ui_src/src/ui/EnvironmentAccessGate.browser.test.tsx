import '../index.css';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { EnvironmentAccessGate, type AccessGatePhase } from './EnvironmentAccessGate';
import { I18nProvider } from './i18n';
import { SUPPORTED_LOCALES } from './i18n/localeMeta';
import { writeStoredLanguagePreference } from './i18n/storage';

it('keeps access gates opaque, readable and keyboard-operable across locales and window sizes', async () => {
  const originalClass = document.documentElement.className;
  try {
    for (const locale of SUPPORTED_LOCALES) {
      for (const mode of ['light', 'dark']) {
        document.documentElement.className = mode;
        document.documentElement.dataset.floeShellTheme = `classic-${mode}`;
        writeStoredLanguagePreference(locale);
        for (const width of [1280, 390]) {
          await page.viewport(width, 720);
          const host = document.createElement('div');
          document.body.append(host);
          let changePhase!: (phase: AccessGatePhase) => void;
          let submitted = '';
          const dispose = render(() => {
            const [phase, setPhase] = createSignal<AccessGatePhase>('checking');
            const [password, setPassword] = createSignal('');
            changePhase = setPhase;
            return <I18nProvider><EnvironmentAccessGate
              phase={phase()} local environmentName="Local Environment"
              pending={phase() === 'checking'} unlocking={false} recoveryBusy={phase() === 'resuming'}
              retryActive={false} retryDuration="" password={password()} error="" languageMenu={null}
              inputRef={() => undefined} onPasswordInput={setPassword}
              onSubmit={async (event) => { event.preventDefault(); submitted = password(); }}
              onRetry={async () => undefined} onReload={() => undefined}
            /></I18nProvider>;
          }, host);
          try {
            await expect.poll(() => host.querySelector('[data-testid="environment-access-gate"]')).toBeTruthy();
            for (const phase of ['checking', 'unlock_required', 'resuming', 'resume_blocked'] as const) {
              changePhase(phase);
              await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
              const root = host.querySelector<HTMLElement>('[data-testid="environment-access-gate"]')!;
              expect(getComputedStyle(root).backdropFilter).toBe('none');
              expect(getComputedStyle(root).backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
              expect(root.scrollWidth).toBeLessThanOrEqual(root.clientWidth);
              expect(host.querySelector('h1')!.getBoundingClientRect().top).toBeGreaterThanOrEqual(0);
              expect(host.querySelector('[role="progressbar"]')).toBeNull();
              expect(host.querySelector('[data-floe-progress-shimmer]') !== null).toBe(phase === 'checking' || phase === 'resuming');
              if (phase === 'unlock_required') {
                const input = host.querySelector('input')!;
                const before = input.getBoundingClientRect();
                input.focus();
                expect(getComputedStyle(input).boxShadow).toBe('none');
                expect(input.getBoundingClientRect().width).toBe(before.width);
                expect(input.autocomplete).toBe('current-password');
                await page.elementLocator(input).fill('local-acceptance-password');
                await userEvent.keyboard('{Enter}');
                expect(submitted).toBe('local-acceptance-password');
              }
              if (import.meta.env.VITE_CONNECTION_RECOVERY_SCREENSHOTS === '1' && locale === 'zh-CN' && width === 1280) {
                await page.screenshot({ path: `window-status-access-${phase}-${mode}.png` });
              }
            }
          } finally { dispose(); host.remove(); }
        }
      }
    }
  } finally {
    document.documentElement.className = originalClass;
    delete document.documentElement.dataset.floeShellTheme;
    writeStoredLanguagePreference('en-US');
  }
}, 120_000);

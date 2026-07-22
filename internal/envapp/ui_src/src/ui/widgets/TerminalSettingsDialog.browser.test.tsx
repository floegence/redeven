import '../../index.css';

import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { TERMINAL_THEME_DEFINITIONS } from '@floegence/floeterm-terminal-web';

import { TerminalSettingsDialog } from './TerminalSettingsDialog';

const layoutState = vi.hoisted(() => ({ mobile: false }));

const mediaCommands = commands as unknown as Readonly<{
  emulateMediaPreferences: (preferences: Readonly<{
    forcedColors?: null | 'active' | 'none';
    reducedMotion?: null | 'reduce' | 'no-preference';
  }>) => Promise<void>;
}>;

vi.mock('@floegence/floe-webapp-core', async () => {
  const actual = await vi.importActual<typeof import('@floegence/floe-webapp-core')>('@floegence/floe-webapp-core');
  return {
    ...actual,
    useLayout: () => ({
      isMobile: () => layoutState.mobile,
    }),
  };
});

type MountedDialog = Readonly<{
  dispose: () => void;
  selectedTheme: () => string;
  changes: string[];
}>;

function mountDialog(initialTheme = 'system'): MountedDialog {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const [selectedTheme, setSelectedTheme] = createSignal(initialTheme);
  const changes: string[] = [];
  const dispose = render(() => (
    <TerminalSettingsDialog
      open
      userTheme={selectedTheme()}
      fontSize={12}
      fontFamilyId="iosevka"
      mobileInputMode="floe"
      systemAppearance="dark"
      workIndicatorEnabled
      minFontSize={10}
      maxFontSize={20}
      onOpenChange={() => undefined}
      onThemeChange={(value) => {
        changes.push(value);
        setSelectedTheme(value);
        return true;
      }}
      onFontSizeChange={() => undefined}
      onFontFamilyChange={() => undefined}
      onMobileInputModeChange={() => undefined}
      onWorkIndicatorEnabledChange={() => undefined}
    />
  ), host);
  return { dispose, selectedTheme, changes };
}

async function settle(): Promise<void> {
  await Promise.resolve();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}

function themeRadios(): HTMLInputElement[] {
  return Array.from(document.querySelectorAll<HTMLInputElement>('input[name="terminal-theme"]'));
}

function themeCards(): HTMLElement[] {
  return themeRadios()
    .map((radio) => radio.nextElementSibling)
    .filter((card): card is HTMLElement => card instanceof HTMLElement);
}

function assertNoCardTextOverflow(cards: readonly HTMLElement[]): void {
  for (const card of cards) {
    expect(card.scrollWidth).toBeLessThanOrEqual(card.clientWidth + 1);
  }
}

describe('TerminalSettingsDialog browser theme gallery', () => {
  let cleanup: (() => void) | undefined;

  afterEach(async () => {
    cleanup?.();
    cleanup = undefined;
    document.body.replaceChildren();
    document.body.style.zoom = '';
    layoutState.mobile = false;
    await mediaCommands.emulateMediaPreferences({ forcedColors: 'none', reducedMotion: 'no-preference' });
    await page.viewport(1280, 720);
  });

  it('renders a keyboard-operable 21-theme desktop gallery with one scroll region', async () => {
    await page.viewport(1280, 900);
    const mounted = mountDialog();
    cleanup = mounted.dispose;
    await settle();

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const radios = themeRadios();
    expect(dialog).toBeTruthy();
    expect(radios).toHaveLength(TERMINAL_THEME_DEFINITIONS.length + 1);
    expect(new Set(radios.map((radio) => radio.value)).size).toBe(21);
    expect(radios[0]?.value).toBe('system');
    expect(document.activeElement).toBe(radios[0]);

    const firstDark = radios.find((radio) => radio.value === 'dark')!;
    const secondDark = radios.find((radio) => radio.value === 'solarizedDark')!;
    firstDark.focus();
    await userEvent.keyboard('{ArrowDown}');
    expect(document.activeElement).toBe(secondDark);
    expect(secondDark.checked).toBe(true);
    expect(mounted.selectedTheme()).toBe('solarizedDark');
    expect(mounted.changes).toContain('solarizedDark');
    expect(document.querySelector('[aria-live="polite"]')?.textContent).toContain('Solarized Dark');
    expect(document.querySelector('[aria-live="polite"]')?.textContent).toContain('Theme applied');
    expect(document.querySelectorAll('[role="group"][aria-labelledby="terminal-theme-dark-group-label"]')).toHaveLength(1);
    expect(document.querySelectorAll('[role="group"][aria-labelledby="terminal-theme-light-group-label"]')).toHaveLength(1);

    const preview = secondDark.closest('label')?.querySelector('[aria-hidden="true"]');
    expect(preview?.querySelectorAll('[data-theme-preview-ansi="normal"] > span')).toHaveLength(8);
    expect(preview?.querySelectorAll('[data-theme-preview-ansi="bright"] > span')).toHaveLength(8);
    expect(preview?.querySelectorAll('[data-theme-preview-role]')).toHaveLength(4);

    const darkCard = firstDark.nextElementSibling as HTMLElement;
    const nextDarkCard = secondDark.nextElementSibling as HTMLElement;
    expect(Math.abs(darkCard.getBoundingClientRect().top - nextDarkCard.getBoundingClientRect().top)).toBeLessThan(2);

    const scrollRegions = Array.from(dialog!.querySelectorAll<HTMLElement>('*')).filter((element) => {
      const overflowY = getComputedStyle(element).overflowY;
      return (overflowY === 'auto' || overflowY === 'scroll') && element.scrollHeight > element.clientHeight;
    });
    expect(scrollRegions).toHaveLength(1);
    expect(dialog!.scrollWidth).toBeLessThanOrEqual(dialog!.clientWidth + 1);
    assertNoCardTextOverflow(themeCards());
    expect((await page.screenshot({ save: false })).length).toBeGreaterThan(1_000);
  });

  it('keeps the gallery usable at 320px and separately at 200 percent page zoom', async () => {
    layoutState.mobile = true;
    await page.viewport(320, 720);
    const mounted = mountDialog('studioPaper');
    cleanup = mounted.dispose;
    await settle();

    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const radios = themeRadios();
    expect(dialog).toBeTruthy();
    expect(document.activeElement).toBe(radios.find((radio) => radio.value === 'studioPaper'));
    expect(dialog!.getBoundingClientRect().left).toBeGreaterThanOrEqual(0);
    expect(dialog!.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth + 1);
    expect(dialog!.scrollWidth).toBeLessThanOrEqual(dialog!.clientWidth + 1);

    const darkCard = radios.find((radio) => radio.value === 'dark')!.nextElementSibling as HTMLElement;
    const lightCard = radios.find((radio) => radio.value === 'light')!.nextElementSibling as HTMLElement;
    expect(darkCard.getBoundingClientRect().width).toBeGreaterThan(dialog!.clientWidth * 0.8);
    expect(lightCard.getBoundingClientRect().width).toBeGreaterThan(dialog!.clientWidth * 0.8);
    expect(lightCard.getBoundingClientRect().top).toBeGreaterThan(darkCard.getBoundingClientRect().bottom - 1);
    assertNoCardTextOverflow(themeCards());
    expect((await page.screenshot({ save: false })).length).toBeGreaterThan(1_000);

    mounted.dispose();
    cleanup = undefined;
    document.body.replaceChildren();
    layoutState.mobile = false;
    await page.viewport(1280, 900);
    document.body.style.zoom = '2';
    const zoomed = mountDialog('studioPaper');
    cleanup = zoomed.dispose;
    await settle();

    const zoomedDialog = document.querySelector<HTMLElement>('[role="dialog"]')!;
    expect(zoomedDialog.getBoundingClientRect().left).toBeGreaterThanOrEqual(0);
    expect(zoomedDialog.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth + 1);
    expect(zoomedDialog.scrollWidth).toBeLessThanOrEqual(zoomedDialog.clientWidth + 1);
    assertNoCardTextOverflow(themeCards());
    expect((await page.screenshot({ save: false })).length).toBeGreaterThan(1_000);
  });

  it('preserves selection and focus visibility in forced-colors mode', async () => {
    await page.viewport(1280, 900);
    await mediaCommands.emulateMediaPreferences({ forcedColors: 'active', reducedMotion: 'reduce' });
    const mounted = mountDialog('signalSafeDark');
    cleanup = mounted.dispose;
    await settle();

    expect(window.matchMedia('(forced-colors: active)').matches).toBe(true);
    expect(window.matchMedia('(prefers-reduced-motion: reduce)').matches).toBe(true);
    const selected = themeRadios().find((radio) => radio.value === 'signalSafeDark')!;
    const selectedCard = selected.nextElementSibling as HTMLElement;
    expect(document.activeElement).toBe(selected);
    expect(selected.checked).toBe(true);
    expect(getComputedStyle(selectedCard).transitionDuration).toBe('0s');
    expect(getComputedStyle(selectedCard).outlineStyle).not.toBe('none');
    expect((await page.screenshot({ save: false })).length).toBeGreaterThan(1_000);
  });
});

// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TERMINAL_THEME_DEFINITIONS } from '@floegence/floeterm-terminal-web';

import { TerminalSettingsDialog } from './TerminalSettingsDialog';

const layoutState = vi.hoisted(() => ({
  mobile: false,
}));

vi.mock('@floegence/floe-webapp-core', () => ({
  cn: (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(' '),
  useLayout: () => ({
    isMobile: () => layoutState.mobile,
  }),
}));

vi.mock('@floegence/floe-webapp-core/ui', () => ({
  createFloatingPresence: (options: { open: () => boolean }) => ({
    mounted: () => Boolean(options.open()),
    exiting: () => false,
    state: () => (options.open() ? 'entered' : 'exited'),
  }),
  Button: (props: any) => (
    <button
      type="button"
      class={props.class}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  ),
  Checkbox: (props: any) => (
    <label>
      <input
        type="checkbox"
        checked={props.checked}
        aria-label={props.label}
        onChange={(event) => props.onChange((event.currentTarget as HTMLInputElement).checked)}
      />
      {props.label}
    </label>
  ),
  Dialog: (props: any) => (
    props.open ? (
      <div data-testid="dialog" class={props.class}>
        <div>{props.title}</div>
        <div>{props.description}</div>
        <div>{props.children}</div>
        <div>{props.footer}</div>
      </div>
    ) : null
  ),
  NumberInput: (props: any) => (
    <input
      data-testid="font-size-input"
      value={props.value}
      onInput={(event) => props.onChange(Number((event.currentTarget as HTMLInputElement).value))}
    />
  ),
}));

afterEach(() => {
  document.body.innerHTML = '';
  layoutState.mobile = false;
});

describe('TerminalSettingsDialog', () => {
  it('renders the desktop layout and forwards terminal preference changes', async () => {
    const onOpenChange = vi.fn();
    const onThemeChange = vi.fn().mockReturnValue(true);
    const onFontSizeChange = vi.fn();
    const onFontFamilyChange = vi.fn();
    const onMobileInputModeChange = vi.fn();
    const onWorkIndicatorEnabledChange = vi.fn();

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <TerminalSettingsDialog
        open
        userTheme="system"
        fontSize={12}
        fontFamilyId="iosevka"
        mobileInputMode="floe"
        systemAppearance="light"
        workIndicatorEnabled
        minFontSize={10}
        maxFontSize={20}
        onOpenChange={onOpenChange}
        onThemeChange={onThemeChange}
        onFontSizeChange={onFontSizeChange}
        onFontFamilyChange={onFontFamilyChange}
        onMobileInputModeChange={onMobileInputModeChange}
        onWorkIndicatorEnabledChange={onWorkIndicatorEnabledChange}
      />
    ), host);

    const dialog = host.querySelector('[data-testid="dialog"]');
    expect(dialog).toBeTruthy();
    expect(dialog?.className).toContain('w-[min(30rem,92vw)]');
    expect(host.textContent).toContain('Terminal settings');
    expect(host.textContent).toContain('System Theme');
    expect(host.textContent).toContain('Signal Safe Dark');
    expect(host.textContent).toContain('Studio Paper');
    expect(host.textContent).toContain('JetBrains Mono');
    expect(host.textContent).toContain('Activity border');

    const themeRadios = Array.from(host.querySelectorAll<HTMLInputElement>('input[name="terminal-theme"]'));
    expect(themeRadios).toHaveLength(TERMINAL_THEME_DEFINITIONS.length + 1);
    expect(new Set(themeRadios.map((input) => input.value)).size).toBe(21);
    expect(themeRadios.find((input) => input.value === 'system')?.checked).toBe(true);
    expect(themeRadios.find((input) => input.value === 'system')?.dataset.floeAutofocus).toBe('true');
    expect(host.querySelector('[data-theme-appearance-group="dark"]')?.textContent).toContain('Dark');
    expect(host.querySelector('[data-theme-appearance-group="light"]')?.textContent).toContain('Light');
    expect(host.querySelector('[data-theme-appearance-group="dark"]')?.getAttribute('role')).toBe('group');
    expect(host.querySelector('[data-theme-appearance-group="dark"]')?.getAttribute('aria-labelledby')).toBe('terminal-theme-dark-group-label');

    const studioPaperInput = themeRadios.find((input) => input.value === 'studioPaper')!;
    const studioPaperPreview = studioPaperInput.closest('label')?.querySelector('[aria-hidden="true"]') as HTMLElement | null;
    expect(studioPaperPreview?.style.backgroundColor).toBe('rgb(247, 248, 250)');
    expect(studioPaperPreview?.querySelectorAll('[data-theme-preview-ansi="normal"] > span')).toHaveLength(8);
    expect(studioPaperPreview?.querySelectorAll('[data-theme-preview-ansi="bright"] > span')).toHaveLength(8);
    expect(studioPaperPreview?.querySelectorAll('[data-theme-preview-role]')).toHaveLength(4);
    const systemPreview = themeRadios.find((input) => input.value === 'system')
      ?.closest('label')?.querySelector('[aria-hidden="true"]') as HTMLElement | null;
    expect(systemPreview?.style.backgroundColor).toBe('rgb(255, 255, 255)');

    themeRadios.find((input) => input.value === 'dark')?.click();
    Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('JetBrains Mono'))?.click();
    const activityBorderInput = host.querySelector('input[aria-label="Shown"]') as HTMLInputElement | null;
    activityBorderInput!.checked = false;
    activityBorderInput!.dispatchEvent(new Event('change', { bubbles: true }));
    const fontSizeInput = host.querySelector('[data-testid="font-size-input"]') as HTMLInputElement | null;
    fontSizeInput!.value = '15';
    fontSizeInput!.dispatchEvent(new InputEvent('input', { bubbles: true }));
    Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('Close'))?.click();

    expect(onThemeChange).toHaveBeenCalledWith('dark');
    expect(host.querySelector('[aria-live="polite"]')?.textContent).toContain('Dark: Theme applied');
    expect(onFontFamilyChange).toHaveBeenCalledWith('jetbrains');
    expect(onFontSizeChange).toHaveBeenCalledWith(15);
    expect(onMobileInputModeChange).not.toHaveBeenCalled();
    expect(onWorkIndicatorEnabledChange).toHaveBeenCalledWith(false);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('falls back to a checked dark radio without writing an unknown persisted theme', () => {
    const onThemeChange = vi.fn().mockReturnValue(true);
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <TerminalSettingsDialog
        open
        userTheme="futureTheme"
        fontSize={12}
        fontFamilyId="iosevka"
        mobileInputMode="floe"
        workIndicatorEnabled={false}
        minFontSize={10}
        maxFontSize={20}
        onOpenChange={() => undefined}
        onThemeChange={onThemeChange}
        onFontSizeChange={() => undefined}
        onFontFamilyChange={() => undefined}
        onMobileInputModeChange={() => undefined}
        onWorkIndicatorEnabledChange={() => undefined}
      />
    ), host);

    const dark = host.querySelector<HTMLInputElement>('input[name="terminal-theme"][value="dark"]');
    expect(dark?.checked).toBe(true);
    expect(onThemeChange).not.toHaveBeenCalled();
  });

  it('keeps the previous checked theme and announces a synchronous application failure', () => {
    const onThemeChange = vi.fn().mockReturnValue(false);
    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <TerminalSettingsDialog
        open
        userTheme="dark"
        fontSize={12}
        fontFamilyId="iosevka"
        mobileInputMode="floe"
        workIndicatorEnabled={false}
        minFontSize={10}
        maxFontSize={20}
        onOpenChange={() => undefined}
        onThemeChange={onThemeChange}
        onFontSizeChange={() => undefined}
        onFontFamilyChange={() => undefined}
        onMobileInputModeChange={() => undefined}
        onWorkIndicatorEnabledChange={() => undefined}
      />
    ), host);

    const studioPaper = host.querySelector<HTMLInputElement>('input[value="studioPaper"]')!;
    studioPaper.click();

    expect(onThemeChange).toHaveBeenCalledWith('studioPaper');
    expect(host.querySelector<HTMLInputElement>('input[value="dark"]')?.checked).toBe(true);
    expect(studioPaper.checked).toBe(false);
    expect(host.querySelector('[aria-live="polite"]')?.textContent).toContain('Studio Paper: Theme could not be applied');
  });

  it('uses the mobile dialog layout and exposes mutually exclusive mobile input mode controls', () => {
    layoutState.mobile = true;

    const onMobileInputModeChange = vi.fn();

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <TerminalSettingsDialog
        open
        userTheme="dark"
        fontSize={12}
        fontFamilyId="iosevka"
        mobileInputMode="floe"
        workIndicatorEnabled
        minFontSize={10}
        maxFontSize={20}
        onOpenChange={() => undefined}
        onThemeChange={() => true}
        onFontSizeChange={() => undefined}
        onFontFamilyChange={() => undefined}
        onMobileInputModeChange={onMobileInputModeChange}
        onWorkIndicatorEnabledChange={() => undefined}
      />
    ), host);

    const dialog = host.querySelector('[data-testid="dialog"]');
    expect(dialog).toBeTruthy();
    expect(dialog?.className).toContain('h-[calc(100dvh-0.5rem)]');
    expect(dialog?.className).toContain('w-[calc(100vw-0.5rem)]');
    expect(host.textContent).toContain('Mobile input');
    expect(host.textContent).toContain('Only one mode can be active at a time.');
    expect(host.textContent).toContain('Floe suggestions');
    expect(host.textContent).toContain('platform text features');

    Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('System IME'))?.click();
    Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('Floe Keyboard'))?.click();

    expect(onMobileInputModeChange).toHaveBeenCalledWith('system');
    expect(onMobileInputModeChange).toHaveBeenCalledWith('floe');
  });
});

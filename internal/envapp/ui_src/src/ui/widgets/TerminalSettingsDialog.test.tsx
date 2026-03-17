// @vitest-environment jsdom

import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';

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
  it('renders the desktop layout and forwards terminal preference changes', () => {
    const onOpenChange = vi.fn();
    const onThemeChange = vi.fn();
    const onFontSizeChange = vi.fn();
    const onFontFamilyChange = vi.fn();
    const onMobileInputModeChange = vi.fn();

    const host = document.createElement('div');
    document.body.appendChild(host);

    render(() => (
      <TerminalSettingsDialog
        open
        userTheme="system"
        fontSize={12}
        fontFamilyId="iosevka"
        mobileInputMode="floe"
        minFontSize={10}
        maxFontSize={20}
        onOpenChange={onOpenChange}
        onThemeChange={onThemeChange}
        onFontSizeChange={onFontSizeChange}
        onFontFamilyChange={onFontFamilyChange}
        onMobileInputModeChange={onMobileInputModeChange}
      />
    ), host);

    const dialog = host.querySelector('[data-testid="dialog"]');
    expect(dialog).toBeTruthy();
    expect(dialog?.className).toContain('w-[min(30rem,92vw)]');
    expect(host.textContent).toContain('Terminal settings');
    expect(host.textContent).toContain('System Theme');
    expect(host.textContent).toContain('JetBrains Mono');

    Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('Dark'))?.click();
    Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('JetBrains Mono'))?.click();
    const fontSizeInput = host.querySelector('[data-testid="font-size-input"]') as HTMLInputElement | null;
    fontSizeInput!.value = '15';
    fontSizeInput!.dispatchEvent(new InputEvent('input', { bubbles: true }));
    Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('Close'))?.click();

    expect(onThemeChange).toHaveBeenCalledWith('dark');
    expect(onFontFamilyChange).toHaveBeenCalledWith('jetbrains');
    expect(onFontSizeChange).toHaveBeenCalledWith(15);
    expect(onMobileInputModeChange).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('uses the mobile dialog layout and exposes mobile input mode controls on mobile', () => {
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
        minFontSize={10}
        maxFontSize={20}
        onOpenChange={() => undefined}
        onThemeChange={() => undefined}
        onFontSizeChange={() => undefined}
        onFontFamilyChange={() => undefined}
        onMobileInputModeChange={onMobileInputModeChange}
      />
    ), host);

    const dialog = host.querySelector('[data-testid="dialog"]');
    expect(dialog).toBeTruthy();
    expect(dialog?.className).toContain('h-[calc(100dvh-0.5rem)]');
    expect(dialog?.className).toContain('w-[calc(100vw-0.5rem)]');
    expect(host.textContent).toContain('Mobile input');
    Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('System IME'))?.click();
    expect(onMobileInputModeChange).toHaveBeenCalledWith('system');
  });
});

import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDesktopI18n } from '../shared/i18n';
import { DesktopThemePicker, type DesktopThemePickerSnapshot } from './DesktopThemePicker';

let dispose: (() => void) | undefined;
beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => setTimeout(() => callback(performance.now()), 0));
  vi.stubGlobal('cancelAnimationFrame', clearTimeout);
  HTMLElement.prototype.scrollIntoView = vi.fn();
});
afterEach(() => { dispose?.(); document.body.replaceChildren(); vi.unstubAllGlobals(); });

function mount() {
  const host = document.createElement('div'); document.body.append(host);
  const [active, setActive] = createSignal(true);
  const [snapshot, setSnapshot] = createSignal<DesktopThemePickerSnapshot>({ source: 'system', resolvedTheme: 'dark', shellThemes: { light: 'porcelain-light', dark: 'porcelain-dark' } });
  let resolve!: (value: DesktopThemePickerSnapshot) => void;
  let reject!: (reason: Error) => void;
  const onSourceChange = vi.fn(() => new Promise<DesktopThemePickerSnapshot>((done, fail) => { resolve = done; reject = fail; }));
  const onShellThemeChange = vi.fn(() => new Promise<DesktopThemePickerSnapshot>((done, fail) => { resolve = done; reject = fail; }));
  dispose = render(() => <DesktopThemePicker active={active()} snapshot={snapshot()} i18n={createDesktopI18n('en-US')} onSourceChange={onSourceChange} onShellThemeChange={onShellThemeChange} />, host);
  return { snapshot, setSnapshot, setActive, onSourceChange, onShellThemeChange, accept(next: DesktopThemePickerSnapshot) { setSnapshot(next); resolve(next); }, reject(error: Error) { reject(error); } };
}
function preset(name: string) { return document.querySelector<HTMLButtonElement>(`[data-theme-preset="${name}"]`)!; }

describe('Desktop appearance', () => {
  it('uses the published compact picker without an extra heading or trigger', () => {
    mount();
    expect(document.querySelector('.floe-theme-picker')).not.toBeNull();
    expect(document.querySelector('h2, [aria-haspopup="dialog"]')).toBeNull();
    expect(document.querySelectorAll('[data-theme-preset]')).toHaveLength(15);
  });
  it('retains authoritative selection, serializes pending writes and surfaces failure for explicit retry', async () => {
    const view = mount(); preset('nord').click(); preset('soft-black').click();
    expect(preset('nord').getAttribute('aria-busy')).toBe('true');
    expect(preset('porcelain-dark').getAttribute('aria-checked')).toBe('true');
    expect(view.onShellThemeChange).not.toHaveBeenCalled();
    expect(document.querySelector('[role=status]')?.textContent).toContain('Switching appearance');
    await vi.waitFor(() => expect(view.onShellThemeChange).toHaveBeenCalledTimes(1));
    view.reject(new Error('offline'));
    await vi.waitFor(() => expect(document.querySelector('[role="alert"]')?.textContent).toContain('Could not update'));
    expect(preset('porcelain-dark').getAttribute('aria-checked')).toBe('true');
    view.setActive(false); view.setActive(true);
    expect(document.querySelector('[role=alert]')?.textContent).toContain('Could not update');
    preset('nord').click();
    await vi.waitFor(() => expect(view.onShellThemeChange).toHaveBeenCalledTimes(2));
    view.accept({ ...view.snapshot(), shellThemes: { light: 'porcelain-light', dark: 'nord' } });
    await vi.waitFor(() => expect(preset('nord').getAttribute('aria-checked')).toBe('true'));
    expect(view.snapshot().source).toBe('system');
  });
  it('rejects new choices from a retained hidden category and cancels pre-paint admission', async () => {
    const view = mount(); preset('nord').click(); view.setActive(false);
    await vi.waitFor(() => expect(preset('nord').getAttribute('aria-busy')).toBe('false'));
    expect(view.onShellThemeChange).not.toHaveBeenCalled();
    preset('soft-black').click();
    expect(view.onShellThemeChange).not.toHaveBeenCalled();
  });
  it('selects a color mode through the native authority and validates its acknowledgement', async () => {
    const view = mount();
    const light = [...document.querySelectorAll<HTMLButtonElement>('.floe-theme-picker__modes [role=radio]')].find(button => button.textContent === 'Light')!;
    light.click();
    expect(light.getAttribute('aria-checked')).toBe('false');
    await vi.waitFor(() => expect(view.onSourceChange).toHaveBeenCalledWith('light'));
    view.accept({ ...view.snapshot(), source: 'system' });
    await vi.waitFor(() => expect(document.querySelector('[role=alert]')).not.toBeNull());
    light.click();
    await vi.waitFor(() => expect(view.onSourceChange).toHaveBeenCalledTimes(2));
    view.accept({ ...view.snapshot(), source: 'light', resolvedTheme: 'light' });
    await vi.waitFor(() => expect(light.getAttribute('aria-checked')).toBe('true'));
    expect(preset('porcelain-light')).not.toBeNull();
  });
  it.each(['mode', 'preset'])('retires a deferred %s choice after hiding and immediately returning', async kind => {
    const view = mount();
    const target = kind === 'preset' ? preset('nord') : [...document.querySelectorAll<HTMLButtonElement>('.floe-theme-picker__modes [role=radio]')].find(node => node.textContent === 'Light')!;
    target.click(); view.setActive(false); view.setActive(true);
    await vi.waitFor(() => expect(target.getAttribute('aria-busy')).toBe('false'));
    expect(view.onSourceChange).not.toHaveBeenCalled(); expect(view.onShellThemeChange).not.toHaveBeenCalled();
    target.click();
    await vi.waitFor(() => expect(kind === 'preset' ? view.onShellThemeChange : view.onSourceChange).toHaveBeenCalledTimes(1));
    view.accept(kind === 'preset' ? { ...view.snapshot(), shellThemes: { ...view.snapshot().shellThemes, dark: 'nord' } } : { ...view.snapshot(), source: 'light' });
  });
  it('keeps keyboard focus when system appearance replaces the focused preset', async () => {
    const view = mount(); preset('porcelain-dark').focus();
    view.setSnapshot({ ...view.snapshot(), resolvedTheme: 'light' });
    await vi.waitFor(() => expect(document.activeElement).toBe(preset('porcelain-light')));
  });
});

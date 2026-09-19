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
  const [snapshot, setSnapshot] = createSignal<DesktopThemePickerSnapshot>({ source: 'system', resolvedTheme: 'dark', shellThemes: { light: 'porcelain-light', dark: 'porcelain-dark' } });
  let resolve!: (value: DesktopThemePickerSnapshot) => void;
  let reject!: (reason: Error) => void;
  const onSourceChange = vi.fn(() => new Promise<DesktopThemePickerSnapshot>((done, fail) => { resolve = done; reject = fail; }));
  const onShellThemeChange = vi.fn(() => new Promise<DesktopThemePickerSnapshot>((done, fail) => { resolve = done; reject = fail; }));
  dispose = render(() => <DesktopThemePicker openRequest={0} snapshot={snapshot()} i18n={createDesktopI18n('en-US')} onSourceChange={onSourceChange} onShellThemeChange={onShellThemeChange} />, host);
  const trigger = host.querySelector<HTMLButtonElement>('[aria-haspopup="dialog"]')!;
  trigger.click();
  return { snapshot, setSnapshot, trigger, onSourceChange, onShellThemeChange, accept(next: DesktopThemePickerSnapshot) { setSnapshot(next); resolve(next); }, reject(error: Error) { reject(error); } };
}
function preset(name: string) { return document.querySelector<HTMLButtonElement>(`[data-desktop-theme-preset="${name}"]`)!; }

describe('Desktop appearance interaction', () => {
  it('paints loading before sending a write, deduplicates pending clicks and keeps the checked option authoritative', async () => {
    const view = mount();
    preset('nord').click();
    expect(preset('nord').getAttribute('aria-busy')).toBe('true');
    expect(preset('nord').getAttribute('aria-checked')).toBe('false');
    expect(preset('porcelain-dark').getAttribute('aria-checked')).toBe('true');
    expect(document.querySelector('[role="status"]')?.textContent).toContain('Switching appearance');
    expect(view.onShellThemeChange).not.toHaveBeenCalled();
    preset('nord').click(); preset('graphite').click();
    await vi.waitFor(() => expect(view.onShellThemeChange).toHaveBeenCalledTimes(1));
    expect(view.onShellThemeChange).toHaveBeenCalledWith('dark', 'nord');
    view.accept({ ...view.snapshot(), shellThemes: { light: 'porcelain-light', dark: 'nord' } });
    await vi.waitFor(() => expect(view.trigger.getAttribute('aria-busy')).toBe('false'));
    expect(preset('nord').getAttribute('aria-checked')).toBe('true');
    expect(view.snapshot().source).toBe('system');
  });

  it('allows closing during a pending write and presents a failed write on reopening', async () => {
    const view = mount(); preset('nord').click();
    await vi.waitFor(() => expect(view.onShellThemeChange).toHaveBeenCalled());
    document.querySelector<HTMLButtonElement>('.redeven-theme-picker__close')!.click();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    view.reject(new Error('unavailable'));
    await vi.waitFor(() => expect(view.trigger.getAttribute('aria-busy')).toBe('false'));
    view.trigger.click();
    expect(document.querySelector('[role="alert"]')?.textContent).toBe('Could not update appearance. Try again.');
    expect(preset('porcelain-dark').getAttribute('aria-checked')).toBe('true');
    preset('nord').click();
    await vi.waitFor(() => expect(view.onShellThemeChange).toHaveBeenCalledTimes(2));
    view.accept({ ...view.snapshot(), shellThemes: { light: 'porcelain-light', dark: 'nord' } });
  });

  it('retains the open picker and keyboard focus when system appearance replaces the focused preset', async () => {
    const view = mount();
    await vi.waitFor(() => expect(document.activeElement?.getAttribute('role')).toBe('radio'));
    preset('porcelain-dark').focus();
    view.setSnapshot({ ...view.snapshot(), resolvedTheme: 'light' });
    await vi.waitFor(() => expect(document.activeElement).toBe(preset('porcelain-light')));
    expect(document.querySelector('[role="dialog"]')).toBeTruthy();
  });
});

import '../index.css';
import './flower-feature.css';

import { commands, page } from 'vitest/browser';
import { expect, it, onTestFinished, vi } from 'vitest';
import { adapter, renderSurface, renderSurfaceWithAdapterProps, waitFor } from './FlowerSurface.navigation.testHarness';

it.each([
  ['light', 'page'], ['dark', 'page'],
  ['light', 'companion'], ['dark', 'companion'],
] as const)('keeps the %s %s composer appearance unchanged when focus moves', async (theme, presentation) => {
  await page.viewport(1280, 900);
  const previousClass = document.documentElement.className;
  document.documentElement.classList.toggle('dark', theme === 'dark');
  document.documentElement.classList.toggle('light', theme === 'light');
  onTestFinished(() => { document.documentElement.className = previousClass; });
  const runtime = renderSurfaceWithAdapterProps(adapter(true), presentation === 'companion'
    ? { presentation: 'companion', companionOpen: true } : {});
  Object.assign(runtime.style, { width: '900px', height: '700px' });
  await waitFor(() => Boolean(runtime.querySelector('.flower-composer textarea:not(:disabled)')));
  const composer = runtime.querySelector<HTMLElement>('.flower-composer')!;
  const editor = composer.querySelector('textarea')!;
  editor.value = 'Retained draft';
  editor.dispatchEvent(new Event('input', { bubbles: true }));
  editor.blur();
  await document.fonts.ready;
  await new Promise(resolve => setTimeout(resolve, 180));
  const appearance = () => {
    const style = getComputedStyle(composer);
    const bounds = composer.getBoundingClientRect();
    return {
      borders: ['top', 'right', 'bottom', 'left'].map(side => ({
        color: style.getPropertyValue(`border-${side}-color`),
        width: style.getPropertyValue(`border-${side}-width`),
      })),
      background: style.backgroundColor,
      shadow: style.boxShadow,
      outline: style.outline,
      width: bounds.width, height: bounds.height,
    };
  };
  const unfocused = appearance();
  for (let cycle = 0; cycle < 2; cycle += 1) {
    editor.focus();
    editor.setSelectionRange(2, 7);
    expect(document.activeElement).toBe(editor);
    await new Promise(resolve => requestAnimationFrame(resolve));
    expect(appearance()).toEqual(unfocused);
    await new Promise(resolve => setTimeout(resolve, 180));
    expect(appearance()).toEqual(unfocused);
    editor.blur();
    await new Promise(resolve => setTimeout(resolve, 180));
    expect(appearance()).toEqual(unfocused);
  }
  expect(editor.value).toBe('Retained draft');
  expect([editor.selectionStart, editor.selectionEnd]).toEqual([2, 7]);
});

it('preserves the published composer focus indicator in forced colors', async () => {
  const media = commands as unknown as { emulateMediaPreferences: (preferences: { forcedColors: 'active' | 'none' }) => Promise<void> };
  await media.emulateMediaPreferences({ forcedColors: 'active' });
  onTestFinished(() => media.emulateMediaPreferences({ forcedColors: 'none' }));
  const runtime = renderSurface();
  await waitFor(() => Boolean(runtime.querySelector('.flower-composer textarea:not(:disabled)')));
  const composer = runtime.querySelector<HTMLElement>('.flower-composer')!;
  const editor = composer.querySelector('textarea')!;
  editor.focus();
  expect(getComputedStyle(composer).getPropertyValue('--floe-input-focus-color').trim()).toBe('Highlight');
});

it('focuses composer padding only after a completed tap and preserves an existing selection', async () => {
  await page.viewport(393, 852);
  const runtime = renderSurface();
  await waitFor(() => Boolean(runtime.querySelector('.flower-composer textarea')));
  const composer = runtime.querySelector<HTMLDivElement>('.flower-composer')!;
  const editor = composer.querySelector('textarea')!;
  editor.value = 'Retained draft';
  editor.dispatchEvent(new Event('input', { bubbles: true }));
  editor.blur();
  const focus = vi.spyOn(editor, 'focus');
  try {
    // Real iPhone: focusing on pointerdown opens the keyboard before Safari's
    // delayed compatibility click, which can then hit outside the moved editor.
    composer.dispatchEvent(new PointerEvent('pointerdown', {
      bubbles: true, cancelable: true, button: 0, pointerType: 'touch',
    }));
    expect(document.activeElement).not.toBe(editor);
    expect(focus).not.toHaveBeenCalled();
    composer.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerType: 'touch' }));
    expect(focus).not.toHaveBeenCalled();

    composer.click();
    expect(document.activeElement).toBe(editor);
    expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });
    expect(editor.selectionStart).toBe(editor.value.length);
    editor.setSelectionRange(2, 7);
    composer.click();
    expect([editor.selectionStart, editor.selectionEnd]).toEqual([2, 7]);
    expect(editor.value).toBe('Retained draft');
    expect(runtime.querySelector('.flower-composer textarea')).toBe(editor);
    focus.mockClear();
    editor.click();
    expect(focus).not.toHaveBeenCalled();
  } finally {
    focus.mockRestore();
  }
});

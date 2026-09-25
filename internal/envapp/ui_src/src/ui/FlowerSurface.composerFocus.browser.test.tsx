import '../index.css';
import './flower-feature.css';

import { page } from 'vitest/browser';
import { expect, it, vi } from 'vitest';
import { renderSurface, waitFor } from './FlowerSurface.navigation.testHarness';

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

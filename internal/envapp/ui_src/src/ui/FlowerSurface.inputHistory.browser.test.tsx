import '../index.css';
import './flower-feature.css';

import { page, userEvent } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import {
  adapter, liveBootstrap, renderSurfaceWithAdapterProps, thread, waitFor,
} from './FlowerSurface.navigation.testHarness';

const longInput = 'First line\n第二行 🙂\nthird\nfourth\nfifth\nsixth\nlast';

async function mountHistory(options: { companion?: boolean; projected?: boolean; texts?: string[] } = {}) {
  const selected = thread({ messages: (options.texts ?? [longInput, 'Latest input']).map((content, index) => ({
    id: `input-${index}`, turn_id: `turn-${index}`, role: 'user' as const, content, status: 'complete' as const, created_at_ms: index + 1,
  })) });
  const host = { ...adapter(), listThreads: vi.fn(async () => [selected]), loadThread: vi.fn(async () => liveBootstrap(selected)) };
  const runtime = renderSurfaceWithAdapterProps(host, {
    presentation: options.companion ? 'companion' : 'full', companionOpen: true, layout: true,
    focusThreadRequest: { request_id: 'history-browser', thread_id: selected.thread_id },
  });
  if (options.projected) {
    runtime.style.transform = 'translate(20px, 20px) scale(0.85)';
    runtime.style.transformOrigin = 'top left';
  }
  await waitFor(() => runtime.querySelector('[data-flower-selected-thread-loading="false"]') !== null
    && runtime.querySelector('.flower-composer textarea') !== null);
  const editor = runtime.querySelector('.flower-composer textarea') as HTMLTextAreaElement;
  editor.focus();
  expect(editor.placeholder).toBe('Ask Flower...');
  return { runtime, editor, host };
}

describe('Flower input history browser interaction', () => {
  for (const placement of ['activity', 'workbench', 'companion', 'narrow'] as const) {
    it(`recalls and edits multiline history without losing focus in ${placement}`, async () => {
      await page.viewport(placement === 'narrow' ? 390 : 1280, 900);
      const { editor, host } = await mountHistory({ companion: placement === 'companion', projected: placement === 'workbench' });
      const initialHeight = editor.getBoundingClientRect().height;
      await userEvent.keyboard('{ArrowDown}'); expect(editor.value).toBe('');
      await userEvent.keyboard('{ArrowUp}'); expect(editor.value).toBe('Latest input');
      await userEvent.keyboard('{ArrowUp}'); expect(editor.value).toBe(longInput);
      await waitFor(() => editor.getBoundingClientRect().height > initialHeight);
      expect(editor.selectionStart).toBe(longInput.length);
      expect(editor.selectionEnd).toBe(longInput.length);
      expect(document.activeElement).toBe(editor);
      expect(getComputedStyle(editor).overflowY).toBe('auto');
      await userEvent.keyboard('{ArrowDown}{ArrowDown}'); expect(editor.value).toBe('');
      await waitFor(() => editor.getBoundingClientRect().height <= initialHeight + 1);
      await userEvent.keyboard('{ArrowUp}{ArrowUp}{ArrowLeft}{ArrowDown}');
      expect(editor.value).toBe(longInput);
      await userEvent.keyboard(' edited{Escape}');
      expect(editor.value).toContain(' edited');
      expect(host.launchTurn).not.toHaveBeenCalled();
      expect(editor.getBoundingClientRect().right).toBeLessThanOrEqual(placement === 'narrow' ? 390 : 1280);
    });
  }

  it('does not let recalled slash or reference tokens take over history navigation', async () => {
    const { runtime, editor } = await mountHistory({ texts: ['ordinary', '/comp', '@src'] });
    await userEvent.keyboard('{ArrowUp}'); expect(editor.value).toBe('@src');
    expect(runtime.querySelector('.flower-composer-reference-menu')).toBeNull();
    await userEvent.keyboard('{ArrowUp}'); expect(editor.value).toBe('/comp');
    expect(editor.getAttribute('aria-expanded')).not.toBe('true');
    await userEvent.keyboard('{ArrowUp}'); expect(editor.value).toBe('ordinary');
    await userEvent.keyboard('{Escape}'); expect(editor.value).toBe('');
    await userEvent.keyboard('/comp');
    await waitFor(() => editor.getAttribute('aria-expanded') === 'true');
  });
});

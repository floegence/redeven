import '../index.css';
import './flower-feature.css';

import { page, userEvent } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';

import {
  adapter,
  deferred,
  liveBootstrap,
  renderSurfaceWithAdapter,
  thread,
  waitFor,
} from './FlowerSurface.navigation.testHarness';

function expectContained(child: DOMRect, parent: DOMRect): void {
  expect(child.left).toBeGreaterThanOrEqual(parent.left - 1);
  expect(child.right).toBeLessThanOrEqual(parent.right + 1);
  expect(child.top).toBeGreaterThanOrEqual(parent.top - 1);
  expect(child.bottom).toBeLessThanOrEqual(parent.bottom + 1);
}

describe('Flower canonical reference browser presentation', () => {
  it('keeps canonical references and attachments usable without narrow-screen overflow', async () => {
    await page.viewport(375, 812);
    const completion = deferred<void>();
    const openCanonicalReference = vi.fn(() => completion.promise);
    const canonicalThread = thread({
      thread_id: 'thread-canonical-reference-browser',
      title: 'Canonical reference browser layout',
      messages: [{
        id: 'entry-canonical-reference-browser',
        turn_id: 'turn-canonical-reference-browser',
        thread_id: 'thread-canonical-reference-browser',
        role: 'user',
        content: '请检查这些引用和附件是否按照原始消息完整展示。',
        status: 'complete',
        created_at_ms: 1_000,
        blocks: [{
          type: 'file',
          name: 'deployment-observability-and-reliability-review-notes.txt',
          size: 12_345,
          mimeType: 'text/plain',
          url: 'data:text/plain,review',
        }],
        references: [
          {
            reference_id: 'context:text',
            kind: 'text',
            label: '这是一段用于验证窄屏省略、Unicode 排版和焦点边界的超长引用标题',
            text: '引用正文包含中文、English、かな、한글与 emoji，并且不会撑破消息气泡。',
            truncated: true,
          },
          {
            reference_id: 'context:file',
            kind: 'file',
            label: 'src/features/flower/reliability/canonical-reference-navigation.ts',
          },
          {
            reference_id: 'context:directory',
            kind: 'directory',
            label: 'src/features/flower/reliability/fixtures',
          },
          {
            reference_id: 'context:terminal',
            kind: 'terminal',
            label: 'Terminal output',
            text: 'pnpm test:browser\nPASS canonical references',
          },
          {
            reference_id: 'context:process',
            kind: 'process',
            label: 'redeven-env-app (4242)',
            text: 'CPU 12.5% · Memory 128 MB',
          },
        ],
      }],
    });
    const canonicalBootstrap = liveBootstrap(canonicalThread);
    const threadLoad = deferred<typeof canonicalBootstrap>();
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => [canonicalThread]),
      loadThread: vi.fn(() => threadLoad.promise),
      openCanonicalReference,
    });

    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-canonical-reference-browser"] button')));
    (runtime.querySelector('[data-thread-id="thread-canonical-reference-browser"] button') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelectorAll('[data-flower-chat-context-chip="true"]').length === 5);
    await waitFor(() => {
      const transcript = runtime.querySelector('.flower-chat-transcript');
      return Boolean(transcript)
        && !transcript?.hasAttribute('data-flower-tail-preparing')
        && transcript?.getAttribute('aria-busy') !== 'true';
    });

    const surface = runtime.querySelector('#redeven-flower-surface') as HTMLElement;
    expect(surface.getAttribute('data-flower-selected-thread-loading')).toBe('true');
    const message = runtime.querySelector('[data-flower-message-id="entry-canonical-reference-browser"]') as HTMLElement;
    const bubble = message.querySelector('.flower-chat-context-unified-bubble') as HTMLElement;
    const attachment = bubble.querySelector('.flower-message-file') as HTMLElement;
    const context = bubble.querySelector('.flower-chat-context-chips') as HTMLElement;
    const grid = context.querySelector('.flower-chat-context-chips-grid') as HTMLElement;
    const chips = Array.from(grid.querySelectorAll<HTMLElement>('[data-flower-chat-context-chip="true"]'));

    expect(surface.scrollWidth).toBeLessThanOrEqual(surface.clientWidth + 1);
    expect(message.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth + 1);
    expect(bubble.scrollWidth).toBeLessThanOrEqual(bubble.clientWidth + 1);
    expect(grid.scrollWidth).toBeLessThanOrEqual(grid.clientWidth + 1);
    expectContained(attachment.getBoundingClientRect(), bubble.getBoundingClientRect());
    expect(attachment.getBoundingClientRect().bottom).toBeLessThanOrEqual(context.getBoundingClientRect().top + 1);

    const gridRect = grid.getBoundingClientRect();
    for (const chip of chips) {
      expectContained(chip.getBoundingClientRect(), gridRect);
      expect(chip.scrollWidth).toBeLessThanOrEqual(chip.clientWidth + 1);
    }
    for (let index = 1; index < chips.length; index += 1) {
      expect(chips[index - 1]!.getBoundingClientRect().bottom)
        .toBeLessThanOrEqual(chips[index]!.getBoundingClientRect().top + 1);
    }

    const longLabel = chips[0]!.querySelector('.flower-chat-context-chip-label') as HTMLElement;
    expect(longLabel.scrollWidth).toBeGreaterThan(longLabel.clientWidth);
    expect(getComputedStyle(longLabel).textOverflow).toBe('ellipsis');

    const fileChip = chips[1] as HTMLButtonElement;
    attachment.focus();
    expect(document.activeElement).toBe(attachment);

    threadLoad.resolve(canonicalBootstrap);
    await waitFor(() => surface.getAttribute('data-flower-selected-thread-loading') === 'false');

    const refreshedAttachment = runtime.querySelector('.flower-chat-context-unified-bubble .flower-message-file') as HTMLElement;
    const refreshedFileChip = runtime.querySelectorAll('[data-flower-chat-context-chip="true"]')[1] as HTMLButtonElement;
    expect(refreshedAttachment).toBe(attachment);
    expect(refreshedFileChip).toBe(fileChip);
    expect(document.activeElement).toBe(attachment);

    fileChip.focus();
    expect(document.activeElement).toBe(fileChip);
    await userEvent.keyboard('{Enter}');
    fileChip.click();
    await waitFor(() => openCanonicalReference.mock.calls.length === 1);

    expect(fileChip.disabled).toBe(true);
    expect(fileChip.getAttribute('aria-busy')).toBe('true');
    expect(openCanonicalReference).toHaveBeenCalledWith({
      thread_id: 'thread-canonical-reference-browser',
      turn_id: 'turn-canonical-reference-browser',
      reference_id: 'context:file',
    });

    completion.resolve();
    await waitFor(() => fileChip.disabled === false);
    expect(document.activeElement).toBe(fileChip);
    expect((await page.screenshot({ save: false })).length).toBeGreaterThan(1_000);
  });
});

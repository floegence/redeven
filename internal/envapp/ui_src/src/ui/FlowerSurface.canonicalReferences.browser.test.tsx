import '../index.css';
import './flower-feature.css';

import { page, userEvent } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';
import { builtInShellThemePresets } from '@floegence/floe-webapp-core/themes';

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
    const canvas = document.createElement('canvas');
    canvas.width = 240; canvas.height = 160;
    const paint = canvas.getContext('2d')!;
    paint.fillStyle = '#23816d'; paint.fillRect(0, 0, 240, 160);
    const image = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), 'image/png'));
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
        blocks: [
          { type: 'image', src: 'https://example.test/attachments/design.png', alt: 'design.png' }, {
          type: 'file',
          name: 'deployment-observability-and-reliability-review-notes.txt',
          size: 12_345,
          mimeType: 'text/plain',
          url: 'https://example.test/attachments/review.txt',
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
          { reference_id: 'context:image', kind: 'file', label: 'preview.png' },
          { reference_id: 'context:config', kind: 'file', label: 'config.json' },
          { reference_id: 'context:pdf', kind: 'file', label: 'report.pdf' },
          { reference_id: 'context:page', kind: 'text', label: 'Files page', text: JSON.stringify({ environment: { id: 'env', name: 'Development' }, page: { id: 'files', name: 'Files' }, captured_at: '2026-10-16T00:00:00Z' }) },
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
      loadMessageAttachment: vi.fn(async () => image),
    });

    // At this width the real navigation is a drawer. Open it before selecting
    // history, then keep the original narrow conversation geometry assertions.
    await waitFor(() => Boolean(runtime.querySelector('.flower-chat-header .flower-mobile-navigation-button')));
    await userEvent.click(runtime.querySelector<HTMLButtonElement>('.flower-chat-header .flower-mobile-navigation-button')!);
    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-canonical-reference-browser"] button')));
    (runtime.querySelector('[data-thread-id="thread-canonical-reference-browser"] button') as HTMLButtonElement).click();
    const surface = runtime.querySelector('#redeven-flower-surface') as HTMLElement;
    await waitFor(() => surface.getAttribute('data-flower-selected-thread-loading') === 'true');
    expect(runtime.querySelectorAll('[data-flower-chat-context-chip="true"]')).toHaveLength(0);

    threadLoad.resolve(canonicalBootstrap);
    await waitFor(() => runtime.querySelectorAll('[data-flower-chat-context-chip="true"]').length === 9);
    await waitFor(() => surface.getAttribute('data-flower-selected-thread-loading') === 'false');
    await waitFor(() => {
      const transcript = runtime.querySelector('.flower-chat-transcript');
      return Boolean(transcript)
        && !transcript?.hasAttribute('data-flower-tail-preparing')
        && transcript?.getAttribute('aria-busy') !== 'true';
    });

    await waitFor(() => Boolean(runtime.querySelector<HTMLImageElement>('.flower-message-image img')?.naturalWidth));
    const message = runtime.querySelector('[data-flower-message-id="entry-canonical-reference-browser"]') as HTMLElement;
    const bubble = message.querySelector('.flower-message-bubble-user') as HTMLElement;
    expect(bubble).not.toBeNull();
    expect(bubble.querySelector('p')?.textContent).toBe(canonicalThread.messages[0]!.content);
    expect(message.querySelector('.flower-chat-context-unified-bubble')).toBeNull();
    expect(bubble.querySelector('.flower-chat-context-chips')).toBeNull();
    expect(bubble.querySelector('.flower-message-file')).toBeNull();
    message.setAttribute('data-testid', 'canonical-reference-bubble');
    const grid = message.querySelector('.flower-message-resources') as HTMLElement;
    expect(grid).not.toBeNull();
    const media = message.querySelector('.flower-message-images')!;
    expect(media.getBoundingClientRect().bottom).toBeLessThanOrEqual(grid.getBoundingClientRect().top);
    expect(message.querySelector('[data-flower-context-icon="page_context"]')).not.toBeNull();
    expect(grid.querySelector('.flower-chat-context-chips-divider')).toBeNull();
    const attachment = grid.querySelector('.flower-message-file') as HTMLElement;
    const chips = Array.from(grid.querySelectorAll<HTMLElement>('[data-flower-chat-context-chip="true"]'));

    expect(surface.scrollWidth).toBeLessThanOrEqual(surface.clientWidth + 1);
    expect(message.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth + 1);
    expect(bubble.scrollWidth).toBeLessThanOrEqual(bubble.clientWidth + 1);
    expect(grid.scrollWidth).toBeLessThanOrEqual(grid.clientWidth + 1);
    expectContained(attachment.getBoundingClientRect(), grid.getBoundingClientRect());
    expect(grid.getBoundingClientRect().bottom).toBeLessThanOrEqual(bubble.getBoundingClientRect().top);
    expect(attachment.getBoundingClientRect().top).toBe(chips[0]!.getBoundingClientRect().top);
    expect(attachment.getBoundingClientRect().width).toBe(chips[0]!.getBoundingClientRect().width);

    const gridRect = grid.getBoundingClientRect();
    for (const chip of chips) {
      expectContained(chip.getBoundingClientRect(), gridRect);
      expect(chip.scrollWidth).toBeLessThanOrEqual(chip.clientWidth + 1);
    }
    for (const [index, kind] of [[1, 'ts'], [2, 'folder'], [5, 'image'], [6, 'json'], [7, 'pdf']] as const) {
      const icon = chips[index].querySelector<SVGSVGElement>('svg')!;
      expect(icon.getAttribute('data-file-icon-type')).toBe(kind);
      expect(icon.getBoundingClientRect().width).toBe(24);
      expect(icon.getAttribute('aria-hidden')).toBe('true');
    }
    for (const index of [3, 4]) {
      const icon = chips[index]!.querySelector('svg')!;
      expect(icon).not.toBeNull();
      expect(icon.getBoundingClientRect().width).toBe(24);
      expect(icon.getBoundingClientRect().height).toBe(24);
      expect(getComputedStyle(icon).stroke).not.toBe('none');
    }
    expect(attachment.querySelector('svg')?.getAttribute('data-file-icon-size')).toBe('detailed');
    expect(attachment.querySelector('svg')?.getBoundingClientRect().width).toBe(24);
    for (let index = 2; index < chips.length; index += 1) {
      expect(chips[index - 2]!.getBoundingClientRect().bottom)
        .toBeLessThanOrEqual(chips[index]!.getBoundingClientRect().top + 1);
    }

    expect(chips[0]!.querySelector('[data-file-icon-kind]')).toBeNull();
    const longLabel = chips[0]!.querySelector('.flower-chat-context-chip-label') as HTMLElement;
    expect(longLabel.scrollWidth).toBeGreaterThan(longLabel.clientWidth);
    expect(getComputedStyle(longLabel).textOverflow).toBe('ellipsis');

    const fileChip = chips[1] as HTMLButtonElement;
    // A bottom drawer has no side attribute and keeps the background inert
    // throughout its exit. Wait for the shared modal boundary to release it.
    await waitFor(() => !runtime.querySelector('[data-floe-dialog-overlay-root]') && !attachment.closest('[inert]'));
    attachment.focus();
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
    const mediaNode = media.querySelector('img');
    try {
      for (const name of ['classic-light', 'classic-dark']) {
        const preset = builtInShellThemePresets.find(preset => preset.name === name)!;
        document.documentElement.classList.toggle('dark', preset.mode === 'dark');
        document.documentElement.classList.toggle('light', preset.mode === 'light');
        for (const [token, value] of Object.entries(preset.semanticTokens ?? {}))
          if (value) document.documentElement.style.setProperty(token, value);
        document.documentElement.dataset.floeShellTheme = name;
        await page.screenshot({ element: page.getByTestId('canonical-reference-bubble'), path: `./__screenshots__/flower-reference-icons-${name}.png` });
      }
      for (const [width, columns] of [[1200, 3], [320, 1]] as const) {
        await page.viewport(width, 900);
        await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
        const cards = [attachment, ...chips];
        const firstTop = cards[0]!.getBoundingClientRect().top;
        expect(cards.filter(card => Math.abs(card.getBoundingClientRect().top - firstTop) < 1)).toHaveLength(columns);
        expect(cards.at(-1)!.getBoundingClientRect().right).toBeCloseTo(grid.getBoundingClientRect().right, 0);
        for (const card of cards) expectContained(card.getBoundingClientRect(), grid.getBoundingClientRect());
        expect(surface.scrollWidth).toBeLessThanOrEqual(surface.clientWidth + 1);
        expect(media.querySelector('img')).toBe(mediaNode);
        await page.screenshot({ element: page.getByTestId('canonical-reference-bubble'), path: './__screenshots__/flower-message-resources-' + width + '.png' });
      }
    } finally {
      document.documentElement.removeAttribute('data-floe-shell-theme');
      document.documentElement.classList.remove('dark', 'light');
      document.documentElement.removeAttribute('style');
    }
  });

  it('renders reference-only messages without a bubble and previews their exact frozen text', async () => {
    await page.viewport(1200, 900);
    const frozen = 'const answer = 42;';
    const conversation = thread({ thread_id: 'references-only', messages: [{
      id: 'only-references', turn_id: 'only-turn', role: 'user', content: '', created_at_ms: 1, status: 'complete',
      references: [{ reference_id: 'selection', kind: 'text', label: 'Selected code', text: frozen }],
    }] });
    const runtime = renderSurfaceWithAdapter({ ...adapter(true), listThreads: async () => [conversation],
      loadThread: async () => liveBootstrap(conversation) });
    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="references-only"] button')));
    runtime.querySelector<HTMLButtonElement>('[data-thread-id="references-only"] button')!.click();
    await waitFor(() => Boolean(runtime.querySelector('[data-flower-message-id="only-references"]')));
    const message = runtime.querySelector('[data-flower-message-id="only-references"]')!;
    expect(message.querySelector('.flower-message-bubble')).toBeNull();
    expect(message.querySelector('.flower-message-images')).toBeNull();
    const card = message.querySelector<HTMLButtonElement>('.flower-message-resources button')!;
    expect(card.querySelector('svg')).not.toBeNull();
    await userEvent.click(card);
    await waitFor(() => document.querySelector('.flower-chat-context-preview-window pre')?.textContent === frozen);
    await userEvent.click(document.querySelector<HTMLButtonElement>('.flower-chat-context-preview-window [aria-label="Close"]')!);
    await waitFor(() => !document.querySelector('.flower-chat-context-preview-window'));
    expect(document.activeElement).toBe(card);
  });

});

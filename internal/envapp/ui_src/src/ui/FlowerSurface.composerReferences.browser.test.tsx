import '../index.css';
import './flower-feature.css';

import { page, userEvent } from 'vitest/browser';
import { describe, expect, it, vi } from 'vitest';

import type {
  FlowerAttachmentCapability,
  FlowerStagedAttachment,
} from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import {
  adapter,
  renderSurfaceWithAdapter,
  renderSurfaceWithAdapterProps,
  waitFor,
} from './FlowerSurface.navigation.testHarness';

describe('Flower composer reference browser interaction', () => {
  it('grows through five lines, scrolls from the sixth, and shrinks after deletion', async () => {
    await page.viewport(800, 900);
    const runtime = renderSurfaceWithAdapter({
      ...adapter(true),
      listThreads: vi.fn(async () => []),
    });

    await waitFor(() => Boolean(runtime.querySelector('.flower-composer textarea')));
    const textarea = runtime.querySelector('.flower-composer textarea') as HTMLTextAreaElement;
    const setText = async (value: string) => {
      textarea.value = value;
      textarea.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
      await waitFor(() => textarea.value === value);
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    };

    await setText('one');
    const oneLineHeight = textarea.getBoundingClientRect().height;
    await setText('one\ntwo\nthree\nfour\nfive');
    const fiveLineHeight = textarea.getBoundingClientRect().height;
    expect(fiveLineHeight).toBeGreaterThan(oneLineHeight);
    expect(getComputedStyle(textarea).overflowY).toBe('hidden');

    await setText('one\ntwo\nthree\nfour\nfive\nsix');
    const sixLineHeight = textarea.getBoundingClientRect().height;
    expect(Math.abs(sixLineHeight - fiveLineHeight)).toBeLessThanOrEqual(1);
    expect(getComputedStyle(textarea).overflowY).toBe('auto');
    expect(textarea.scrollHeight).toBeGreaterThan(textarea.clientHeight);

    await setText('one');
    expect(textarea.getBoundingClientRect().height).toBeLessThan(fiveLineHeight);
    expect(getComputedStyle(textarea).overflowY).toBe('hidden');
  });

  it('keeps reference autocomplete projected, keyboard-usable, and contained on a narrow surface', async () => {
    await page.viewport(320, 720);
    const capability: FlowerAttachmentCapability = {
      model_id: 'openai/gpt-5.2',
      revision: 'reference-browser-capability',
      enabled: true,
      supports_long_text: true,
      max_attachments: 4,
      max_file_size_bytes: 1_000_000,
      max_total_size_bytes: 2_000_000,
      routes: { 'text/plain': 'tool_read' },
    };
    const runtime = renderSurfaceWithAdapterProps({
      ...adapter(true),
      listThreads: vi.fn(async () => []),
      getWorkingDirectoryPathContext: vi.fn(async () => ({
        agentHomePathAbs: '/workspace',
        homePathAbs: '/workspace',
        defaultRootId: 'workspace',
        roots: [{
          id: 'workspace',
          label: 'Workspace',
          pathAbs: '/workspace',
          kind: 'workspace',
          permissions: { read: true, write: true },
        }],
      })),
      listWorkingDirectoryEntries: vi.fn(async ({ path }) => path === '/workspace'
        ? [
            { name: 'main.ts', path: '/workspace/main.ts', isDirectory: false, modifiedAt: 2 },
            { name: 'src', path: '/workspace/src', isDirectory: true, modifiedAt: 1 },
          ]
        : []),
      loadAttachmentCapability: vi.fn(async () => capability),
      uploadAttachment: vi.fn(async (): Promise<FlowerStagedAttachment> => {
        throw new Error('upload is not expected in the reference browser test');
      }),
    }, {
      presentation: 'companion',
      companionOpen: true,
      companionPresenceOwner: true,
      engaged: true,
      transcriptVisible: false,
    });
    const projectedHost = document.createElement('div');
    projectedHost.setAttribute('data-floe-dialog-surface-host', 'true');
    projectedHost.style.cssText = 'position:relative;width:300px;height:680px;transform:translate(12px, 8px) scale(0.9);transform-origin:top left;';
    const portalLayer = document.createElement('div');
    portalLayer.setAttribute('data-floe-surface-portal-layer', 'true');
    portalLayer.style.cssText = 'position:absolute;inset:0;';
    document.body.appendChild(portalLayer);
    portalLayer.appendChild(projectedHost);
    projectedHost.appendChild(runtime);

    await waitFor(() => Boolean(
      runtime.querySelector('textarea')
      && runtime.querySelector('.flower-composer-attachment-button'),
    ));
    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.focus();
    await userEvent.keyboard('@src');
    await waitFor(() => portalLayer.querySelector('[role="listbox"] [role="option"]') !== null);

    const listbox = portalLayer.querySelector('[role="listbox"]') as HTMLElement;
    const floatingLayer = listbox.closest('[data-floe-local-interaction-surface="true"]') as HTMLElement;
    expect(floatingLayer).toBeTruthy();
    expect(floatingLayer.getAttribute('data-flower-floating-layer')).toBe('true');
    expect(textarea.getAttribute('aria-activedescendant')).toBeTruthy();
    expect(listbox.getBoundingClientRect().left).toBeGreaterThanOrEqual(0);
    expect(listbox.getBoundingClientRect().right).toBeLessThanOrEqual(window.innerWidth + 1);

    const attachment = runtime.querySelector('.flower-composer-attachment-button') as HTMLButtonElement;
    const more = runtime.querySelector('.flower-composer-more-button') as HTMLButtonElement;
    expect(more).toBeTruthy();
    expect(attachment.compareDocumentPosition(more) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(attachment.offsetWidth).toBeGreaterThanOrEqual(44);
    expect(attachment.offsetHeight).toBeGreaterThanOrEqual(44);
    expect(more.offsetWidth).toBeGreaterThanOrEqual(44);
    expect(more.offsetHeight).toBeGreaterThanOrEqual(44);
    more.focus();
    await waitFor(() => portalLayer.querySelector('[role="listbox"]') === null);
    const currentMore = runtime.querySelector('.flower-composer-more-button') as HTMLButtonElement;
    expect(currentMore).toBeTruthy();
    await userEvent.click(currentMore);
    await waitFor(() => portalLayer.querySelector('[data-flower-composer-more-panel="true"]') !== null);
    const morePanel = portalLayer.querySelector('[data-flower-composer-more-panel="true"]') as HTMLElement;
    const moreLayer = morePanel.closest('[data-floe-local-interaction-surface="true"]') as HTMLElement;
    expect(moreLayer).toBeTruthy();
    expect(moreLayer.getAttribute('data-flower-floating-layer')).toBe('true');
    expect(morePanel.style.position).toBe('');
    expect(morePanel.style.left).toBe('');
    expect(morePanel.style.top).toBe('');
    await userEvent.click(currentMore);
    await waitFor(() => portalLayer.querySelector('[data-flower-composer-more-panel="true"]') === null);
    await waitFor(() => document.activeElement === currentMore);
    textarea.focus();
    await userEvent.keyboard('{Backspace}c');
    await waitFor(() => portalLayer.querySelector('[role="listbox"] [role="option"]') !== null);

    await userEvent.keyboard('{Enter}');
    await waitFor(() => runtime.querySelector('.flower-composer-reference-chip') !== null);
    const chip = runtime.querySelector('.flower-composer-reference-chip') as HTMLElement;
    const remove = runtime.querySelector('.flower-composer-reference-chip-remove') as HTMLButtonElement;
    expect(chip.getAttribute('data-reference-kind')).toBe('directory');
    expect(chip.scrollWidth).toBeLessThanOrEqual(chip.clientWidth + 1);
    expect(remove.offsetWidth).toBeGreaterThanOrEqual(44);
    expect(remove.offsetHeight).toBeGreaterThanOrEqual(44);

    expect(runtime.querySelector('#redeven-flower-surface')!.scrollWidth)
      .toBeLessThanOrEqual(runtime.querySelector('#redeven-flower-surface')!.clientWidth + 1);
    expect((await page.screenshot({ save: false })).length).toBeGreaterThan(1_000);
  });

  it('keeps attachment and More ordered and touch-sized in the compact companion', async () => {
    await page.viewport(1280, 900);
    document.documentElement.style.zoom = '4';
    const runtime = renderSurfaceWithAdapterProps({
      ...adapter(true),
      listThreads: vi.fn(async () => []),
      getWorkingDirectoryPathContext: vi.fn(async () => ({
        agentHomePathAbs: '/workspace',
        homePathAbs: '/workspace',
        defaultRootId: 'workspace',
        roots: [{
          id: 'workspace', label: 'Workspace', pathAbs: '/workspace', kind: 'workspace',
          permissions: { read: true, write: true },
        }],
      })),
      loadAttachmentCapability: vi.fn(async () => ({
        model_id: 'openai/gpt-5.2',
        revision: 'reference-browser-capability',
        enabled: true,
        supports_long_text: true,
        max_attachments: 4,
        max_file_size_bytes: 1_000_000,
        max_total_size_bytes: 2_000_000,
        routes: { 'text/plain': 'tool_read' as const },
      })),
    }, {
      presentation: 'companion',
      companionOpen: true,
      companionPresenceOwner: true,
      engaged: true,
      transcriptVisible: false,
    });

    try {
      await waitFor(() => runtime.querySelector('[data-flower-companion-compact="true"]') !== null);
      const attachment = runtime.querySelector('.flower-composer-attachment-button') as HTMLButtonElement;
      const more = runtime.querySelector('.flower-composer-more-button') as HTMLButtonElement;
      expect(attachment).toBeTruthy();
      expect(more).toBeTruthy();
      expect(attachment.compareDocumentPosition(more) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(attachment.getBoundingClientRect().width).toBeGreaterThanOrEqual(44);
      expect(attachment.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
      expect(more.getBoundingClientRect().width).toBeGreaterThanOrEqual(44);
      expect(more.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
      const normalizedGap = more.getBoundingClientRect().left - attachment.getBoundingClientRect().right;
      expect(normalizedGap).toBeGreaterThanOrEqual(-0.5);
      expect(normalizedGap).toBeLessThanOrEqual(2);
      await userEvent.click(more);
      await waitFor(() => document.querySelector('[data-flower-composer-more-panel="true"]') !== null);
      await userEvent.click(more);
      await waitFor(() => document.querySelector('[data-flower-composer-more-panel="true"]') === null);
      await waitFor(() => document.activeElement === runtime.querySelector('.flower-composer-more-button'));
      expect(runtime.querySelector('#redeven-flower-surface')!.scrollWidth)
        .toBeLessThanOrEqual(runtime.querySelector('#redeven-flower-surface')!.clientWidth + 1);
      expect((await page.screenshot({ save: false })).length).toBeGreaterThan(1_000);
    } finally {
      document.documentElement.style.zoom = '';
    }
  });
});

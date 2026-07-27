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
    const runtime = renderSurfaceWithAdapter({
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
    });

    await waitFor(() => Boolean(
      runtime.querySelector('textarea')
      && runtime.querySelector('.flower-composer-attachment-button'),
    ));
    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.focus();
    await userEvent.keyboard('@src');
    await waitFor(() => runtime.querySelector('[role="listbox"] [role="option"]') !== null);

    const listbox = runtime.querySelector('[role="listbox"]') as HTMLElement;
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
    expect(attachment.getBoundingClientRect().width).toBeGreaterThanOrEqual(44);
    expect(more.getBoundingClientRect().width).toBeGreaterThanOrEqual(44);
    more.focus();
    await waitFor(() => runtime.querySelector('[role="listbox"]') === null);
    const currentMore = runtime.querySelector('.flower-composer-more-button') as HTMLButtonElement;
    expect(currentMore).toBeTruthy();
    currentMore.click();
    await waitFor(() => runtime.querySelector('[data-flower-composer-more-panel="true"]') !== null);
    expect(runtime.querySelector('[data-flower-composer-more-panel="true"]')).toBeTruthy();
    currentMore.click();
    textarea.focus();
    await waitFor(() => runtime.querySelector('[role="listbox"] [role="option"]') !== null);

    await userEvent.keyboard('{Enter}');
    await waitFor(() => runtime.querySelector('.flower-composer-reference-chip') !== null);
    const chip = runtime.querySelector('.flower-composer-reference-chip') as HTMLElement;
    const remove = runtime.querySelector('.flower-composer-reference-chip-remove') as HTMLButtonElement;
    expect(chip.getAttribute('data-reference-kind')).toBe('directory');
    expect(chip.scrollWidth).toBeLessThanOrEqual(chip.clientWidth + 1);
    expect(remove.getBoundingClientRect().width).toBeGreaterThanOrEqual(44);
    expect(remove.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);

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
      expect(runtime.querySelector('#redeven-flower-surface')!.scrollWidth)
        .toBeLessThanOrEqual(runtime.querySelector('#redeven-flower-surface')!.clientWidth + 1);
      expect((await page.screenshot({ save: false })).length).toBeGreaterThan(1_000);
    } finally {
      document.documentElement.style.zoom = '';
    }
  });
});

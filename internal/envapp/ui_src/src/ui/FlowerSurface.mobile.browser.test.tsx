import '../index.css';
import './flower-feature.css';

import { describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { createSignal } from 'solid-js';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../../../../flower_ui/src/copy';
import { adapter, deferred, liveBootstrap, mutableSettingsAdapter, renderSurfaceWithAdapterProps, thread, waitFor } from './FlowerSurface.navigation.testHarness';

async function mountMobile(width: number, height = 720) {
  await page.viewport(width, height);
  const selected = thread({ title: 'Mobile conversation' });
  const runtime = renderSurfaceWithAdapterProps({
    ...adapter(true),
    listThreads: vi.fn(async () => [selected]),
    loadThread: vi.fn(async () => liveBootstrap(selected)),
  }, { focusThreadRequest: { request_id: 'mobile-thread', thread_id: selected.thread_id } });
  Object.assign(runtime.style, { height: '100%', width: '100%' });
  await waitFor(() => Boolean(runtime.querySelector('.flower-composer textarea:not(:disabled)')));
  return runtime;
}

describe('Flower mobile navigation', () => {
  it('keeps deliberate composer focus after closing More', async () => {
    const runtime = await mountMobile(393);
    const editor = runtime.querySelector<HTMLTextAreaElement>('.flower-composer textarea')!;
    await userEvent.fill(editor, 'Keep typing 中文');
    await userEvent.click(runtime.querySelector<HTMLButtonElement>('.flower-composer-more-button')!);
    const panel = document.querySelector<HTMLElement>('[data-flower-composer-more-panel]')!;
    panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    editor.focus({ preventScroll: true });
    editor.setSelectionRange(2, 7);
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    expect(document.querySelector('[data-flower-composer-more-panel]')).toBeNull();
    expect(document.activeElement).toBe(editor);
    expect(editor.value).toBe('Keep typing 中文');
    expect([editor.selectionStart, editor.selectionEnd]).toEqual([2, 7]);
  });

  it.each([320, 393, 430, 667, 767])('keeps permissions in More at %i pixels and restores desktop controls without losing the draft', async (width) => {
    await page.viewport(width, width === 667 ? 390 : 720);
    const testAdapter = mutableSettingsAdapter(true);
    const runtime = renderSurfaceWithAdapterProps(testAdapter, {});
    Object.assign(runtime.style, { height: '100%', width: '100%' });
    await waitFor(() => Boolean(runtime.querySelector('.flower-composer textarea:not(:disabled)')));
    const editor = runtime.querySelector<HTMLTextAreaElement>('.flower-composer textarea')!;
    await userEvent.fill(editor, 'Keep this mobile draft 中文');
    editor.setSelectionRange(2, 7);
    expect(runtime.querySelector('.flower-composer-controls-inline .flower-permission-selector')).toBeNull();
    const more = runtime.querySelector<HTMLButtonElement>('.flower-composer-more-button')!;
    expect(more).not.toBeNull();
    await userEvent.click(more);
    const panel = document.querySelector<HTMLElement>('[data-flower-composer-more-panel]')!;
    const permission = panel.querySelector<HTMLButtonElement>('.flower-permission-trigger')!;
    expect(permission).not.toBeNull();
    expect(permission.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    const label = permission.querySelector<HTMLElement>('.flower-permission-label')!;
    expect(label.clientWidth).toBeGreaterThan(0);
    expect(label.scrollWidth).toBe(label.clientWidth);
    await userEvent.click(permission);
    const menu = panel.querySelector<HTMLElement>('.flower-permission-menu')!;
    const bounds = menu.getBoundingClientRect();
    expect(bounds.left).toBeGreaterThanOrEqual(0);
    expect(bounds.right).toBeLessThanOrEqual(width);
    expect(bounds.top).toBeGreaterThanOrEqual(0);
    await userEvent.keyboard('{Escape}');
    await vi.waitFor(() => expect(panel.querySelector('.flower-permission-menu')).toBeNull());
    expect(panel.isConnected).toBe(true);
    await vi.waitFor(() => expect(document.activeElement).toBe(permission));
    await userEvent.keyboard('{Enter}');
    await vi.waitFor(() => expect(panel.querySelector('.flower-permission-menu')).not.toBeNull());
    await userEvent.click(panel.querySelector<HTMLButtonElement>('.flower-permission-menu [data-permission-type="full_access"]')!);
    expect(testAdapter.saveDefaultPermission).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(permission.getAttribute('data-permission-type')).toBe('full_access'));
    await userEvent.keyboard('{Escape}');
    await vi.waitFor(() => expect(document.querySelector('[data-flower-composer-more-panel]')).toBeNull());
    await vi.waitFor(() => expect(document.activeElement).toBe(more));
    await page.viewport(1280, 850);
    await vi.waitFor(() => expect(runtime.querySelector('.flower-composer-controls-inline .flower-permission-trigger')?.getAttribute('data-permission-type')).toBe('full_access'));
    expect(runtime.querySelector('.flower-composer textarea')).toBe(editor);
    expect(editor.value).toBe('Keep this mobile draft 中文');
    expect([editor.selectionStart, editor.selectionEnd]).toEqual([2, 7]);
  });

  it.each(['saved', 'failed'])('preserves thread permission submission and draft when a mobile change is %s', async (outcome) => {
    await page.viewport(393, 480);
    const selected = thread({ permission_type: 'approval_required', settings_revision: 10 });
    const response = deferred<ReturnType<typeof liveBootstrap>>();
    const setThreadPermissionType = vi.fn(() => response.promise);
    const runtime = renderSurfaceWithAdapterProps({
      ...adapter(true),
      listThreads: vi.fn(async () => [selected]),
      loadThread: vi.fn(async () => liveBootstrap(selected)),
      setThreadPermissionType,
    }, { focusThreadRequest: { request_id: 'mobile-permission', thread_id: selected.thread_id } });
    Object.assign(runtime.style, { height: '100%', width: '100%' });
    await waitFor(() => Boolean(runtime.querySelector('.flower-composer textarea:not(:disabled)')));
    const editor = runtime.querySelector<HTMLTextAreaElement>('.flower-composer textarea')!;
    await userEvent.fill(editor, 'Keep the thread draft');
    await userEvent.click(runtime.querySelector<HTMLButtonElement>('.flower-composer-more-button')!);
    const panel = document.querySelector<HTMLElement>('[data-flower-composer-more-panel]')!;
    const permission = panel.querySelector<HTMLButtonElement>('.flower-permission-trigger')!;
    await userEvent.click(permission);
    const menu = panel.querySelector<HTMLElement>('.flower-permission-menu')!;
    expect(menu.getBoundingClientRect().top).toBeGreaterThanOrEqual(0);
    expect(menu.getBoundingClientRect().right).toBeLessThanOrEqual(393);
    await userEvent.click(menu.querySelector<HTMLButtonElement>('[data-permission-type="full_access"]')!);
    expect(setThreadPermissionType).toHaveBeenCalledExactlyOnceWith(selected.thread_id, 'full_access');
    expect(permission.disabled).toBe(true);
    expect(editor.disabled).toBe(false);
    if (outcome === 'saved') response.resolve(liveBootstrap({ ...selected, permission_type: 'full_access', settings_revision: 11 }));
    else response.reject(new Error('Permission save failed'));
    await vi.waitFor(() => expect(permission.disabled).toBe(false));
    expect(permission.getAttribute('data-permission-type')).toBe(outcome === 'saved' ? 'full_access' : 'approval_required');
    expect(editor.value).toBe('Keep the thread draft');
    await userEvent.click(runtime.querySelector<HTMLElement>('.flower-chat-header-identity')!);
    expect(document.querySelector('[data-flower-composer-more-panel]')).toBeNull();
    expect(runtime.querySelector('.flower-composer-controls-inline .flower-permission-selector')).toBeNull();
  });

  it('keeps the clipped page stationary throughout repeated drawer entry and exit', async () => {
    const runtime = await mountMobile(393);
    Object.assign(runtime.style, { position: 'absolute', top: '48px', height: '600px', overflow: 'hidden' });
    const header = runtime.querySelector<HTMLElement>('.flower-chat-header')!;
    const editor = runtime.querySelector<HTMLTextAreaElement>('.flower-composer textarea')!;
    await userEvent.fill(editor, 'Retained draft 中文');
    editor.setSelectionRange(2, 7);
    for (let cycle = 0; cycle < 2; cycle += 1) {
      const frames: { top: number; scroll: number; opacity: number | null }[] = [];
      let frameId = 0;
      const sample = () => {
        const panel = runtime.querySelector<HTMLElement>('.flower-mobile-thread-drawer');
        frames.push({ top: header.getBoundingClientRect().top, scroll: runtime.scrollTop, opacity: panel ? Number(getComputedStyle(panel).opacity) : null });
        frameId = requestAnimationFrame(sample);
      };
      sample();
      try {
        await userEvent.click(page.getByRole('button', { name: DEFAULT_FLOWER_SURFACE_COPY.chat.conversationsAria, exact: true }));
        await vi.waitFor(() => expect(runtime.querySelector('.flower-mobile-thread-drawer')).not.toBeNull());
        await new Promise(resolve => setTimeout(resolve, 350));
        await userEvent.keyboard('{Escape}');
        await vi.waitFor(() => expect(runtime.querySelector('.flower-mobile-thread-drawer')).toBeNull());
      } finally {
        cancelAnimationFrame(frameId);
      }
      expect(frames.some(frame => frame.opacity !== null && frame.opacity < 1)).toBe(true);
      expect(frames.every(frame => Math.abs(frame.top - frames[0].top) < 1 && frame.scroll === 0)).toBe(true);
      expect(runtime.querySelector('.flower-composer textarea')).toBe(editor);
      expect(editor.value).toBe('Retained draft 中文');
      expect([editor.selectionStart, editor.selectionEnd]).toEqual([2, 7]);
    }
  });

  it.each([390, 640, 767])('opens a large conversation drawer at %i pixels and retains the detail and draft', async (width) => {
    const runtime = await mountMobile(width);
    const detail = runtime.querySelector<HTMLElement>('.flower-component-main')!;
    const editor = runtime.querySelector<HTMLTextAreaElement>('.flower-composer textarea')!;
    const detailBefore = detail.getBoundingClientRect();
    const navigation = runtime.querySelector<HTMLButtonElement>('.flower-chat-header .flower-mobile-navigation-button')!;
    expect(navigation.getAttribute('aria-haspopup')).toBe('dialog');
    expect(navigation.getAttribute('aria-expanded')).toBe('false');
    expect(navigation.getBoundingClientRect().width).toBeGreaterThanOrEqual(44);
    expect(navigation.querySelector('[aria-hidden="true"] svg')).not.toBeNull();
    expect(Number.parseFloat(getComputedStyle(editor).fontSize)).toBeGreaterThanOrEqual(16);
    expect(runtime.querySelector('.flower-component-thread-rail')).toBeNull();
    expect(detail.getBoundingClientRect().height).toBeGreaterThanOrEqual(700);
    await userEvent.fill(editor, 'Retained mobile draft 中文');
    editor.setSelectionRange(2, 7);
    await userEvent.click(page.getByRole('button', { name: DEFAULT_FLOWER_SURFACE_COPY.chat.conversationsAria, exact: true }));
    await vi.waitFor(() => expect(runtime.querySelector('.flower-mobile-thread-drawer')).not.toBeNull());
    const rail = runtime.querySelector<HTMLElement>('.flower-component-thread-rail')!;
    await vi.waitFor(() => expect(rail.closest('[data-floe-dialog-panel]')?.getAttribute('data-floating-presence')).toBe('open'));
    await new Promise(resolve => setTimeout(resolve, 260));
    const overlay = rail.closest<HTMLElement>('[data-floe-dialog-overlay-root]')!;
    const panel = rail.closest<HTMLElement>('[data-floe-dialog-panel]')!;
    const overlayBounds = overlay.getBoundingClientRect();
    const panelBounds = panel.getBoundingClientRect();
    const newChat = rail.querySelector<HTMLButtonElement>('.flower-new-chat-button')!;
    const newChatBounds = newChat.getBoundingClientRect();
    const iconBounds = newChat.firstElementChild!.getBoundingClientRect();
    expect(newChatBounds.width).toBeGreaterThanOrEqual(44);
    expect(Math.abs(iconBounds.left + iconBounds.width / 2 - newChatBounds.left - newChatBounds.width / 2)).toBeLessThan(1);
    const overlayStyle = getComputedStyle(overlay);
    const paddingTop = Number.parseFloat(overlayStyle.paddingTop);
    const paddingBottom = Number.parseFloat(overlayStyle.paddingBottom);
    expect(detail.getBoundingClientRect().height).toBeGreaterThanOrEqual(700);
    expect(detail.getBoundingClientRect().top).toBe(detailBefore.top);
    expect(panelBounds.top).toBeGreaterThanOrEqual(overlayBounds.top + paddingTop - 1);
    expect(panelBounds.bottom).toBeLessThanOrEqual(overlayBounds.bottom - paddingBottom + 1);
    expect(panelBounds.bottom).toBeGreaterThan(panelBounds.top);
    expect(detail.inert).toBe(true);
    expect(rail.getBoundingClientRect().height).toBeGreaterThan(480);
    expect(rail.getBoundingClientRect().top).toBeGreaterThanOrEqual(24);
    expect(rail.closest('[role="dialog"]')).not.toBeNull();
    expect(document.activeElement?.tagName).not.toBe('INPUT');
    expect(Number.parseFloat(getComputedStyle(rail.querySelector('input')!).fontSize)).toBeGreaterThanOrEqual(16);
    expect(rail.querySelector('input')!.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    expect([...rail.querySelectorAll('h2')].filter(heading => heading.getBoundingClientRect().height > 0)).toHaveLength(1);
    await userEvent.click(page.getByRole('button', { name: DEFAULT_FLOWER_SURFACE_COPY.settings.backToChat, exact: true }));
    expect(runtime.querySelector('.flower-composer textarea')).toBe(editor);
    expect(editor.value).toBe('Retained mobile draft 中文');
    expect(editor.selectionStart).toBe(2);
    await vi.waitFor(() => expect(rail.isConnected).toBe(false));
    await page.viewport(1024, 720);
    await vi.waitFor(() => expect(rail.getBoundingClientRect().width).toBeGreaterThan(200));
    expect(detail.getBoundingClientRect().height).toBeGreaterThanOrEqual(700);
    expect(runtime.querySelector('.flower-composer textarea')).toBe(editor);
    expect(runtime.querySelector<HTMLElement>('.flower-mobile-navigation-button')!.getBoundingClientRect().width).toBe(0);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(1024);
  });

  it.each([320, 390, 430])('keeps the conversation drawer inside a short visible surface at %i pixels', async (width) => {
    const runtime = await mountMobile(width, 480);
    const detail = runtime.querySelector<HTMLElement>('.flower-component-main')!;
    const detailBefore = detail.getBoundingClientRect();
    await userEvent.click(page.getByRole('button', { name: DEFAULT_FLOWER_SURFACE_COPY.chat.conversationsAria, exact: true }));
    await vi.waitFor(() => expect(runtime.querySelector('.flower-mobile-thread-drawer')).not.toBeNull());
    const panel = runtime.querySelector<HTMLElement>('[data-floe-dialog-panel]')!;
    await vi.waitFor(() => expect(panel.getAttribute('data-floating-presence')).toBe('open'));
    await new Promise(resolve => setTimeout(resolve, 260));
    const overlay = panel.closest<HTMLElement>('[data-floe-dialog-overlay-root]')!;
    const overlayBounds = overlay.getBoundingClientRect();
    const panelBounds = panel.getBoundingClientRect();
    const overlayStyle = getComputedStyle(overlay);
    expect(panelBounds.top).toBeGreaterThanOrEqual(overlayBounds.top + Number.parseFloat(overlayStyle.paddingTop) - 1);
    expect(panelBounds.bottom).toBeLessThanOrEqual(overlayBounds.bottom - Number.parseFloat(overlayStyle.paddingBottom) + 1);
    expect(detail.getBoundingClientRect().top).toBe(detailBefore.top);
    expect(detail.getBoundingClientRect().height).toBe(detailBefore.height);
  });

  it('opens selected and new conversations in the detail pane', async () => {
    const runtime = await mountMobile(390);
    const editor = runtime.querySelector<HTMLTextAreaElement>('.flower-composer textarea')!;
    await userEvent.fill(editor, 'Existing conversation draft');
    await userEvent.click(page.getByRole('button', { name: DEFAULT_FLOWER_SURFACE_COPY.chat.conversationsAria, exact: true }));
    await userEvent.click(page.getByRole('button', { name: DEFAULT_FLOWER_SURFACE_COPY.chat.newChat, exact: true }));
    expect(runtime.querySelector('[data-flower-mobile-pane]')?.getAttribute('data-flower-mobile-pane')).toBe('detail');
    expect(editor.value).toBe('');
    await userEvent.click(page.getByRole('button', { name: DEFAULT_FLOWER_SURFACE_COPY.chat.conversationsAria, exact: true }));
    await userEvent.click(runtime.querySelector<HTMLButtonElement>('.flower-thread-card-select-button')!);
    await vi.waitFor(() => expect(editor.value).toBe('Existing conversation draft'));
    expect(runtime.querySelector('[data-flower-mobile-pane]')?.getAttribute('data-flower-mobile-pane')).toBe('detail');
    expect(runtime.querySelector('.flower-composer textarea')).toBe(editor);
  });

  it('reveals settings requested by the host while the conversation list is visible', async () => {
    await page.viewport(390, 720);
    const [settingsRequest, setSettingsRequest] = createSignal(0);
    const runtime = renderSurfaceWithAdapterProps(adapter(true), {
      get settingsFocusRequest() { return settingsRequest(); },
      focusThreadRequest: { request_id: 'settings-thread', thread_id: 'thread-1' },
    });
    Object.assign(runtime.style, { height: '100%', width: '100%' });
    await waitFor(() => Boolean(runtime.querySelector('.flower-composer textarea:not(:disabled)')));
    await userEvent.click(page.getByRole('button', { name: DEFAULT_FLOWER_SURFACE_COPY.chat.conversationsAria, exact: true }));
    setSettingsRequest(1);
    await vi.waitFor(() => expect(runtime.querySelector('.flower-settings-providers-section')).toBeTruthy());
    const detail = runtime.querySelector<HTMLElement>('.flower-component-main')!;
    await vi.waitFor(() => expect(detail.inert).toBe(false));
    expect(detail.getBoundingClientRect().height).toBeGreaterThanOrEqual(700);
  });

  it.each([320, 390])('keeps the primary composer action circular and reachable at %i pixels', async (width) => {
    const runtime = await mountMobile(width);
    const editor = runtime.querySelector<HTMLTextAreaElement>('.flower-composer textarea')!;
    const button = runtime.querySelector<HTMLButtonElement>('.flower-composer-submit')!;
    const assertCircle = () => {
      const bounds = button.getBoundingClientRect();
      expect(bounds.width).toBeGreaterThanOrEqual(44);
      expect(bounds.width).toBeCloseTo(bounds.height, 0);
      expect(bounds.right).toBeLessThanOrEqual(width);
      expect(Number.parseFloat(getComputedStyle(button).borderRadius)).toBeGreaterThanOrEqual(bounds.width / 2);
    };
    assertCircle();
    await userEvent.fill(editor, 'Message');
    await vi.waitFor(() => expect(button.disabled).toBe(false));
    assertCircle();
  });
});


it('uses task suggestion cards instead of conversation rows on mobile', async () => {
  const runtime = await mountMobile(393);
  await userEvent.click(page.getByRole('button', { name: DEFAULT_FLOWER_SURFACE_COPY.chat.conversationsAria, exact: true }));
  await userEvent.click(page.getByRole('button', { name: DEFAULT_FLOWER_SURFACE_COPY.chat.newChat, exact: true }));
  await vi.waitFor(() => expect(runtime.querySelectorAll('.flower-empty-suggestion').length).toBe(4));
  const cards = [...runtime.querySelectorAll<HTMLButtonElement>('.flower-empty-suggestion')];
  const first = cards[0].getBoundingClientRect();
  const second = cards[1].getBoundingClientRect();
  expect(first.height).toBeGreaterThanOrEqual(100);
  expect(Math.abs(first.top - second.top)).toBeLessThan(1);
  expect(second.left).toBeGreaterThan(first.right);
  expect(cards[2].getBoundingClientRect().height).toBe(0);
  expect(runtime.querySelector('.flower-empty-suggestion-label')?.textContent).toContain(DEFAULT_FLOWER_SURFACE_COPY.emptyState.suggestionsLabel);
  await userEvent.click(cards[0]);
  expect(runtime.querySelector<HTMLTextAreaElement>('.flower-composer textarea')!.value).toBe(DEFAULT_FLOWER_SURFACE_COPY.emptyState.suggestions[0].prompt);
});

it('lets the host toggle a retained mobile drawer and keeps search state through resize', async () => {
  await page.viewport(393, 720);
  const [open, setOpen] = createSignal(false);
  const runtime = renderSurfaceWithAdapterProps(adapter(true), {
    get mobileThreadsOpen() { return open(); },
    onMobileThreadsOpenChange: setOpen,
  });
  Object.assign(runtime.style, { height: '100%', width: '100%' });
  await waitFor(() => Boolean(runtime.querySelector('.flower-composer textarea:not(:disabled)')));
  const editor = runtime.querySelector('.flower-composer textarea');
  setOpen(true);
  await vi.waitFor(() => expect(runtime.querySelector('.flower-mobile-thread-drawer')).not.toBeNull());
  const search = runtime.querySelector<HTMLInputElement>('.flower-component-thread-rail input')!;
  await userEvent.fill(search, 'Retained search');
  setOpen(false);
  await vi.waitFor(() => expect(search.isConnected).toBe(false));
  setOpen(true);
  await vi.waitFor(() => expect(search.isConnected).toBe(true));
  expect(search.value).toBe('Retained search');
  await page.viewport(1024, 720);
  await vi.waitFor(() => expect(runtime.querySelector('.flower-mobile-thread-drawer')).toBeNull());
  expect(runtime.querySelector('.flower-component-thread-rail input')).toBe(search);
  expect(runtime.querySelector('.flower-composer textarea')).toBe(editor);
  await page.viewport(393, 720);
  await vi.waitFor(() => expect(runtime.querySelector('.flower-mobile-thread-drawer')).not.toBeNull());
  await userEvent.keyboard('{Escape}');
  await vi.waitFor(() => expect(open()).toBe(false));
});

import '../index.css';
import './flower-feature.css';

import { describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { createSignal } from 'solid-js';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../../../../flower_ui/src/copy';
import { adapter, liveBootstrap, renderSurfaceWithAdapterProps, thread, waitFor } from './FlowerSurface.navigation.testHarness';

async function mountMobile(width: number) {
  await page.viewport(width, 720);
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
  it.each([390, 640, 767])('shows one full-height pane at %i pixels and retains the draft between panes', async (width) => {
    const runtime = await mountMobile(width);
    const rail = runtime.querySelector<HTMLElement>('.flower-component-thread-rail')!;
    const detail = runtime.querySelector<HTMLElement>('.flower-component-main')!;
    const editor = runtime.querySelector<HTMLTextAreaElement>('.flower-composer textarea')!;
    expect(Number.parseFloat(getComputedStyle(editor).fontSize)).toBeGreaterThanOrEqual(16);
    expect(rail.getBoundingClientRect().height).toBe(0);
    expect(detail.getBoundingClientRect().height).toBeGreaterThanOrEqual(700);
    await userEvent.fill(editor, 'Retained mobile draft 中文');
    editor.setSelectionRange(2, 7);
    await userEvent.click(page.getByRole('button', { name: DEFAULT_FLOWER_SURFACE_COPY.chat.conversationsAria, exact: true }));
    expect(detail.getBoundingClientRect().height).toBe(0);
    expect(detail.inert).toBe(true);
    expect(rail.getBoundingClientRect().height).toBeGreaterThanOrEqual(700);
    expect(Number.parseFloat(getComputedStyle(rail.querySelector('input')!).fontSize)).toBeGreaterThanOrEqual(16);
    await userEvent.click(page.getByRole('button', { name: DEFAULT_FLOWER_SURFACE_COPY.settings.backToChat, exact: true }));
    expect(runtime.querySelector('.flower-composer textarea')).toBe(editor);
    expect(editor.value).toBe('Retained mobile draft 中文');
    expect(editor.selectionStart).toBe(2);
    expect(rail.getBoundingClientRect().height).toBe(0);
    await page.viewport(1024, 720);
    await vi.waitFor(() => expect(rail.getBoundingClientRect().width).toBeGreaterThan(200));
    expect(detail.getBoundingClientRect().height).toBeGreaterThanOrEqual(700);
    expect(runtime.querySelector('.flower-composer textarea')).toBe(editor);
    expect(runtime.querySelector<HTMLElement>('.flower-mobile-navigation-button')!.getBoundingClientRect().width).toBe(0);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(1024);
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
    expect(detail.inert).toBe(false);
    expect(detail.getBoundingClientRect().height).toBeGreaterThanOrEqual(700);
  });

  it.each([320, 390])('keeps the primary composer action circular and reachable at %i pixels', async (width) => {
    const runtime = await mountMobile(width);
    const editor = runtime.querySelector<HTMLTextAreaElement>('.flower-composer textarea')!;
    const button = runtime.querySelector<HTMLButtonElement>('.flower-composer-submit')!;
    const assertCircle = () => {
      const bounds = button.getBoundingClientRect();
      expect(bounds.width).toBeGreaterThanOrEqual(36);
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

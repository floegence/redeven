// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adapter, launchReceipt, renderSurfaceWithAdapterProps, waitFor } from './FlowerSurface.navigation.testHarness';

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

const monitorContext = { label: 'Monitor', title: 'Monitor page', content: '{"page_id":"monitor","sort":"cpu"}' };
const edit = (textarea: HTMLTextAreaElement, value: string) => {
  textarea.value = value;
  textarea.setSelectionRange(value.length, value.length);
  textarea.dispatchEvent(new InputEvent('input', { bubbles: true }));
};

describe('Flower new conversation page context', () => {
  it('captures once on the first edit and sends the exact visible snapshot', async () => {
    const capture = vi.fn(() => monitorContext);
    const launchTurn = vi.fn(async input => launchReceipt('thread-page', 'turn-page', 'start', input.client_request_id));
    const runtime = renderSurfaceWithAdapterProps({ ...adapter(true), listThreads: vi.fn(async () => []), launchTurn }, {
      presentation: 'companion', companionOpen: true, captureNewConversationContext: capture,
    });
    await waitFor(() => Boolean(runtime.querySelector('textarea')));
    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.focus();
    expect(capture).not.toHaveBeenCalled();
    edit(textarea, 'Explain this');
    await waitFor(() => capture.mock.calls.length === 1);
    expect(runtime.querySelector('[data-reference-kind="page_context"]')?.textContent).toContain('Monitor');
    capture.mockReturnValue({ label: 'Files', title: 'Files page', content: '{"page_id":"files"}' });
    edit(textarea, 'Explain this page');
    expect(capture).toHaveBeenCalledTimes(1);
    await waitFor(() => !(runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).disabled);
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();
    await waitFor(() => launchTurn.mock.calls.length === 1);
    expect(launchTurn.mock.calls[0]![0].context_action?.context).toEqual([
      { kind: 'text_snapshot', title: monitorContext.title, content: monitorContext.content },
    ]);
    expect(runtime.querySelector('textarea')).toBe(textarea);
    await waitFor(() => runtime.querySelector('[data-flower-selected-thread-id="thread-page"]') !== null && textarea.value === '');
    edit(textarea, 'Continue');
    await waitFor(() => !(runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).disabled);
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();
    await waitFor(() => launchTurn.mock.calls.length === 2);
    expect(launchTurn.mock.calls[1]![0].context_action).toBeUndefined();
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it('captures the initial blank draft when a file attachment is its first edit', async () => {
    const capture = vi.fn(() => monitorContext);
    const runtime = renderSurfaceWithAdapterProps({ ...adapter(true), listThreads: vi.fn(async () => []) }, {
      presentation: 'companion', companionOpen: true, captureNewConversationContext: capture,
    });
    await waitFor(() => Boolean(runtime.querySelector('input[type="file"]')));
    const picker = runtime.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(picker, 'files', { configurable: true, value: [new File(['notes'], 'notes.txt', { type: 'text/plain' })] });
    picker.dispatchEvent(new Event('change', { bubbles: true }));
    expect(capture).toHaveBeenCalledTimes(1);
    expect(runtime.querySelector('[data-reference-kind="page_context"]')?.textContent).toContain('Monitor');
    expect((runtime.querySelector('textarea') as HTMLTextAreaElement).value).toBe('');
  });

  it('keeps removal final and does not enable sending page context alone', async () => {
    const capture = vi.fn(() => monitorContext);
    const runtime = renderSurfaceWithAdapterProps({ ...adapter(true), listThreads: vi.fn(async () => []) }, {
      presentation: 'companion', companionOpen: true, captureNewConversationContext: capture,
    });
    await waitFor(() => Boolean(runtime.querySelector('textarea')));
    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    edit(textarea, 'x');
    await waitFor(() => capture.mock.calls.length === 1);
    edit(textarea, '');
    expect((runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).disabled).toBe(true);
    await waitFor(() => !(runtime.querySelector('[data-reference-kind="page_context"] .flower-composer-reference-chip-remove') as HTMLButtonElement).disabled);
    (runtime.querySelector('[data-reference-kind="page_context"] .flower-composer-reference-chip-remove') as HTMLButtonElement).click();
    await waitFor(() => !runtime.querySelector('[data-reference-kind="page_context"]'));
    edit(textarea, 'next');
    expect(capture).toHaveBeenCalledTimes(1);
    expect(runtime.querySelector('[data-reference-kind="page_context"]')).toBeNull();
  });
  it('captures immediately on explicit new conversation and refreshes only on another new action', async () => {
    const capture = vi.fn(() => monitorContext);
    const runtime = renderSurfaceWithAdapterProps({ ...adapter(true), listThreads: vi.fn(async () => []) }, {
      presentation: 'companion', companionOpen: true, captureNewConversationContext: capture,
    });
    await waitFor(() => Boolean(runtime.querySelector('.flower-header-icon-button[aria-label="New chat"]')));
    const create = runtime.querySelector('.flower-header-icon-button[aria-label="New chat"]') as HTMLButtonElement;
    create.click();
    expect(capture).toHaveBeenCalledTimes(1);
    expect(runtime.querySelector('[data-reference-kind="page_context"]')?.textContent).toContain('Monitor');
    capture.mockReturnValue({ label: 'Files', title: 'Files', content: '{"page_id":"files"}' });
    create.click();
    expect(capture).toHaveBeenCalledTimes(2);
    expect(runtime.querySelectorAll('[data-reference-kind="page_context"]')).toHaveLength(1);
    expect(runtime.querySelector('[data-reference-kind="page_context"]')?.textContent).toContain('Files');
  });

  it('never captures for an existing conversation', async () => {
    const capture = vi.fn(() => monitorContext);
    const runtime = renderSurfaceWithAdapterProps(adapter(true), { captureNewConversationContext: capture });
    await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="thread-1"]')));
    (runtime.querySelector('[data-thread-id="thread-1"] button') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelector('[data-flower-selected-thread-id="thread-1"]') !== null);
    edit(runtime.querySelector('textarea') as HTMLTextAreaElement, 'Continue this');
    expect(capture).not.toHaveBeenCalled();
    expect(runtime.querySelector('[data-reference-kind="page_context"]')).toBeNull();
  });

  it('freezes page and file references in one request and retains them for the same-id retry', async () => {
    const capture = vi.fn(() => monitorContext);
    const launchTurn = vi.fn().mockRejectedValue(new Error('network unavailable'));
    const runtime = renderSurfaceWithAdapterProps({
      ...adapter(true), listThreads: vi.fn(async () => []), launchTurn,
      getWorkingDirectoryPathContext: vi.fn(async () => ({ agentHomePathAbs: '/workspace', homePathAbs: '/workspace',
        defaultRootId: 'root', roots: [{ id: 'root', label: 'Workspace', pathAbs: '/workspace', kind: 'workspace', permissions: { read: true, write: true } }] })),
      listWorkingDirectoryEntries: vi.fn(async () => [{ name: 'main.ts', path: '/workspace/main.ts', isDirectory: false }]),
    }, { presentation: 'companion', companionOpen: true, captureNewConversationContext: capture });
    await waitFor(() => runtime.querySelector('.flower-working-directory-control')?.textContent?.includes('workspace') === true);
    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.focus();
    edit(textarea, 'Explain @main');
    textarea.dispatchEvent(new Event('select', { bubbles: true }));
    await waitFor(() => Boolean(runtime.querySelector('[role="listbox"] [role="option"]')));
    (runtime.querySelector('[role="listbox"] [role="option"]') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelectorAll('.flower-composer-reference-chip').length === 2);
    await waitFor(() => !(runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).disabled);
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();
    await waitFor(() => launchTurn.mock.calls.length === 1);
    const original = launchTurn.mock.calls[0]![0];
    expect(original.context_action.context).toEqual([
      { kind: 'text_snapshot', title: monitorContext.title, content: monitorContext.content },
      { kind: 'file_path', path: '/workspace/main.ts', is_directory: false },
    ]);
    capture.mockReturnValue({ label: 'Files', title: 'Files', content: 'changed page' });
    await waitFor(() => Boolean(runtime.querySelector('[aria-label="Retry send"]')));
    const retry = runtime.querySelector('[aria-label="Retry send"]') as HTMLButtonElement;
    retry.click();
    await waitFor(() => launchTurn.mock.calls.length === 2);
    expect(launchTurn.mock.calls[1]![0]).toEqual(original);
    expect(capture).toHaveBeenCalledTimes(1);
  });

  it('preserves one native editor and selection through IME capture and page preview', async () => {
    const capture = vi.fn(() => monitorContext);
    const runtime = renderSurfaceWithAdapterProps({ ...adapter(true), listThreads: vi.fn(async () => []) }, {
      presentation: 'companion', companionOpen: true, captureNewConversationContext: capture,
    });
    await waitFor(() => Boolean(runtime.querySelector('textarea')));
    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.focus();
    textarea.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    edit(textarea, '测试');
    textarea.setSelectionRange(1, 2);
    textarea.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: '测试' }));
    expect(capture).toHaveBeenCalledTimes(1);
    expect(runtime.querySelector('textarea')).toBe(textarea);
    expect(textarea.value).toBe('测试');
    expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([1, 2]);
    (runtime.querySelector('.flower-composer-reference-chip-preview') as HTMLButtonElement).click();
    await waitFor(() => Boolean(document.querySelector('[role="dialog"] pre')));
    expect(document.querySelector('[role="dialog"] pre')?.textContent).toBe(monitorContext.content);
  });

});

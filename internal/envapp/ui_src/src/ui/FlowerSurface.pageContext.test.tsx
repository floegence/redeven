// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSignal } from 'solid-js';
import { adapter, launchReceipt, renderSurfaceWithAdapterProps, waitFor } from './FlowerSurface.navigation.testHarness';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../../../../flower_ui/src/copy';

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
  it('uses the shared reference icon and host preview, retiring stale previews on refresh and removal', async () => {
    const capture = vi.fn(() => monitorContext);
    const [open, setOpen] = createSignal(false);
    const runtime = renderSurfaceWithAdapterProps({ ...adapter(true), listThreads: vi.fn(async () => []) }, {
      presentation: 'companion', get companionOpen() { return open(); }, get engaged() { return open(); },
      captureNewConversationContext: capture, onCompanionOpenRequest: () => setOpen(true),
      renderContextSnapshotPreview: props => <section data-testid="host-context-preview"><h2>{props.title}</h2><pre>{props.body}</pre><button onClick={props.onClose}>Close</button></section>,
    });
    await waitFor(() => Boolean(runtime.querySelector('textarea')));
    const editor = runtime.querySelector('textarea') as HTMLTextAreaElement;
    editor.click();
    const showPreview = () => (runtime.querySelector('.flower-composer-reference-chip-preview') as HTMLButtonElement).click();
    expect(runtime.querySelector('[data-flower-context-icon="page_context"]')).not.toBeNull();
    showPreview();
    await waitFor(() => Boolean(runtime.querySelector('[data-testid="host-context-preview"]')));
    expect(runtime.querySelector('[data-testid="host-context-preview"] pre')?.textContent).toBe(monitorContext.content);
    expect(document.querySelector('.flower-page-context-preview')).toBeNull();
    setOpen(false);
    capture.mockReturnValue({ label: 'Files', title: 'Files page', content: 'frozen files' });
    editor.click();
    expect(runtime.querySelector('[data-testid="host-context-preview"]')).toBeNull();
    showPreview();
    expect(runtime.querySelector('[data-testid="host-context-preview"] pre')?.textContent).toBe('frozen files');
    (runtime.querySelector('.flower-composer-reference-chip-remove') as HTMLButtonElement).click();
    expect(runtime.querySelector('[data-testid="host-context-preview"]')).toBeNull();
    expect(runtime.querySelector('textarea')).toBe(editor);
  });

  it('refreshes on each blank companion opening while preserving text, selection and attachments', async () => {
    const capture = vi.fn(() => monitorContext);
    const [open, setOpen] = createSignal(false);
    const runtime = renderSurfaceWithAdapterProps({ ...adapter(true), listThreads: vi.fn(async () => []) }, {
      presentation: 'companion', get companionOpen() { return open(); }, get engaged() { return open(); },
      captureNewConversationContext: capture, onCompanionOpenRequest: () => setOpen(true),
    });
    await waitFor(() => Boolean(runtime.querySelector('textarea')));
    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.focus();
    textarea.click();
    expect(capture).toHaveBeenCalledTimes(1);
    expect(runtime.querySelectorAll('[data-reference-kind="page_context"]')).toHaveLength(1);
    expect((runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).disabled).toBe(true);
    edit(textarea, 'Keep the pending draft');
    const picker = runtime.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(picker, 'files', { configurable: true, value: [new File(['notes'], 'retained-notes.txt', { type: 'text/plain' })] });
    picker.dispatchEvent(new Event('change', { bubbles: true }));
    textarea.setSelectionRange(2, 6);
    textarea.blur();
    setOpen(false);
    capture.mockReturnValue({ label: 'Files', title: 'Files page', content: '{"page_id":"files","directory":"/Downloads"}' });
    textarea.click();
    expect(capture).toHaveBeenCalledTimes(2);
    expect(runtime.querySelectorAll('[data-reference-kind="page_context"]')).toHaveLength(1);
    expect(runtime.querySelector('[data-reference-kind="page_context"]')?.textContent).toContain('Files');
    expect(runtime.querySelector('textarea')).toBe(textarea);
    expect(textarea.value).toBe('Keep the pending draft');
    expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([2, 6]);
    expect(runtime.textContent).toContain('retained-notes.txt');
    textarea.click();
    edit(textarea, 'Continue the pending draft');
    expect(capture).toHaveBeenCalledTimes(2);
    (runtime.querySelector('[data-reference-kind="page_context"] .flower-composer-reference-chip-remove') as HTMLButtonElement).click();
    edit(textarea, 'Continue after removal');
    expect(runtime.querySelector('[data-reference-kind="page_context"]')).toBeNull();
    setOpen(false);
    capture.mockReturnValue({ ...monitorContext, content: '{"page_id":"monitor","sort":"memory"}' });
    textarea.click();
    expect(capture).toHaveBeenCalledTimes(3);
    expect(runtime.querySelector('[data-reference-kind="page_context"]')?.textContent).toContain('Monitor');
  });

  it.each(['click', 'focus', 'input', 'composition'] as const)('refreshes on explicit %s while closing retains expanded content', async action => {
    const capture = vi.fn(() => monitorContext);
    const [open, setOpen] = createSignal(false);
    const [retained, setRetained] = createSignal(false);
    const runtime = renderSurfaceWithAdapterProps({ ...adapter(true), listThreads: vi.fn(async () => []) }, {
      presentation: 'companion', get companionOpen() { return open() || retained(); }, get engaged() { return open(); },
      captureNewConversationContext: capture, onCompanionOpenRequest: () => setOpen(true),
    });
    await waitFor(() => Boolean(runtime.querySelector('textarea')));
    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.click();
    expect(capture).toHaveBeenCalledTimes(1);
    setRetained(true);
    setOpen(false);
    capture.mockReturnValue({ ...monitorContext, content: '{"page_id":"monitor","sort":"memory"}' });
    if (action === 'click') textarea.click();
    else if (action === 'focus') textarea.focus();
    else if (action === 'input') edit(textarea, 'Continue while closing');
    else textarea.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    expect(open()).toBe(true);
    expect(capture).toHaveBeenCalledTimes(2);
    expect(runtime.querySelectorAll('[data-reference-kind="page_context"]')).toHaveLength(1);
    (runtime.querySelector('.flower-composer-reference-chip-preview') as HTMLButtonElement).click();
    await waitFor(() => Boolean(document.querySelector('[role="dialog"] pre')));
    expect(document.querySelector('[role="dialog"] pre')?.textContent).toBe(capture.mock.results[1]!.value.content);
    if (action === 'composition') textarea.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
    expect(runtime.querySelector('textarea')).toBe(textarea);
  });

  it('does not capture when an existing conversation reopens', async () => {
    const capture = vi.fn(() => monitorContext);
    const [open, setOpen] = createSignal(false);
    const runtime = renderSurfaceWithAdapterProps(adapter(true), {
      presentation: 'companion', get companionOpen() { return open(); }, get engaged() { return open(); },
      focusThreadRequest: { request_id: 'existing-page-context', thread_id: 'thread-1' },
      captureNewConversationContext: capture, onCompanionOpenRequest: () => setOpen(true),
    });
    await waitFor(() => runtime.querySelector('[data-flower-selected-thread-id="thread-1"]') !== null);
    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.click();
    setOpen(false);
    textarea.click();
    expect(capture).not.toHaveBeenCalled();
    expect(runtime.querySelector('[data-reference-kind="page_context"]')).toBeNull();
  });

  it('refreshes through the compact Flower icon and every switcher New action', async () => {
    const capture = vi.fn(() => monitorContext);
    const [open, setOpen] = createSignal(false);
    const runtime = renderSurfaceWithAdapterProps({ ...adapter(true), listThreads: vi.fn(async () => []) }, {
      presentation: 'companion', get companionOpen() { return open(); }, get engaged() { return open(); },
      captureNewConversationContext: capture, onCompanionOpenRequest: () => setOpen(true),
      companionCopy: { label: 'Switch conversation', searchPlaceholder: 'Search', newConversation: 'New conversation',
        empty: 'No conversations', queued: 'Queued', threadList: DEFAULT_FLOWER_SURFACE_COPY.threadList },
    });
    await waitFor(() => Boolean(runtime.querySelector('.flower-companion-thread-trigger')));
    (runtime.querySelector('.flower-companion-thread-trigger') as HTMLButtonElement).click();
    expect(capture).toHaveBeenCalledTimes(1);
    capture.mockReturnValue({ ...monitorContext, content: '{"page_id":"monitor","sort":"memory"}' });
    (runtime.querySelector('[data-flower-thread-switcher-new]') as HTMLButtonElement).click();
    expect(capture).toHaveBeenCalledTimes(2);
    capture.mockReturnValue({ ...monitorContext, content: '{"page_id":"monitor","sort":"pid"}' });
    (runtime.querySelector('.flower-companion-thread-trigger') as HTMLButtonElement).click();
    expect(capture).toHaveBeenCalledTimes(2);
    (runtime.querySelector('[data-flower-thread-switcher-new]') as HTMLButtonElement).click();
    expect(capture).toHaveBeenCalledTimes(3);
    expect(runtime.querySelectorAll('[data-reference-kind="page_context"]')).toHaveLength(1);
    (runtime.querySelector('.flower-composer-reference-chip-preview') as HTMLButtonElement).click();
    await waitFor(() => Boolean(document.querySelector('[role="dialog"] pre')));
    expect(document.querySelector('[role="dialog"] pre')?.textContent).toBe(capture.mock.results[2]!.value.content);
  });

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

  it.each(['pending', 'retry'] as const)('consumes a refreshed origin on %s acceptance while retaining newer user intent', async delivery => {
    const capture = vi.fn(() => monitorContext);
    const [open, setOpen] = createSignal(true);
    let finish: (() => void) | undefined;
    let attempts = 0;
    const launchTurn = vi.fn(async (input: { client_request_id: string }) => {
      if (++attempts === 1 && delivery === 'retry') throw new Error('response lost');
      return await new Promise<ReturnType<typeof launchReceipt>>(resolve => {
        finish = () => resolve(launchReceipt('thread-origin-adopted', 'turn-origin-adopted', 'start', input.client_request_id));
      });
    });
    const runtime = renderSurfaceWithAdapterProps({
      ...adapter(true), listThreads: vi.fn(async () => []), launchTurn,
      getWorkingDirectoryPathContext: vi.fn(async () => ({ agentHomePathAbs: '/workspace', homePathAbs: '/workspace',
        defaultRootId: 'root', roots: [{ id: 'root', label: 'Workspace', pathAbs: '/workspace', kind: 'workspace', permissions: { read: true, write: true } }] })),
      listWorkingDirectoryEntries: vi.fn(async () => [{ name: 'main.ts', path: '/workspace/main.ts', isDirectory: false }]),
    }, { presentation: 'companion', get companionOpen() { return open(); }, get engaged() { return open(); },
      captureNewConversationContext: capture, onCompanionOpenRequest: () => setOpen(true) });
    await waitFor(() => Boolean(runtime.querySelector('textarea')));
    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    edit(textarea, 'First request');
    await waitFor(() => !(runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).disabled);
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();
    await waitFor(() => launchTurn.mock.calls.length === 1);
    expect(textarea.value).toBe('First request');
    const original = launchTurn.mock.calls[0]![0];
    if (delivery === 'retry') await waitFor(() => Boolean(runtime.querySelector('[aria-label="Retry send"]')));
    setOpen(false);
    capture.mockReturnValue({ label: 'Files', title: 'Files page', content: '{"page_id":"files"}' });
    textarea.click();
    expect(runtime.querySelector('[data-reference-kind="page_context"]')?.textContent).toContain('Files');
    textarea.focus();
    edit(textarea, '@main');
    textarea.setSelectionRange(5, 5);
    await waitFor(() => Boolean(runtime.querySelector('[role="listbox"] [role="option"]')));
    (runtime.querySelector('[role="listbox"] [role="option"]') as HTMLButtonElement).click();
    edit(textarea, 'Newer user intent');
    const picker = runtime.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(picker, 'files', { configurable: true, value: [new File(['notes'], 'later-notes.txt', { type: 'text/plain' })] });
    picker.dispatchEvent(new Event('change', { bubbles: true }));
    if (delivery === 'retry') {
      (runtime.querySelector('[aria-label="Retry send"]') as HTMLButtonElement).click();
      await waitFor(() => launchTurn.mock.calls.length === 2 && Boolean(finish));
      expect(launchTurn.mock.calls[1]![0]).toEqual(original);
    }
    finish!();
    await waitFor(() => runtime.querySelector('[data-flower-selected-thread-id="thread-origin-adopted"]') !== null);
    expect(runtime.querySelector('[data-reference-kind="page_context"]')).toBeNull();
    expect(runtime.querySelector('[data-reference-kind="file"]')?.textContent).toContain('main.ts');
    expect(runtime.textContent).toContain('later-notes.txt');
    expect(textarea.value).toBe('Newer user intent');
    expect(runtime.querySelector('textarea')).toBe(textarea);
    expect(capture).toHaveBeenCalledTimes(2);
  });

  it('retains the explicitly newer conversation origin when an older request is accepted', async () => {
    const capture = vi.fn(() => monitorContext);
    let finish!: (receipt: ReturnType<typeof launchReceipt>) => void;
    const response = new Promise<ReturnType<typeof launchReceipt>>(resolve => { finish = resolve; });
    const launchTurn = vi.fn((_input: { client_request_id: string }) => response);
    const runtime = renderSurfaceWithAdapterProps({ ...adapter(true), listThreads: vi.fn(async () => []), launchTurn }, {
      presentation: 'companion', companionOpen: true, captureNewConversationContext: capture,
    });
    await waitFor(() => Boolean(runtime.querySelector('textarea')));
    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    edit(textarea, 'First conversation');
    await waitFor(() => !(runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).disabled);
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();
    await waitFor(() => launchTurn.mock.calls.length === 1);
    expect(textarea.value).toBe('First conversation');
    const requestID = launchTurn.mock.calls[0]![0].client_request_id;
    capture.mockReturnValue({ label: 'Files', title: 'Files page', content: '{"page_id":"files"}' });
    (runtime.querySelector('.flower-new-chat-button') as HTMLButtonElement).click();
    edit(textarea, 'Second conversation');
    finish(launchReceipt('thread-older-origin', 'turn-older-origin', 'start', requestID));
    await waitFor(() => !runtime.querySelector(`[data-flower-transport-outbox-id="${requestID}"]`));
    expect(runtime.querySelector('[data-flower-selected-thread-id="thread-older-origin"]')).toBeNull();
    expect(runtime.querySelector('[data-reference-kind="page_context"]')?.textContent).toContain('Files');
    expect(textarea.value).toBe('Second conversation');
    expect(runtime.querySelector('textarea')).toBe(textarea);
    expect(capture).toHaveBeenCalledTimes(2);
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
  it('refreshes immediately on every explicit new conversation action', async () => {
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
    const [open, setOpen] = createSignal(true);
    const launchTurn = vi.fn().mockRejectedValue(new Error('network unavailable'));
    const runtime = renderSurfaceWithAdapterProps({
      ...adapter(true), listThreads: vi.fn(async () => []), launchTurn,
      getWorkingDirectoryPathContext: vi.fn(async () => ({ agentHomePathAbs: '/workspace', homePathAbs: '/workspace',
        defaultRootId: 'root', roots: [{ id: 'root', label: 'Workspace', pathAbs: '/workspace', kind: 'workspace', permissions: { read: true, write: true } }] })),
      listWorkingDirectoryEntries: vi.fn(async () => [{ name: 'main.ts', path: '/workspace/main.ts', isDirectory: false }]),
    }, { presentation: 'companion', get companionOpen() { return open(); }, get engaged() { return open(); },
      captureNewConversationContext: capture, onCompanionOpenRequest: () => setOpen(true) });
    await waitFor(() => Boolean(runtime.querySelector('textarea')));
    const textarea = runtime.querySelector('textarea') as HTMLTextAreaElement;
    textarea.focus();
    edit(textarea, 'Explain @main');
    textarea.dispatchEvent(new Event('select', { bubbles: true }));
    await waitFor(() => Boolean(runtime.querySelector('[role="listbox"] [role="option"]')));
    (runtime.querySelector('[role="listbox"] [role="option"]') as HTMLButtonElement).click();
    await waitFor(() => runtime.querySelectorAll('.flower-composer-reference-chip').length === 2);
    const refreshedOrigin = { ...monitorContext, content: '{"page_id":"monitor","sort":"memory"}' };
    capture.mockReturnValue(refreshedOrigin);
    textarea.blur();
    setOpen(false);
    textarea.click();
    expect(capture).toHaveBeenCalledTimes(2);
    expect(runtime.querySelectorAll('.flower-composer-reference-chip')).toHaveLength(2);
    expect(runtime.querySelector('[data-reference-kind="file"]')?.textContent).toContain('main.ts');
    await waitFor(() => !(runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).disabled);
    (runtime.querySelector('.flower-composer-submit') as HTMLButtonElement).click();
    await waitFor(() => launchTurn.mock.calls.length === 1);
    const original = launchTurn.mock.calls[0]![0];
    expect(original.context_action.context).toEqual([
      { kind: 'text_snapshot', title: refreshedOrigin.title, content: refreshedOrigin.content },
      { kind: 'file_path', path: '/workspace/main.ts', is_directory: false },
    ]);
    capture.mockReturnValue({ label: 'Files', title: 'Files', content: 'changed page' });
    await waitFor(() => Boolean(runtime.querySelector('[aria-label="Retry send"]')));
    textarea.blur();
    setOpen(false);
    textarea.click();
    expect(capture).toHaveBeenCalledTimes(3);
    expect(runtime.querySelector('[data-reference-kind="page_context"]')?.textContent).toContain('Files');
    const retry = runtime.querySelector('[aria-label="Retry send"]') as HTMLButtonElement;
    retry.click();
    await waitFor(() => launchTurn.mock.calls.length === 2);
    expect(launchTurn.mock.calls[1]![0]).toEqual(original);
    expect(capture).toHaveBeenCalledTimes(3);
    expect(runtime.querySelector('[data-reference-kind="page_context"]')?.textContent).toContain('Files');
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

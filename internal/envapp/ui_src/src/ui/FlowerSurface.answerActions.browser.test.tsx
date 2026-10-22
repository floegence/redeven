import '../index.css';
import './flower-feature.css';
import { afterEach, beforeEach, expect, it, onTestFinished, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { adapter, deferred, liveBootstrap, renderSurfaceWithAdapterProps, thread, waitFor } from './FlowerSurface.navigation.testHarness';
import { flowerAnswerHTML } from '../../../../flower_ui/src/chat/markdown/flowerAnswerExport';
import { streamingFixture } from '../../../../flower_ui/testing/streamingFixture';

beforeEach(() => page.viewport(1100, 820));
afterEach(() => { document.documentElement.classList.remove('dark'); });
const answer = '# A considered answer\n\nA quiet toolbar keeps the reading flow clear.\n\n- Copy the answer\n- Export a standalone document\n- Continue from this point';
const timestamp = Date.parse('2026-10-15T18:42:00Z');
function snapshot() {
  const sources = [{ title: 'GitHub', url: 'https://github.com/floegence' }, { title: 'Reference', url: 'https://example.com/reference' }];
  return thread({ title: 'Answer actions', turns: [{
    turn_id: 'turn-answer', run_id: 'run-answer', started_at: new Date(timestamp - 1000).toISOString(), ended_at: new Date(timestamp).toISOString(),
    outcome: 'completed', elapsed_ms: 1000, waiting_ms: 0, work_duration_ms: 1000, final_item_ids: ['answer'], final_boundary_complete: true,
  }], messages: [{ id: 'answer', turn_id: 'turn-answer', run_id: 'run-answer', role: 'assistant', content: answer,
    status: 'complete', created_at_ms: timestamp, sources, blocks: [{ type: 'markdown', content: answer, sources }] }] });
}

it.each([{ theme: 'light', width: 1100 }, { theme: 'dark', width: 1100 }, { theme: 'light', width: 320 }, { theme: 'dark', width: 320 }])('places three icon actions above sources in $theme at $width px', async ({ theme, width }) => {
  await page.viewport(width, 820);
  document.documentElement.classList.toggle('dark', theme === 'dark');
  const source = snapshot();
  const runtime = renderSurfaceWithAdapterProps({ ...adapter(), listThreads: async () => [source], loadThread: async () => liveBootstrap(source), forkThread: vi.fn() }, {
    focusThreadRequest: { request_id: 'actions', thread_id: source.thread_id },
  });
  await waitFor(() => Boolean(runtime.querySelector('.flower-answer-actions')));
  const message = runtime.querySelector<HTMLElement>('[data-flower-message-id="answer"]')!;
  message.id = 'answer-actions-evidence';
  const toolbar = message.querySelector<HTMLElement>('.flower-answer-actions')!;
  const buttons = toolbar.querySelectorAll<HTMLButtonElement>('button');
  expect(buttons).toHaveLength(3);
  expect([...buttons].map(button => button.textContent)).toEqual(['', '', '']);
  expect([...buttons].map(button => [button.getBoundingClientRect().width, button.getBoundingClientRect().height])).toEqual([[28, 28], [28, 28], [28, 28]]);
  for (const icon of toolbar.querySelectorAll<SVGElement>('svg')) {
    expect(getComputedStyle(icon).width).toBe('14px');
    expect(getComputedStyle(icon).strokeWidth).toBe('1.75px');
  }
  expect(getComputedStyle(toolbar).marginTop).toBe('8px');
  const idleColors = [...buttons].map(button => getComputedStyle(button).color);
  expect(new Set(idleColors).size).toBe(1);
  expect(idleColors[0]).toMatch(/ \/ 0\.72\)$/);
  expect(toolbar.querySelector('time')?.dateTime).toBe(new Date(timestamp).toISOString());
  expect(toolbar.querySelector('time')?.title).toBe(new Date(timestamp).toLocaleString());
  expect(message.querySelector('.flower-chat-source-copy')).toBeNull();
  const sources = message.querySelector<HTMLElement>('.flower-chat-source-list')!;
  expect(toolbar.getBoundingClientRect().bottom).toBeLessThanOrEqual(sources.getBoundingClientRect().top);
  expect(message.querySelector('.flower-chat-source-sites')!.getBoundingClientRect().height).toBeGreaterThan(0);
  const idleBounds = toolbar.getBoundingClientRect().toJSON();
  for (const button of buttons) {
    button.focus();
    await new Promise(resolve => setTimeout(resolve, 150));
    expect(getComputedStyle(button).outlineStyle).toBe('solid');
    expect(getComputedStyle(button).color).not.toBe(idleColors[0]);
    expect(toolbar.getBoundingClientRect().toJSON()).toEqual(idleBounds);
    button.blur();
  }
  await userEvent.hover(buttons[0]);
  await new Promise(resolve => setTimeout(resolve, 150));
  expect(getComputedStyle(buttons[0]).color).not.toBe(idleColors[0]);
  expect(getComputedStyle(buttons[0]).backgroundColor).not.toBe('rgba(0, 0, 0, 0)');
  expect(toolbar.getBoundingClientRect().toJSON()).toEqual(idleBounds);
  await userEvent.unhover(buttons[0]);
  await new Promise(resolve => setTimeout(resolve, 150));
  expect(getComputedStyle(buttons[0]).color).toBe(idleColors[0]);
  if (width === 320) message.querySelector<HTMLButtonElement>('.flower-chat-source-toggle')!.click();
  expect(message.scrollWidth).toBeLessThanOrEqual(message.clientWidth + 1);
  expect(toolbar.getBoundingClientRect().bottom).toBeLessThanOrEqual(sources.getBoundingClientRect().top);
  await page.screenshot({ element: runtime, path: '__screenshots__/flower-answer-actions-' + width + '-' + theme + '.png' });
});

it('exports a standalone document with sources and no interactive controls', async () => {
  const source = snapshot();
  let blob: Blob | undefined;
  const objectURL = vi.spyOn(URL, 'createObjectURL').mockImplementation(value => { blob = value as Blob; return 'blob:answer-export'; });
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  onTestFinished(() => { objectURL.mockRestore(); click.mockRestore(); });
  const runtime = renderSurfaceWithAdapterProps({ ...adapter(), listThreads: async () => [source], loadThread: async () => liveBootstrap(source) }, {
    focusThreadRequest: { request_id: 'export', thread_id: source.thread_id },
  });
  await waitFor(() => Boolean(runtime.querySelector('[aria-label="Export HTML"]')));
  await userEvent.click(runtime.querySelector<HTMLButtonElement>('[aria-label="Export HTML"]')!);
  expect(click).toHaveBeenCalledOnce();
  expect(blob?.type).toBe('text/html;charset=utf-8');
  const doc = new DOMParser().parseFromString(await blob!.text(), 'text/html');
  expect(doc.querySelector('h1')?.textContent).toBe('A considered answer');
  expect(doc.querySelectorAll('section a')).toHaveLength(2);
  expect(doc.querySelector('time')?.dateTime).toBe(new Date(timestamp).toISOString());
  expect(doc.querySelectorAll('button,script,iframe')).toHaveLength(0);
  const exportedButton = runtime.querySelector<HTMLButtonElement>('[aria-label="Export started"]')!;
  expect(exportedButton).not.toBeNull();
  await userEvent.unhover(exportedButton);
  exportedButton.blur();
  await new Promise(resolve => setTimeout(resolve, 150));
  expect(getComputedStyle(exportedButton).color).not.toBe(getComputedStyle(runtime.querySelector('.flower-message-copy-button')!).color);
  expect(getComputedStyle(exportedButton.querySelector('svg')!).width).toBe('14px');
});

it('downloads a real HTML file through the browser', async () => {
  const source = snapshot();
  const runtime = renderSurfaceWithAdapterProps({ ...adapter(), listThreads: async () => [source], loadThread: async () => liveBootstrap(source) }, { focusThreadRequest: { request_id: 'download', thread_id: source.thread_id } });
  await waitFor(() => Boolean(runtime.querySelector('[aria-label="Export HTML"]')));
  const browser = commands as unknown as { downloadFlowerAnswerEvidence: () => Promise<{ name: string; html: string; error: string | null }> };
  const result = await browser.downloadFlowerAnswerEvidence();
  expect(result.error).toBeNull();
  expect(result.name).toMatch(/^flower-answer-.*\.html$/);
  const doc = new DOMParser().parseFromString(result.html, 'text/html');
  expect(doc.querySelector('h1')?.textContent).toBe('A considered answer');
  expect(doc.querySelectorAll('section a')).toHaveLength(2);
});

it('forks the clicked answer and reuses its request key after a transport failure', async () => {
  const source = snapshot();
  const forked = thread({ thread_id: 'answer-branch', title: 'Answer actions · Fork' });
  const pending = deferred<ReturnType<typeof thread>>();
  const fork = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue(forked);
  const runtime = renderSurfaceWithAdapterProps({ ...adapter(), listThreads: async () => [source], loadThread: async id => liveBootstrap(id === source.thread_id ? source : forked), forkThread: fork }, {
    focusThreadRequest: { request_id: 'fork-answer', thread_id: source.thread_id },
  });
  await waitFor(() => Boolean(runtime.querySelector('[aria-label="Fork from this answer"]')));
  const button = runtime.querySelector<HTMLButtonElement>('[aria-label="Fork from this answer"]')!;
  await userEvent.click(button);
  expect(fork.mock.calls[0][1]).toMatchObject({ source_item_id: 'answer', title: 'Answer actions · Fork' });
  const requestID = fork.mock.calls[0][1].client_request_id;
  expect(requestID).toBeTruthy();
  expect(button.disabled).toBe(true);
  expect(runtime.querySelector<HTMLTextAreaElement>('textarea')?.disabled).not.toBe(true);
  pending.reject(new Error('Connection interrupted'));
  await waitFor(() => !button.disabled);
  await userEvent.click(button);
  expect(fork.mock.calls[1][1]).toEqual(fork.mock.calls[0][1]);
  expect(fork.mock.calls[1][1].client_request_id).toBe(requestID);
  await waitFor(() => Boolean(runtime.querySelector('[data-thread-id="answer-branch"]')));
});

it('keeps answer actions and time absent while a response is streaming', async () => {
  const fixture = streamingFixture(2, 0);
  const runtime = renderSurfaceWithAdapterProps({ ...fixture.adapter, forkThread: vi.fn() }, { focusThreadRequest: { request_id: 'stream', thread_id: fixture.thread.thread_id } });
  await waitFor(() => Boolean(runtime.querySelector('[data-flower-message-id="streaming-tail"]')));
  expect(runtime.querySelector('.flower-answer-actions')).toBeNull();
  expect(runtime.querySelector('[data-flower-message-id="streaming-tail"] time')).toBeNull();
});

it('exports block content without hidden reasoning or active HTML', () => {
  const html = flowerAnswerHTML({ content: '', title: '<Report>', timestamp, sources: [], sourcesLabel: 'Sources', unavailableLabel: 'Unavailable', blocks: [
    { type: 'thinking', content: 'Hidden reasoning' }, { type: 'text', content: '<b>Literal text</b>' },
    { type: 'markdown', content: '# Result\n\n<script>alert(1)</script>\n\n[unsafe](javascript:alert(1))' },
  ] });
  const doc = new DOMParser().parseFromString(html, 'text/html');
  expect(doc.title).toBe('<Report>');
  expect(doc.body.textContent).toContain('<b>Literal text</b>');
  expect(doc.body.textContent).not.toContain('Hidden reasoning');
  expect(doc.querySelectorAll('script,iframe,[href^="javascript:"]')).toHaveLength(0);
  expect(doc.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content')).toContain("default-src 'none'");
});

it('exports inline provenance and authored sources once without exposing reasoning', () => {
  const marker = '\uE200cite\uE202turn0search0\uE201';
  const prefix = 'Verified statement ';
  const url = 'https://example.com/reference';
  const fence = String.fromCharCode(96).repeat(3);
  const content = prefix + marker + '\n\n' + fence + 'text\n[1] Reference\n' + url + '\n' + fence;
  const html = flowerAnswerHTML({ content, title: 'Answer', timestamp, sources: [{ title: 'Reference', url, start_index: prefix.length, end_index: prefix.length + marker.length }], sourcesLabel: 'Sources', unavailableLabel: 'Unavailable' });
  const doc = new DOMParser().parseFromString(html, 'text/html');
  expect(doc.querySelector('.flower-chat-citation')?.getAttribute('href')).toBe(url);
  expect(doc.querySelectorAll('section li')).toHaveLength(1);
  expect(doc.querySelectorAll('button, script, iframe')).toHaveLength(0);
  expect(doc.body.textContent).not.toContain(marker);
  const hidden = flowerAnswerHTML({ content: 'Private fallback', title: 'Answer', timestamp, sources: [], sourcesLabel: 'Sources', unavailableLabel: 'Unavailable', blocks: [{ type: 'thinking', content: 'Private reasoning' }] });
  expect(new DOMParser().parseFromString(hidden, 'text/html').body.textContent).not.toContain('Private');
});

it('places authored source fences below the answer toolbar', async () => {
  const source = snapshot();
  const fence = String.fromCharCode(96).repeat(3);
  const content = answer + '\n\n' + fence + 'text\n[1] Reference\nhttps://example.com/reference\n' + fence;
  const authored = { ...source, messages: [{ ...source.messages[0], content, sources: [], blocks: [{ type: 'markdown' as const, content }] }] };
  const runtime = renderSurfaceWithAdapterProps({ ...adapter(), listThreads: async () => [authored], loadThread: async () => liveBootstrap(authored), forkThread: vi.fn() }, { focusThreadRequest: { request_id: 'authored', thread_id: source.thread_id } });
  await waitFor(() => Boolean(runtime.querySelector('.flower-chat-source-list')));
  const toolbar = runtime.querySelector<HTMLElement>('.flower-answer-actions')!;
  const sources = runtime.querySelector<HTMLElement>('.flower-chat-source-list')!;
  expect(toolbar.getBoundingClientRect().bottom).toBeLessThanOrEqual(sources.getBoundingClientRect().top);
  expect(sources.querySelectorAll('button')).toHaveLength(1);
});


it('keeps touch action targets at 44px without overflowing the answer', async () => {
  const touch = commands as unknown as { emulateTouchInput: (enabled: boolean) => Promise<void> };
  await page.viewport(320, 800);
  await touch.emulateTouchInput(true);
  try {
    const source = snapshot();
    const runtime = renderSurfaceWithAdapterProps({ ...adapter(), listThreads: async () => [source], loadThread: async () => liveBootstrap(source), forkThread: vi.fn() }, { focusThreadRequest: { request_id: 'touch', thread_id: source.thread_id } });
    await waitFor(() => Boolean(runtime.querySelector('.flower-answer-actions')));
    const toolbar = runtime.querySelector<HTMLElement>('.flower-answer-actions')!;
    expect([...toolbar.querySelectorAll('button')].map(button => [button.getBoundingClientRect().width, button.getBoundingClientRect().height])).toEqual([[44, 44], [44, 44], [44, 44]]);
    expect(toolbar.scrollWidth).toBeLessThanOrEqual(toolbar.clientWidth + 1);
  } finally { await touch.emulateTouchInput(false); }
});

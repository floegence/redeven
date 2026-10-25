import '../index.css';
import './flower-feature.css';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { createSignal } from 'solid-js';
import { ActivityFieldRows } from '../../../../flower_ui/src/ActivityFieldRows';
import { createActivityFieldReader } from '../../../../flower_ui/src/activityFieldReader';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../../../../flower_ui/src/copy';
import type { FlowerActivityField, FlowerActivityItem, FlowerActivityStructurePage, FlowerSurfaceAdapter } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';

let warningSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  warningSpy = vi.spyOn(console, 'warn');
});
afterEach(() => {
  const warnings = warningSpy.mock.calls.filter((args: unknown[]) => String(args[0]).includes('computations created outside'));
  warningSpy.mockRestore();
  expect(warnings).toEqual([]);
});
const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).reverse().forEach(dispose => dispose()));
async function until(check: () => boolean) {
  const deadline = performance.now() + 5000;
  while (!check()) { if (performance.now() > deadline) throw new Error('Rows did not become ready.'); await new Promise(resolve => setTimeout(resolve, 20)); }
}
function mount(toolName = 'inspect') {
  const rows = Array.from({ length: 180 }, (_, index) => ({ title: 'Row ' + index, format: index === 0 ? 'markdown' : 'code', language: 'ts',
    content: index === 0 ? '**Rich output**\n\n[Reference](https://example.com)\n\n' + 'Paragraph.\n\n'.repeat(80) : 'const row = ' + index + ';\n' + '// code line\n'.repeat(250) }));
  if (toolName === 'report_to_parent') rows[0] = { title: 'message', content: 'Retained report message', format: 'text', language: '' };
  const resolve = (path: string): unknown => path.split('/').slice(3).reduce<unknown>((value, key) => (value as Record<string, unknown>)[key], rows);
  const field = (path: string, value: unknown): FlowerActivityField => typeof value === 'string' ? { path, kind: 'string', bytes: new TextEncoder().encode(value).length,
    entry_id: 'source', source_sha256: 'source', sha256: path } : { path, kind: 'object', count: Object.keys(value as object).length };
  const api = {
    loadActivityValue: vi.fn<NonNullable<FlowerSurfaceAdapter['loadActivityValue']>>(async (_thread, input) => {
      const row = resolve(input.path) as Record<string, unknown>;
      return { thread_id: 'thread', item_id: 'tool', turn_id: 'turn', run_id: 'run', path: input.path,
        value: Object.fromEntries(Object.entries(row).filter(([key]) => !input.fields || input.fields.includes(key))),
        text_fields: input.text_fields?.filter(key => typeof row[key] === 'string').map(key => field(input.path + '/' + key, row[key])) };
    }),
    loadActivityStructure: vi.fn<NonNullable<FlowerSurfaceAdapter['loadActivityStructure']>>(async (_thread, input): Promise<FlowerActivityStructurePage> => {
      const value = resolve(input.path);
      const children = typeof value === 'object' ? Object.entries(value as object).map(([key, value]) => field(input.path + '/' + key, value)) : [];
      return { thread_id: 'thread', item_id: 'tool', turn_id: 'turn', run_id: 'run', version: 'v1', field: field(input.path, value), children, next: children.length, has_more: false };
    }),
    loadActivityField: vi.fn<NonNullable<FlowerSurfaceAdapter['loadActivityField']>>(async (_thread, input) => {
      const bytes = new TextEncoder().encode(resolve(input.path) as string);
      return { thread_id: 'thread', path: input.path, entry_id: 'source', source_sha256: 'source', sha256: input.path, bytes: bytes.length,
        offset_bytes: input.offset_bytes, text: new TextDecoder().decode(bytes.slice(input.offset_bytes, input.offset_bytes + input.limit_bytes!)) };
    }),
  };
  const item: FlowerActivityItem = { item_id: 'activity', tool_name: toolName, kind: 'tool', status: 'success', severity: 'normal', needs_attention: false, requires_approval: false };
  const reader = createActivityFieldReader(api);
  const root = document.createElement('div'); root.style.width = '600px'; document.body.append(root);
  const [revision, setRevision] = createSignal(1);
  const dispose = render(() => <ActivityFieldRows reader={reader} threadID="thread" itemID="tool" item={item} field={{ path: toolName === 'report_to_parent' ? '/payload/inputs' : '/payload/rows', kind: 'array', count: rows.length }}
    section={toolName === 'report_to_parent' ? 'inputs' : 'results'} copy={DEFAULT_FLOWER_SURFACE_COPY.chat} revision={revision()} />, root);
  cleanup.push(() => { dispose(); root.remove(); reader.dispose(); });
  return { root, api, refresh: () => setRevision(value => value + 1) };
}
describe('visible structured result rows', () => {
  it('preserves input labels and screenshot filtering for oversized plain text', async () => {
    for (const fixture of [
      { tool: 'inspect', section: 'inputs' as const, title: 'path', content: ' '.repeat(70000) + '/bounded/file', expected: DEFAULT_FLOWER_SURFACE_COPY.chat.toolActivity.inputPaths },
      { tool: 'computer.screenshot', section: 'results' as const, title: 'Screenshot', content: ' '.repeat(70000), expected: undefined },
    ]) {
      const reader = createActivityFieldReader({});
      const raw = new TextEncoder().encode(fixture.content);
      vi.spyOn(reader, 'snapshot').mockImplementation(async (threadID, itemID, path) => ({
        thread_id: threadID, item_id: itemID, turn_id: 'turn', run_id: 'run', path,
        value: { format: 'text', title: fixture.title }, text_fields: [{ path: path + '/content', kind: 'string',
          source_id: 'content', run_id: 'run', bytes: raw.length,
          text_extent: { start_bytes: 70000, end_bytes: raw.length } }],
      }));
      const chunk = vi.spyOn(reader, 'chunk').mockImplementation(async (_thread, _item, _field, offset) => {
        const next = Math.min(raw.length, offset + 16384);
        return { offset, next, text: new TextDecoder().decode(raw.slice(offset, next)), complete: next === raw.length };
      });
      const item: FlowerActivityItem = { item_id: 'call', tool_name: fixture.tool, renderer: 'structured', kind: 'tool', status: 'success',
        severity: 'normal', needs_attention: false, requires_approval: false,
        ...(fixture.tool === 'computer.screenshot' ? { target_refs: [{ kind: 'computer_frame' as const, label: 'Screenshot', resource_ref: 'computer://capture/' + 'a'.repeat(64) }] } : {}) };
      const root = document.createElement('div'); document.body.append(root);
      const dispose = render(() => <ActivityFieldRows reader={reader} threadID="thread" itemID="tool" item={item}
        field={{ path: fixture.section === 'inputs' ? '/payload/inputs' : '/payload/rows', kind: 'array', count: 1 }}
        section={fixture.section} copy={DEFAULT_FLOWER_SURFACE_COPY.chat} />, root);
      cleanup.push(() => { dispose(); root.remove(); reader.dispose(); });
      await until(() => Boolean(root.querySelector('[data-activity-row-index="0"]')));
      if (fixture.expected) expect(root.querySelector('.flower-activity-structured-row-heading strong')?.textContent).toBe(fixture.expected);
      else { expect(root.querySelector('.flower-activity-structured-row')).toBeNull(); expect(chunk).not.toHaveBeenCalled(); }
    }
  });

  it('does not transfer script disclosure to a different row at the same ordinal', async () => {
    const reader = createActivityFieldReader({});
    let title = 'Original script';
    vi.spyOn(reader, 'snapshot').mockImplementation(async (threadID, itemID, path) => ({
      thread_id: threadID, item_id: itemID, turn_id: 'turn', run_id: 'run', path,
      value: { format: 'code', title }, text_fields: [{ path: path + '/content', kind: 'string', bytes: 7, inline_text: 'echo ok' }],
    }));
    const [revision, setRevision] = createSignal(1);
    const root = document.createElement('div'); document.body.append(root);
    const item: FlowerActivityItem = { item_id: 'call', tool_name: 'inspect', kind: 'tool', status: 'success',
      severity: 'normal', needs_attention: false, requires_approval: false };
    const dispose = render(() => <ActivityFieldRows reader={reader} threadID="thread" itemID="tool" item={item}
      field={{ path: '/payload/inputs', kind: 'array', count: 1 }} section="inputs" copy={DEFAULT_FLOWER_SURFACE_COPY.chat}
      revision={revision()} />, root);
    cleanup.push(() => { dispose(); root.remove(); reader.dispose(); });
    await until(() => Boolean(root.querySelector('.flower-activity-script-toggle')));
    const original = root.querySelector<HTMLButtonElement>('.flower-activity-script-toggle')!;
    original.click();
    expect(original.getAttribute('aria-expanded')).toBe('true');
    setRevision(2);
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(root.querySelector('.flower-activity-script-toggle')).toBe(original);
    expect(original.getAttribute('aria-expanded')).toBe('true');
    title = 'Replacement script'; setRevision(3);
    await until(() => root.textContent?.includes('Replacement script') === true);
    expect(root.querySelector('.flower-activity-script-toggle')?.getAttribute('aria-expanded')).toBe('false');
  });
  it('preserves growing script disclosure but resets same-label replacement', async () => {
    const reader = createActivityFieldReader({});
    let content = 'echo original';
    vi.spyOn(reader, 'snapshot').mockImplementation(async (threadID, itemID, path) => ({
      thread_id: threadID, item_id: itemID, turn_id: 'turn', run_id: 'run', path,
      value: { format: 'code', title: 'Script' }, text_fields: [{ path: path + '/content', kind: 'string',
        bytes: new TextEncoder().encode(content).length, inline_text: content }],
    }));
    const [revision, setRevision] = createSignal(1);
    const root = document.createElement('div'); document.body.append(root);
    const item: FlowerActivityItem = { item_id: 'call', tool_name: 'inspect', kind: 'tool', status: 'running',
      severity: 'normal', needs_attention: false, requires_approval: false };
    const dispose = render(() => <ActivityFieldRows reader={reader} threadID="thread" itemID="tool" item={item}
      field={{ path: '/payload/inputs', kind: 'array', count: 1 }} section="inputs" copy={DEFAULT_FLOWER_SURFACE_COPY.chat}
      revision={revision()} />, root);
    cleanup.push(() => { dispose(); root.remove(); reader.dispose(); });
    await until(() => Boolean(root.querySelector('.flower-activity-script-toggle')));
    const toggle = root.querySelector<HTMLButtonElement>('.flower-activity-script-toggle')!;
    toggle.click();
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    content += '\necho appended'; setRevision(2);
    await until(() => root.textContent?.includes('echo appended') === true);
    expect(root.querySelector('.flower-activity-script-toggle')).toBe(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    content = 'echo replacement'; setRevision(3);
    await until(() => root.textContent?.includes('echo replacement') === true);
    expect(root.querySelector('.flower-activity-script-toggle')?.getAttribute('aria-expanded')).toBe('false');
  });

  it('cancels hidden reads and revalidates visible rows after reconnection', async () => {
    const reader = createActivityFieldReader({});
    const pending: (() => void)[] = [];
    let content = 'Initial';
    let held = true;
    const snapshot = vi.spyOn(reader, 'snapshot').mockImplementation(async (threadID, itemID, path, signal) => {
      const text = content;
      if (held) await new Promise<void>(resolve => pending.push(resolve));
      signal.throwIfAborted();
      return { thread_id: threadID, item_id: itemID, turn_id: 'turn', run_id: 'run', path,
        value: { format: 'text' }, text_fields: [{ path: path + '/content', kind: 'string',
          bytes: new TextEncoder().encode(text).length, inline_text: text }] };
    });
    const [active, setActive] = createSignal(true);
    const [connection, setConnection] = createSignal(1);
    const [revision, setRevision] = createSignal(1);
    const root = document.createElement('div'); document.body.append(root);
    const item: FlowerActivityItem = { item_id: 'call', tool_name: 'inspect', kind: 'tool', status: 'success',
      severity: 'normal', needs_attention: false, requires_approval: false };
    const dispose = render(() => <ActivityFieldRows reader={reader} threadID="thread" itemID="tool" item={item}
      field={{ path: '/payload/rows', kind: 'array', count: 1 }} section="results" copy={DEFAULT_FLOWER_SURFACE_COPY.chat}
      active={active()} connection={connection()} revision={revision()} />, root);
    cleanup.push(() => { dispose(); root.remove(); reader.dispose(); pending.forEach(resolve => resolve()); });
    await until(() => snapshot.mock.calls.length === 1);
    setActive(false); setRevision(2);
    pending[0]();
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(root.textContent).not.toContain('Initial');
    content = 'Current'; held = false; setActive(true);
    await until(() => root.textContent?.includes('Current') === true);
    const row = root.querySelector('[data-activity-row-index="0"]');
    content = 'Reconnected'; setConnection(2);
    await until(() => root.textContent?.includes('Reconnected') === true);
    expect(root.querySelector('[data-activity-row-index="0"]')).toBe(row);
    expect(snapshot).toHaveBeenCalledTimes(3);
    expect(root.querySelector('.flower-activity-field-rows > [role="status"]')).toBeNull();
  });
  it('keeps a new request owned when an older visit to the same item settles', async () => {
    const reader = createActivityFieldReader({});
    const pending: (() => void)[] = [];
    const snapshot = vi.spyOn(reader, 'snapshot').mockImplementation(async (threadID, itemID, path) => {
      await new Promise<void>(resolve => pending.push(resolve));
      return { thread_id: threadID, item_id: itemID, turn_id: 'turn', run_id: 'run', path,
        value: { format: 'text' }, text_fields: [{ path: path + '/content', kind: 'string', bytes: 7, inline_text: 'Current' }] };
    });
    const [itemID, setItemID] = createSignal('first');
    const root = document.createElement('div'); document.body.append(root);
    const item: FlowerActivityItem = { item_id: 'call', tool_name: 'inspect', kind: 'tool', status: 'success',
      severity: 'normal', needs_attention: false, requires_approval: false };
    const dispose = render(() => <ActivityFieldRows reader={reader} threadID="thread" itemID={itemID()} item={item}
      field={{ path: '/payload/rows', kind: 'array', count: 1 }} section="results" copy={DEFAULT_FLOWER_SURFACE_COPY.chat} />, root);
    cleanup.push(() => { dispose(); root.remove(); reader.dispose(); pending.forEach(resolve => resolve()); });
    await until(() => snapshot.mock.calls.length === 1);
    setItemID('second');
    await until(() => snapshot.mock.calls.length === 2);
    setItemID('first');
    await until(() => snapshot.mock.calls.length === 3);
    pending[0]();
    await new Promise(resolve => setTimeout(resolve, 120));
    expect(snapshot).toHaveBeenCalledTimes(3);
    pending[2]();
    await until(() => root.textContent?.includes('Current') === true);
    expect(root.querySelector('.flower-activity-field-rows > [role="status"]')).toBeNull();
  });

  it('retains specialized parent report content when its input row is read', async () => {
    const { root } = mount('report_to_parent');
    await until(() => Boolean(root.querySelector('[data-activity-row-index="0"]')));
    expect(root.textContent).toContain('Retained report message');
  });
  it('bounds retained rows while selected text stays pinned away from the viewport', async () => {
    const { root } = mount();
    await until(() => Boolean(root.querySelector('.flower-activity-structured-row-markdown')));
    const viewport = root.querySelector<HTMLElement>('.flower-activity-field-rows-viewport')!;
    const first = root.querySelector<HTMLElement>('[data-activity-row-index="0"]')!;
    const text = first.querySelector('strong')!.firstChild!;
    const selection = document.getSelection()!;
    const range = document.createRange(); range.setStart(text, 0); range.setEnd(text, 3);
    selection.removeAllRanges(); selection.addRange(range);
    const selected = selection.toString();
    try {
      for (let count = 0; count < 30; count++) {
        const previous = Number([...viewport.querySelectorAll<HTMLElement>('[data-activity-row-index]')].at(-1)?.dataset.activityRowIndex);
        viewport.scrollTop = viewport.scrollHeight; viewport.dispatchEvent(new Event('scroll'));
        await until(() => Number([...viewport.querySelectorAll<HTMLElement>('[data-activity-row-index]')].at(-1)?.dataset.activityRowIndex) > previous);
        expect(selection.toString()).toBe(selected);
        expect(first.isConnected).toBe(true);
        expect(viewport.querySelectorAll('[data-activity-row-index]').length).toBeLessThanOrEqual(14);
      }
      const gap = viewport.querySelector<HTMLElement>('[data-activity-row-gap]')!;
      expect(gap).not.toBeNull();
      const start = Number(gap.dataset.activityRowGap);
      viewport.scrollTop = gap.offsetTop - viewport.offsetTop - viewport.clientHeight / 2;
      viewport.dispatchEvent(new Event('scroll'));
      await until(() => Boolean(viewport.querySelector('[data-activity-row-index="' + start + '"]')));
      expect(selection.toString()).toBe(selected);
    } finally { selection.removeAllRanges(); }
    expect(root.querySelector('.flower-activity-field-rows > [role="status"]')).toBeNull();
  });
  it('seeks into an evicted gap without replaying intervening rows or losing selected text', async () => {
    const { root, api } = mount();
    await until(() => Boolean(root.querySelector('.flower-activity-structured-row-markdown')));
    const viewport = root.querySelector<HTMLElement>('.flower-activity-field-rows-viewport')!;
    const first = root.querySelector<HTMLElement>('[data-activity-row-index="0"]')!;
    const text = first.querySelector('strong')!.firstChild!;
    const selection = document.getSelection()!;
    const range = document.createRange(); range.setStart(text, 0); range.setEnd(text, 3);
    selection.removeAllRanges(); selection.addRange(range);
    const selected = selection.toString();
    try {
      for (let count = 0; count < 30; count++) {
        const last = Number([...viewport.querySelectorAll<HTMLElement>('[data-activity-row-index]')].at(-1)?.dataset.activityRowIndex);
        viewport.scrollTop = viewport.scrollHeight; viewport.dispatchEvent(new Event('scroll'));
        await until(() => Number([...viewport.querySelectorAll<HTMLElement>('[data-activity-row-index]')].at(-1)?.dataset.activityRowIndex) > last);
      }
      const gap = viewport.querySelector<HTMLElement>('[data-activity-row-gap]')!;
      const firstMissing = Number(gap.dataset.activityRowGap);
      const lastMissing = Number(gap.dataset.activityRowGapEnd);
      const middle = Math.floor((firstMissing + lastMissing) / 2);
      const calls = api.loadActivityValue.mock.calls.length;
      viewport.scrollTop += gap.getBoundingClientRect().top - viewport.getBoundingClientRect().top + gap.clientHeight / 2;
      viewport.dispatchEvent(new Event('scroll'));
      await until(() => [...viewport.querySelectorAll<HTMLElement>('[data-activity-row-index]')].some(node => {
        const index = Number(node.dataset.activityRowIndex), box = node.getBoundingClientRect(), bounds = viewport.getBoundingClientRect();
        return Math.abs(index - middle) <= 1 && box.bottom > bounds.top && box.top < bounds.bottom;
      }));
      expect(api.loadActivityValue.mock.calls.length - calls).toBeLessThanOrEqual(3);
      expect(selection.toString()).toBe(selected);
      expect(first.isConnected).toBe(true);
      expect(viewport.querySelectorAll('[data-activity-row-index]').length).toBeLessThanOrEqual(14);
    } finally { selection.removeAllRanges(); }
  });
  it('keeps rich rendering and only loads rows near the viewport', async () => {
    const { root, api, refresh } = mount();
    await until(() => Boolean(root.querySelector('strong')));
    expect(root.querySelector('strong')?.textContent).toBe('Row 0');
    expect(root.querySelector('.flower-activity-structured-row-markdown strong')?.textContent).toBe('Rich output');
    expect(root.querySelector('a')?.getAttribute('href')).toBe('https://example.com');
    const viewport = root.querySelector<HTMLElement>('.flower-activity-field-rows-viewport')!;
    const first = root.querySelector('[data-activity-row-index="0"]');
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(api.loadActivityValue.mock.calls.every(call => Number(call[1].path.split('/')[3]) < 5)).toBe(true);
    viewport.focus(); refresh();
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(root.querySelector('[data-activity-row-index="0"]')).toBe(first);
    expect(document.activeElement).toBe(viewport);
    for (let count = 0; count < 20; count++) {
      const prior = Number(viewport.lastElementChild?.getAttribute('data-activity-row-index') ?? -1);
      viewport.scrollTop = viewport.scrollHeight; viewport.dispatchEvent(new Event('scroll'));
      await until(() => Number(viewport.lastElementChild?.getAttribute('data-activity-row-index') ?? -1) > prior);
    }
    expect(viewport.childElementCount).toBeLessThanOrEqual(12);
    const loadedLast = Number(viewport.lastElementChild?.getAttribute('data-activity-row-index'));
    const updates = setInterval(refresh, 5);
    try {
      for (let count = 0; count < 12; count++) {
        const before = Number(viewport.firstElementChild?.getAttribute('data-activity-row-index') ?? 0);
        if (!before) break;
        viewport.scrollTop = 0; viewport.dispatchEvent(new Event('scroll'));
        await until(() => Number(viewport.firstElementChild?.getAttribute('data-activity-row-index') ?? 0) < before);
      }
    } finally { clearInterval(updates); }
    expect(Number(viewport.firstElementChild?.getAttribute('data-activity-row-index'))).toBeLessThan(loadedLast - 12);
    expect(viewport.childElementCount).toBeLessThanOrEqual(12);
    expect(root.querySelector('pre code')).not.toBeNull();
    expect(root.querySelector('.flower-activity-field-rows > [role=status]')).toBeNull();
    expect([...root.querySelectorAll('button')].some(button => /earlier|newer|load more/i.test(button.textContent ?? ''))).toBe(false);
  });
});

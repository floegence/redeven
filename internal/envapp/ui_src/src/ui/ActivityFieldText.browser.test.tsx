import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from 'solid-js/web';
import { createSignal } from 'solid-js';
import type { FlowerActivityField } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import { createActivityFieldReader } from '../../../../flower_ui/src/activityFieldReader';
import { ActivityFieldText } from '../../../../flower_ui/src/ActivityFieldText';
import type { FlowerActivityFieldRequest } from '../../../../flower_ui/src/contracts/flowerSurfaceContracts';

const cleanups: Array<() => void> = [];
afterEach(() => { cleanups.splice(0).reverse().forEach(clean => clean()); });
async function until(check: () => boolean) {
  const end = performance.now() + 5000;
  while (!check()) { if (performance.now() > end) throw new Error('Field did not become ready.'); await new Promise(resolve => setTimeout(resolve, 20)); }
}
function mount(growing = false) {
  const bytes = new TextEncoder().encode('a中🌸\n'.repeat(120000));
  const api = vi.fn(async (_thread: string, input: FlowerActivityFieldRequest) => {
    let offset = input.offset_bytes;
    if (input.align_start) while (offset && (bytes[offset] & 0xc0) === 0x80) offset--;
    let end = Math.min(bytes.length, offset + input.limit_bytes!);
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    return { thread_id: 'thread', path: '/payload/output', entry_id: input.entry_id, source_sha256: input.source_sha256, sha256: input.sha256,
      bytes: bytes.length, offset_bytes: offset, text: new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(offset, end)) };
  });
  const reader = createActivityFieldReader({ loadActivityField: api });
  const root = document.createElement('div'); document.body.append(root); root.style.width = '500px';
  const [field, setField] = createSignal<FlowerActivityField>({ path: '/payload/output', kind: 'string', bytes: growing ? bytes.length / 2 : bytes.length, entry_id: 'result', source_sha256: 'source', sha256: 'text' });
  const dispose = render(() => <ActivityFieldText reader={reader} threadID="thread" itemID="tool" label="Tool output" loadingLabel="Loading" failedLabel="Failed"
    maximumBytes={40 << 10} field={field()} />, root);
  cleanups.push(() => { dispose(); root.remove(); reader.dispose(); });
  return { root, reader, api, bytes, dispose, grow: (index: number) => setField({ ...field(), bytes: bytes.length, entry_id: 'complete-' + index, source_sha256: 'source-' + index, sha256: 'text-' + index }) };
}
describe('continuous activity field', () => {
  it('publishes an empty source before presenting live output without a body read', async () => {
    const reader = createActivityFieldReader({});
    const chunk = vi.spyOn(reader, 'chunk');
    const publish = vi.fn(), release = vi.fn();
    const prepareSource = vi.fn(async () => ({ publish, release }));
    const root = document.createElement('div'); document.body.append(root);
    const dispose = render(() => <ActivityFieldText reader={reader} threadID="thread" itemID="tool"
      field={{ path: '/payload/output', kind: 'string', bytes: 0, inline_text: '' }} prepareSource={prepareSource}
      tail="Live output" label="Output" loadingLabel="Loading" failedLabel="Failed" />, root);
    cleanups.push(() => { dispose(); root.remove(); reader.dispose(); });
    await until(() => root.querySelector('[data-field-live-output]')?.textContent === 'Live output');
    expect(prepareSource).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(release).toHaveBeenCalledTimes(1);
    expect(chunk).not.toHaveBeenCalled();
  });
  it('follows live output only until the user leaves its actual tail', async () => {
    const reader = createActivityFieldReader({});
    const root = document.createElement('div'); document.body.append(root); root.style.width = '500px';
    const text = 'Canonical line\n'.repeat(70);
    const [tail, setTail] = createSignal('First live line\n');
    const dispose = render(() => <ActivityFieldText reader={reader} threadID="thread" itemID="tool"
      field={{ path: '/payload/output', kind: 'string', bytes: text.length, inline_text: text }}
      tail={tail()} label="Output" loadingLabel="Loading" failedLabel="Failed" />, root);
    cleanups.push(() => { dispose(); root.remove(); reader.dispose(); });
    await until(() => Boolean(root.querySelector('[data-field-live-output]')));
    const viewport = root.querySelector<HTMLElement>('.flower-activity-field-viewport')!;
    viewport.scrollTop = viewport.scrollHeight; viewport.dispatchEvent(new Event('scroll'));
    setTail(value => value + 'Second live line\n'.repeat(25));
    await new Promise(resolve => setTimeout(resolve, 80));
    expect(viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight).toBeLessThanOrEqual(1);
    viewport.dispatchEvent(new WheelEvent('wheel', { deltaY: -200 }));
    viewport.scrollTop -= 200; viewport.dispatchEvent(new Event('scroll'));
    const top = viewport.scrollTop;
    setTail(value => value + 'Third live line\n'.repeat(25));
    await new Promise(resolve => setTimeout(resolve, 80));
    expect(Math.abs(viewport.scrollTop - top)).toBeLessThanOrEqual(1);
  });

  it('resumes an offscreen field before its abandoned transport settles', async () => {
    const reader = createActivityFieldReader({});
    const pending: (() => void)[] = [];
    const chunk = vi.spyOn(reader, 'chunk').mockImplementation(async (_thread, _item, _field, offset, signal) => {
      await new Promise<void>(resolve => pending.push(resolve));
      signal.throwIfAborted();
      return { offset, text: 'Current', next: offset + 7, complete: true };
    });
    const root = document.createElement('div'); document.body.append(root);
    const field: FlowerActivityField = { path: '/payload/output', kind: 'string', bytes: 7, inline_text: 'Current' };
    const dispose = render(() => <ActivityFieldText reader={reader} threadID="thread" itemID="tool" field={field}
      label="Output" loadingLabel="Loading" failedLabel="Failed" />, root);
    cleanups.push(() => { dispose(); root.remove(); reader.dispose(); pending.forEach(resolve => resolve()); });
    await until(() => chunk.mock.calls.length === 1);
    root.style.transform = 'translateY(10000px)';
    await new Promise(resolve => setTimeout(resolve, 100));
    root.style.transform = '';
    await until(() => chunk.mock.calls.length === 2);
    pending[0]();
    await new Promise(resolve => setTimeout(resolve, 80));
    expect(chunk).toHaveBeenCalledTimes(2);
    expect(root.textContent).not.toContain('Current');
    pending[1]();
    await until(() => root.textContent?.includes('Current') === true);
    expect(root.querySelector('[role=status]')).toBeNull();
  });
  it('keeps selected text, focused viewport and anchor during repeated source handoff', async () => {
    const { root, api, grow } = mount(true);
    await until(() => Boolean(root.querySelector('[data-field-offset]')));
    const viewport = root.querySelector<HTMLElement>('.flower-activity-field-viewport')!;
    viewport.scrollTop = 400; viewport.focus();
    const chunk = viewport.firstElementChild!;
    const range = document.createRange();
    range.setStart(chunk.firstChild!, 3); range.setEnd(chunk.firstChild!, 15);
    const selection = document.getSelection()!;
    selection.removeAllRanges(); selection.addRange(range);
    const selected = selection.toString();
    const top = viewport.scrollTop;
    for (let i = 1; i <= 10; i++) {
      const requests = api.mock.calls.length;
      grow(i);
      await until(() => api.mock.calls.length > requests);
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      expect(viewport.firstElementChild).toBe(chunk);
      expect(selection.toString()).toBe(selected);
      expect(document.activeElement).toBe(viewport);
      expect(Math.abs(viewport.scrollTop - top)).toBeLessThanOrEqual(1);
    }
    selection.removeAllRanges();
    expect(root.querySelector('[role=status]')).toBeNull();
  });
  it('keeps a distant selection while bounding retained text during continued scrolling', async () => {
    const { root, api } = mount();
    await until(() => Boolean(root.querySelector('[data-field-offset]')));
    const viewport = root.querySelector<HTMLElement>('.flower-activity-field-viewport')!;
    const chunk = viewport.querySelector('[data-field-offset]')!;
    const range = document.createRange();
    range.setStart(chunk.firstChild!, 3); range.setEnd(chunk.firstChild!, 15);
    const selection = document.getSelection()!;
    selection.removeAllRanges(); selection.addRange(range);
    const selected = selection.toString();
    try {
      for (let index = 0; index < 20; index++) {
        const last = Number(viewport.querySelector('[data-field-offset]:last-child')?.getAttribute('data-field-end'));
        viewport.scrollTop = viewport.scrollHeight; viewport.dispatchEvent(new Event('scroll'));
        await until(() => Number([...viewport.querySelectorAll('[data-field-offset]')].at(-1)?.getAttribute('data-field-end')) > last);
        expect(chunk.isConnected).toBe(true);
        expect(selection.toString()).toBe(selected);
        expect(new TextEncoder().encode(viewport.textContent!).length).toBeLessThanOrEqual((40 << 10) + (32 << 10));
      }
      expect(viewport.querySelector('[data-field-gap]')).not.toBeNull();
      const reads = api.mock.calls.length;
      await new Promise(resolve => setTimeout(resolve, 150));
      expect(api.mock.calls.length).toBe(reads);
      const end = Number([...viewport.querySelectorAll('[data-field-offset]')].at(-1)?.getAttribute('data-field-end'));
      viewport.scrollTop = 0; viewport.dispatchEvent(new Event('scroll'));
      expect(selection.toString()).toBe(selected);
      // Reenter the gap immediately after the pinned prefix through scrolling.
      const gap = viewport.querySelector<HTMLElement>('[data-field-gap]')!;
      const gapStart = Number(gap.dataset.fieldGap);
      viewport.scrollTop = gap.offsetTop - viewport.offsetTop - viewport.clientHeight / 2;
      viewport.dispatchEvent(new Event('scroll'));
      await until(() => [...viewport.querySelectorAll<HTMLElement>('[data-field-offset]')].some(node => Number(node.dataset.fieldOffset) === gapStart));
      expect(Number([...viewport.querySelectorAll('[data-field-offset]')].at(-1)?.getAttribute('data-field-end'))).toBeLessThanOrEqual(end);
      expect(selection.toString()).toBe(selected);
    } finally { selection.removeAllRanges(); }
    expect(root.querySelector('[role=status]')).toBeNull();
  });
  it('resolves a scrollbar jump into the middle of an evicted gap without traversing its prefix', async () => {
    const { root, api } = mount();
    await until(() => Boolean(root.querySelector('[data-field-offset]')));
    const viewport = root.querySelector<HTMLElement>('.flower-activity-field-viewport')!;
    const first = viewport.querySelector('[data-field-offset]')!;
    const range = document.createRange(); range.setStart(first.firstChild!, 3); range.setEnd(first.firstChild!, 15);
    const selection = document.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    const selected = selection.toString();
    try {
      for (let index = 0; index < 20; index++) {
        const end = Number([...viewport.querySelectorAll<HTMLElement>('[data-field-offset]')].at(-1)!.dataset.fieldEnd);
        viewport.scrollTop = viewport.scrollHeight; viewport.dispatchEvent(new Event('scroll'));
        await until(() => Number([...viewport.querySelectorAll<HTMLElement>('[data-field-offset]')].at(-1)!.dataset.fieldEnd) > end);
      }
      const gap = viewport.querySelector<HTMLElement>('[data-field-gap]')!;
      const start = Number(gap.dataset.fieldGap), end = Number(gap.dataset.fieldGapEnd);
      const middle = Math.floor((start + end) / 2);
      const reads = api.mock.calls.length;
      viewport.scrollTop += gap.getBoundingClientRect().top - viewport.getBoundingClientRect().top + gap.getBoundingClientRect().height / 2;
      viewport.dispatchEvent(new Event('scroll'));
      await until(() => [...viewport.querySelectorAll<HTMLElement>('[data-field-offset]')].some(node => Number(node.dataset.fieldOffset) <= middle + 16384 && Number(node.dataset.fieldEnd) > middle - 16384));
      expect(api.mock.calls.length - reads).toBeLessThanOrEqual(3);
      expect(first.isConnected).toBe(true);
      expect(selection.toString()).toBe(selected);
    } finally { selection.removeAllRanges(); }
  });
  it('reads only visible ranges and scrolls back through evicted Unicode text without loading buttons', async () => {
    const { root, api, bytes } = mount();
    await until(() => Boolean(root.querySelector('[data-field-offset]')));
    const viewport = root.querySelector<HTMLElement>('.flower-activity-field-viewport')!;
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(api).toHaveBeenCalledTimes(1);
    expect(root.querySelector('button')).toBeNull();
    for (let i = 0; i < 12; i++) {
      const last = Number(viewport.lastElementChild!.getAttribute('data-field-end'));
      viewport.scrollTop = viewport.scrollHeight; viewport.dispatchEvent(new Event('scroll'));
      await until(() => Number(viewport.lastElementChild!.getAttribute('data-field-end')) > last);
      expect(new TextEncoder().encode(viewport.textContent!).length).toBeLessThanOrEqual(40 << 10);
    }
    expect(Number(viewport.firstElementChild!.getAttribute('data-field-offset'))).toBeGreaterThan(0);
    for (let i = 0; i < 30 && viewport.firstElementChild!.getAttribute('data-field-offset') !== '0'; i++) {
      const first = Number(viewport.firstElementChild!.getAttribute('data-field-offset'));
      viewport.scrollTop = 0; viewport.dispatchEvent(new Event('scroll'));
      await until(() => Number(viewport.firstElementChild!.getAttribute('data-field-offset')) < first);
    }
    expect(viewport.firstElementChild!.getAttribute('data-field-offset')).toBe('0');
    for (const chunk of viewport.children) {
      const start = Number(chunk.getAttribute('data-field-offset')), end = Number(chunk.getAttribute('data-field-end'));
      expect(chunk.textContent).toBe(new TextDecoder().decode(bytes.subarray(start, end)));
    }
    expect(api.mock.calls.length).toBeLessThan(40);
  });
});

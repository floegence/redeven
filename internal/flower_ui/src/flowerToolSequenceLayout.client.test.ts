// @vitest-environment jsdom
import { createRoot, createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { createFlowerToolSequenceLayout, type FlowerToolSequenceElement } from './flowerToolSequenceLayout';
import type { FlowerToolSequence, FlowerToolSequenceProjection } from './flowerToolSequences';
import type { FlowerScrollTailController } from './flowerScrollTail';

const originalHitTest = document.elementFromPoint;
afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren();
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: originalHitTest }); });

const group = (key: string, nodeKeys = [key, key + '-child']): FlowerToolSequence => ({
  key, nodeKeys, entryKeys: nodeKeys, countsComplete: true, missingBefore: false, missingAfter: false,
  toolCount: nodeKeys.length, failedCount: 0, uncertainCount: 0, failedSubagentEventCount: 0,
  thinkingCount: 0, subagentEventCount: 0, runningCount: 0, disclosure: 'automatic', followingContentKeys: [],
});
const project = (groups: FlowerToolSequence[]): FlowerToolSequenceProjection => ({
  groups: new Map(groups.map(value => [value.key, value])),
  members: new Map(groups.flatMap(value => value.nodeKeys.map((key, index) => [key,
    { group: value, first: index === 0, last: index === value.nodeKeys.length - 1 }] as const))),
  continuingEntries: new Set(), headerKeys: new Set(),
});
const fixture = (groups: FlowerToolSequence[]) => {
  const [projection, setProjection] = createSignal(project(groups));
  const transferReadingAnchor = vi.fn();
  let dispose!: () => void;
  const layout = createRoot(stop => { dispose = stop; return createFlowerToolSequenceLayout(projection,
    { transferReadingAnchor } as unknown as FlowerScrollTailController); });
  const elements = new Map<string, FlowerToolSequenceElement>();
  const removals = new Map<string, () => void>();
  const register = (key: string) => {
    const slot = document.createElement('div'), node = document.createElement('div'), body = document.createElement('div');
    node.dataset.flowerToolRowIdentity = key;
    node.append(body); slot.append(node); document.body.append(slot);
    const element = { slot, node, body, prepareArrival: () => 0, prepareDestination: () => true, restore: vi.fn() };
    elements.set(key, element); removals.set(key, layout.register(key, element));
    return element;
  };
  for (const value of groups) for (const key of value.nodeKeys) register(key);
  return { layout, elements, removals, register, dispose, transferReadingAnchor, projection, update: (values: FlowerToolSequence[]) => setProjection(project(values)) };
};

it('places only the arriving group after hundreds of unchanged groups', async () => {
  const groups = Array.from({ length: 600 }, (_, index) => group('group-' + index));
  const value = fixture(groups);
  try {
    await Promise.resolve();
    const parentReads = vi.spyOn(Node.prototype, 'parentNode', 'get');
    const arrived = group('arrived');
    value.update([...groups, arrived]);
    for (const key of arrived.nodeKeys) value.register(key);
    await Promise.resolve();
    expect(parentReads.mock.calls.length).toBeLessThan(16);
    expect(value.elements.get('arrived-child')!.node.parentNode).toBe(value.elements.get('arrived')!.body);
    expect(value.elements.get('group-0-child')!.node.parentNode).toBe(value.elements.get('group-0')!.body);
    parentReads.mockClear();
    const historyReads = vi.spyOn(value.projection().groups, Symbol.iterator);
    value.register('standalone');
    await Promise.resolve();
    expect(parentReads.mock.calls.length).toBeLessThan(4);
    expect(historyReads).not.toHaveBeenCalled();
  } finally { value.dispose(); }
});

it('restores standalone rows and reparents both sides when groups split and merge', async () => {
  const value = fixture([group('a', ['a', 'b', 'c', 'd'])]);
  try {
    await Promise.resolve();
    value.update([group('a', ['a', 'b']), group('c', ['c', 'd'])]);
    await Promise.resolve();
    expect(value.elements.get('c')!.node.parentNode).toBe(value.elements.get('c')!.slot);
    expect(value.elements.get('d')!.node.parentNode).toBe(value.elements.get('c')!.body);
    value.update([group('a', ['a', 'b', 'c', 'd'])]);
    await Promise.resolve();
    expect([...value.elements.get('a')!.body.children].map(node => (node as HTMLElement).dataset.flowerToolRowIdentity)).toEqual(['b', 'c', 'd']);
    value.update([]);
    await Promise.resolve();
    for (const element of value.elements.values()) expect(element.node.parentNode).toBe(element.slot);
  } finally { value.dispose(); }
});

it('places late registrations and returns children before their owner is removed', async () => {
  const first = group('a');
  const value = fixture([first]);
  try {
    await Promise.resolve();
    value.removals.get('a')!();
    await Promise.resolve();
    expect(value.elements.get('a-child')!.node.parentNode).toBe(value.elements.get('a-child')!.slot);
    const replacement = value.register('a');
    await Promise.resolve();
    expect(value.elements.get('a-child')!.node.parentNode).toBe(replacement.body);
  } finally { value.dispose(); }
});

it('transfers the reading anchor when prepend changes the first mounted row', async () => {
  const original = group('group', ['a', 'b']);
  const value = fixture([original]);
  try {
    await Promise.resolve();
    const old = value.elements.get('a')!;
    vi.spyOn(old.body, 'getBoundingClientRect').mockReturnValue({ top: 30, left: 0, width: 100, height: 80 } as DOMRect);
    Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => null });
    old.body.scrollTop = 41;
    const next = group('group', ['prefix', 'a', 'b']);
    value.layout.captureReading(project([next]));
    value.update([next]);
    const prefix = value.register('prefix');
    await Promise.resolve();
    expect(value.transferReadingAnchor).toHaveBeenCalledExactlyOnceWith(old.body, prefix.body, 30);
    expect(prefix.restore).toHaveBeenCalledExactlyOnceWith(undefined, 0, 41);
    expect([...prefix.body.children].map(node => (node as HTMLElement).dataset.flowerToolRowIdentity)).toEqual(['a', 'b']);
  } finally { value.dispose(); }
});

it('keeps a selected descendant and keyboard focus through regrouping', async () => {
  const value = fixture([group('a', ['a', 'b'])]);
  try {
    await Promise.resolve();
    const child = value.elements.get('b')!;
    const text = document.createTextNode('Selected tool result');
    const input = document.createElement('input');
    child.node.append(text, input); input.focus();
    const range = document.createRange(); range.setStart(text, 0); range.setEnd(text, 8);
    document.getSelection()!.removeAllRanges();
    document.getSelection()!.addRange(range);
    expect(document.getSelection()!.toString()).toBe('Selected');
    value.update([group('a', ['prefix', 'a', 'b'])]);
    value.register('prefix');
    await Promise.resolve();
    expect(document.activeElement).toBe(input);
    expect(document.getSelection()!.toString()).toBe('Selected');
  } finally { document.getSelection()!.removeAllRanges(); value.dispose(); }
});

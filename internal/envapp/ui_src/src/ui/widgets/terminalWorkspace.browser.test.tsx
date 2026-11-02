import { batch, createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, expect, it } from 'vitest';
import { presetSplitWorkspace, type SplitWorkspaceLayout } from '@floegence/floe-webapp-core/layout';
import { createTerminalWorkspace } from './terminalWorkspace';
let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  document.body.replaceChildren();
  localStorage.removeItem('terminal-workspace-test');
  localStorage.removeItem('terminal-workspace-other');
});
const tick = () => new Promise<void>(resolve => queueMicrotask(resolve));
it('waits for hydration, browses unplaced sessions without rewriting splits, and preserves membership on close', async () => {
  let n = 0;
  const saved = presetSplitWorkspace('grid', ['a','b','c','d'], () => 'split-' + ++n)!;
  localStorage.setItem('terminal-workspace-test', JSON.stringify(saved));
  const [hydrated, setHydrated] = createSignal(false);
  const [ids, setIds] = createSignal<readonly string[]>([]);
  const [active, setActive] = createSignal<string | null>('b');
  let controller!: ReturnType<typeof createTerminalWorkspace>;
  dispose = render(() => {
    controller = createTerminalWorkspace({ storageKey: () => 'terminal-workspace-test', sessionIds: ids, hydrated, activeId: active, select: setActive });
    return <div />;
  }, document.body);
  await tick();
  expect(controller.paneIds()).toEqual(['a','c','b','d']);
  setIds(['a','b','c','d','e']); setHydrated(true); await tick();
  expect(controller.layout()).toEqual(saved);
  setActive('e'); await tick();
  expect(controller.layout()).toEqual(saved);
  expect(JSON.parse(localStorage.getItem('terminal-workspace-test')!)).toEqual(saved);
  setActive('b'); await tick();
  expect(controller.layout()).toEqual(saved);
  controller.closePane('b'); await tick();
  expect(controller.paneIds()).toEqual(['a','c','d']);
  expect(ids()).toContain('e');
  expect(active()).toBe('a');
  setIds(['c','d','e']); await tick();
  expect(controller.paneIds()).toEqual(['c','d']);
  const stored = JSON.parse(localStorage.getItem('terminal-workspace-test')!) as SplitWorkspaceLayout;
  expect(stored).toEqual(controller.layout());
});
it('rejects malformed saved layouts without affecting available sessions', async () => {
  localStorage.setItem('terminal-workspace-test', '{"type":"split","ratio":5}');
  let controller!: ReturnType<typeof createTerminalWorkspace>;
  dispose = render(() => {
    controller = createTerminalWorkspace({ storageKey: () => 'terminal-workspace-test', sessionIds: () => ['a'], hydrated: () => true, activeId: () => 'a', select: () => undefined });
    return <div />;
  }, document.body);
  await tick();
  expect(controller.paneIds()).toEqual(['a']);
});
it('defers selection placement during creation and isolates environment storage', async () => {
  let n = 0;
  const saved = presetSplitWorkspace('columns', ['a', 'b'], () => 'split-' + ++n)!;
  localStorage.setItem('terminal-workspace-test', JSON.stringify(saved));
  localStorage.setItem('terminal-workspace-other', JSON.stringify({ type: 'pane', id: 'z' }));
  const [key, setKey] = createSignal('terminal-workspace-test');
  const [ids, setIds] = createSignal<readonly string[]>(['a', 'b', 'c']);
  const [active, setActive] = createSignal<string | null>('a');
  const [busy, setBusy] = createSignal(false);
  let controller!: ReturnType<typeof createTerminalWorkspace>;
  dispose = render(() => {
    controller = createTerminalWorkspace({
      storageKey: key, sessionIds: ids, hydrated: () => true,
      activeId: active, select: setActive, deferSelectionPlacement: busy,
    });
    return <div />;
  }, document.body);
  await tick();
  setBusy(true); setActive('c'); await tick();
  expect(controller.layout()).toEqual(saved);
  controller.commit(presetSplitWorkspace('three-columns', ids(), () => 'split-' + ++n));
  setBusy(false); await tick();
  expect(controller.paneIds()).toEqual(['a', 'b', 'c']);
  const previous = localStorage.getItem('terminal-workspace-test');
  controller.setMaximized(true);
  batch(() => { setKey('terminal-workspace-other'); setIds(['z']); setActive('z'); });
  await tick();
  expect(controller.paneIds()).toEqual(['z']);
  expect(controller.maximized()).toBe(false);
  expect(localStorage.getItem('terminal-workspace-test')).toBe(previous);
});

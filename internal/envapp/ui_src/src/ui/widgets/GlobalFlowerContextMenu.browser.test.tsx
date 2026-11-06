import '../../index.css';
import { createSignal, Show } from 'solid-js';
import { render } from 'solid-js/web';
import { userEvent, page } from 'vitest/browser';
import { afterEach, expect, it, vi } from 'vitest';
import { GlobalFlowerContextMenu } from '../../../../../flower_ui/src/GlobalFlowerContextMenu';
import { createFlowerContextSources, FlowerContextSource, FlowerContextSources } from '../flower/FlowerContextSource';
import { FloatingContextMenu } from './FloatingContextMenu';
import { Copy } from '@floegence/floe-webapp-core/icons';

let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); });
const labels = { undo: 'Undo', redo: 'Redo', cut: 'Cut', copy: 'Copy', paste: 'Paste', selectAll: 'Select all', openLink: 'Open link', copyLink: 'Copy link' };

it('right-clicks the exact nested preview instance, freezes selection, and keeps one existing menu', async () => {
  const registry = createFlowerContextSources();
  const submitted = vi.fn();
  const host = document.createElement('div');
  document.body.append(host);
  const [state, setState] = createSignal('/first');
  dispose = render(() => {
    const [menu, setMenu] = createSignal(false);
    return <GlobalFlowerContextMenu label="Ask Flower" editingLabels={labels} onError={error => { throw error; }}
      prepare={request => {
        const source = registry.capture(request.target);
        const snapshot = { id: source?.id, state: source?.value.state, selection: request.selection };
        return () => submitted(snapshot);
      }}>
      <FlowerContextSources.Provider value={registry}>
        <FlowerContextSource id="page" pageID="files" pageName="Files" mode="workbench" state={{ directory: '/outer' }}>
          <button id="parent">Parent instance</button>
          <FlowerContextSource id="preview" pageID="preview" pageName="Preview" mode="overlay" state={{ path: state() }}>
            <p id="selected" onContextMenu={event => { event.preventDefault(); event.stopPropagation(); setMenu(true); }}>Selected preview contents</p>
          </FlowerContextSource>
        </FlowerContextSource>
      </FlowerContextSources.Provider>
      <Show when={menu()}><FloatingContextMenu x={20} y={60} ariaLabel="Local"
        items={[{ id: 'copy', kind: 'action', label: 'Original copy', icon: Copy, onSelect: () => {} }]}
        onDismiss={() => setMenu(false)} /></Show>
    </GlobalFlowerContextMenu>;
  }, host);
  await page.viewport(1280, 900);
  await userEvent.click(document.querySelector('#parent')!);
  const target = document.querySelector('#selected')!;
  const range = document.createRange();
  range.selectNodeContents(target);
  document.getSelection()!.removeAllRanges();
  document.getSelection()!.addRange(range);
  await userEvent.click(target, { button: 'right' });
  await expect.poll(() => document.querySelectorAll('[role=menu]').length).toBe(1);
  setState('/changed');
  await userEvent.click(document.querySelector('[data-context-action-id="assistant.ask.flower"]')!);
  expect(submitted).toHaveBeenCalledWith(expect.objectContaining({ state: { path: '/first' }, selection: 'Selected preview contents' }));
  expect(submitted.mock.calls[0][0].id).toContain('preview');
  registry.dispose();
});

it('keeps object-specific Ask Flower once and preserves the native operation', async () => {
  const action = vi.fn();
  const host = document.createElement('div');
  document.body.append(host);
  dispose = render(() => {
    const [menu, setMenu] = createSignal(false);
    return <GlobalFlowerContextMenu label="Ask Flower" editingLabels={labels} onError={vi.fn()} prepare={() => vi.fn()}>
      <button id="object" onContextMenu={event => { event.preventDefault(); setMenu(true); }}>Object</button>
      <Show when={menu()}><FloatingContextMenu x={20} y={60} ariaLabel="Object actions"
        items={[{ id: 'ask-flower', kind: 'action', label: 'Ask Flower', icon: Copy, onSelect: action },
          { id: 'copy', kind: 'action', label: 'Copy path', icon: Copy, onSelect: () => {} }]}
        onDismiss={() => setMenu(false)} /></Show>
    </GlobalFlowerContextMenu>;
  }, host);
  await userEvent.click(document.querySelector('#object')!, { button: 'right' });
  await expect.element(page.getByRole('menuitem', { name: 'Ask Flower' })).toBeVisible();
  expect(document.querySelectorAll('[role=menuitem]')).toHaveLength(2);
  await page.getByRole('menuitem', { name: 'Ask Flower' }).click();
  expect(action).toHaveBeenCalledOnce();
});

import '../../index.css';
import { FloeConfigProvider, LayoutProvider } from '@floegence/floe-webapp-core';
import { render } from 'solid-js/web';
import { afterEach, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { FileBrowserWorkspace } from './FileBrowserWorkspace';

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  document.body.replaceChildren();
});

const paint = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

it('retains action geometry across width changes and adjacent insertions', async () => {
  await page.viewport(1280, 850);
  const host = document.createElement('div');
  host.style.cssText = 'width:360px;height:560px';
  document.body.append(host);
  dispose = render(() => <FloeConfigProvider><LayoutProvider>
    <FileBrowserWorkspace mode="files" onModeChange={() => {}} files={[]}
      currentPath="/" initialPath="/" instanceId="toolbar-actions" resetKey={0} open={false}
      toolbarEndActions={<button type="button">Refresh</button>} />
  </LayoutProvider></FloeConfigProvider>, host);
  await paint();
  const toolbar = host.querySelector<HTMLElement>('[data-toolbar-layout]')!;
  const actions = toolbar.querySelector<HTMLElement>(':scope > [data-file-workspace-toolbar-actions]')!;
  expect(actions).toBeTruthy();
  const filter = actions.querySelector('label')!;
  const refresh = Array.from(actions.querySelectorAll('button')).find(button => button.textContent === 'Refresh')!;
  const snapshot = () => [actions, ...actions.querySelectorAll('*')].map(element => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height, display: style.display,
      gap: style.gap, flex: style.flex, padding: style.padding, minWidth: style.minWidth };
  });

  for (const width of [360, 640, 1100, 360]) {
    host.style.width = `${width}px`;
    await expect.poll(() => toolbar.dataset.toolbarLayout).toBe(width >= 800 ? 'inline' : 'stacked');
    await paint();
    expect(toolbar.querySelector('[data-file-workspace-toolbar-actions]')).toBe(actions);
    if (width < 800) {
      expect(getComputedStyle(actions).gap).toBe('4px');
      expect(getComputedStyle(filter).minWidth).toBe('128px');
      const rect = refresh.getBoundingClientRect();
      expect(rect.width).toBe(rect.height);
    }
    const before = snapshot();
    // A transient sibling must not change which row owns the action styles.
    // This catches positional selectors that also invalidate unrelated canvas
    // descendants when Floe inserts its Dock placement preview.
    const sibling = document.createElement('div');
    sibling.hidden = true;
    actions.after(sibling);
    await paint();
    expect(snapshot()).toEqual(before);
    sibling.remove();
    await paint();
    expect(snapshot()).toEqual(before);
  }
});

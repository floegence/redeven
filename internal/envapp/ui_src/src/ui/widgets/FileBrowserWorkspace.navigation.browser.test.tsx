import '../../index.css';
import { FloeConfigProvider, LayoutProvider } from '@floegence/floe-webapp-core';
import { KeepAliveStack } from '@floegence/floe-webapp-core/layout';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileBrowserWorkspace } from './FileBrowserWorkspace';

const cleanups: (() => void)[] = [];
const paint = () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
afterEach(() => { cleanups.splice(0).forEach((cleanup) => cleanup()); document.body.replaceChildren(); });

describe('Files Activity navigation continuity', () => {
  it.each(['Grid', 'List'])('retains the narrow toolbar, scroll and virtual rows in %s', async (mode) => {
    const host = document.createElement('div');
    document.body.append(host);
    const [selected, setSelected] = createSignal('files');
    const files = Array.from({ length: 480 }, (_, index) => ({
      id: `file-${index}`, name: `file-${String(index).padStart(3, '0')}.txt`,
      path: `/file-${index}.txt`, type: 'file' as const,
    }));
    cleanups.push(render(() => <FloeConfigProvider><LayoutProvider>
      <div style={{ width: '600px', height: '560px' }}>
        <KeepAliveStack activeId={selected()} activationMode="after-paint" class="h-full" views={[
          { id: 'files', render: () => <FileBrowserWorkspace mode="files" onModeChange={() => {}}
            files={files} currentPath="/" initialPath="/" instanceId="navigation-files"
            resetKey={0} open={false} /> },
          { id: 'other', render: () => <input aria-label="Other page draft" /> },
        ]} />
      </div>
    </LayoutProvider></FloeConfigProvider>, host));
    await paint();
    Array.from(host.querySelectorAll('button')).find((button) => button.textContent === mode)!.click();
    await paint();
    const toolbar = host.querySelector<HTMLElement>('[data-toolbar-layout]')!;
    expect(toolbar.dataset.toolbarLayout).toBe('stacked');
    const content = host.querySelector<HTMLElement>('[data-testid="file-browser-content-scroll-region"]')!;
    const viewport = [...content.querySelectorAll<HTMLElement>('*')].find((element) => element.scrollHeight > element.clientHeight && getComputedStyle(element).overflowY === 'auto')!;
    expect(viewport).toBeTruthy();
    viewport.scrollTop = 1600;
    viewport.dispatchEvent(new Event('scroll'));
    await paint();
    const itemIds = () => [...content.querySelectorAll<HTMLElement>('[data-file-browser-item-id]')].map((element) => element.dataset.fileBrowserItemId);
    const before = { scroll: viewport.scrollTop, items: itemIds() };
    expect(before.scroll).toBe(1600);
    expect(before.items[0]).not.toBe('file-0');

    setSelected('other');
    await paint();
    expect(toolbar.dataset.toolbarLayout).toBe('stacked');
    expect(itemIds()).toEqual(before.items);
    setSelected('files');
    await paint();
    expect(host.querySelector('[data-toolbar-layout]')).toBe(toolbar);
    expect({ scroll: viewport.scrollTop, items: itemIds() }).toEqual(before);

    setSelected('other');
    host.firstElementChild!.setAttribute('style', 'width: 1000px; height: 560px');
    await paint();
    setSelected('files');
    await vi.waitFor(() => expect(toolbar.dataset.toolbarLayout).toBe('inline'));
  });
});

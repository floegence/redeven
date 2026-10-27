import '../../index.css';
import axe from 'axe-core';
import { FloeConfigProvider, LayoutProvider } from '@floegence/floe-webapp-core';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, expect, it } from 'vitest';
import { commands, page } from 'vitest/browser';
import { FileBrowserWorkspace } from './FileBrowserWorkspace';

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  document.body.replaceChildren();
  document.documentElement.style.removeProperty('font-size');
});

const paint = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));

it.each([16, 20])('aligns the sidebar and file toolbar dividers at a %s px root size', async rootSize => {
  await page.viewport(1800, 850);
  document.documentElement.style.fontSize = `${rootSize}px`;
  const host = document.createElement('div');
  host.style.cssText = 'width:1700px;height:560px';
  document.body.append(host);
  const [sidebarWidth, setSidebarWidth] = createSignal(240);
  const [gitDisabled, setGitDisabled] = createSignal(false);
  dispose = render(() => <FloeConfigProvider config={{ layout: { mobileQuery: 'not all' } }}><LayoutProvider>
    <FileBrowserWorkspace mode="files" onModeChange={() => {}} files={[]}
      currentPath="/" initialPath="/" instanceId="header-alignment" resetKey={0}
      width={sidebarWidth()} open gitHistoryDisabled={gitDisabled()}
      gitHistoryDisabledReason="Git is unavailable" />
  </LayoutProvider></FloeConfigProvider>, host);
  const toolbar = host.querySelector<HTMLElement>('[data-toolbar-layout]')!;
  await expect.poll(() => toolbar.dataset.toolbarLayout).toBe('inline');
  await document.fonts.ready;
  for (const width of [180, 240, 520]) {
    setSidebarWidth(width);
    for (const disabled of [false, true]) {
      setGitDisabled(disabled);
      await paint();
      const modeSwitch = host.querySelector<HTMLElement>('[data-browser-mode-switch]')!;
      const sidebarHeader = modeSwitch.closest<HTMLElement>('.sticky')!;
      const contentHeader = host.querySelector<HTMLElement>('.file-workspace-header')!;
      expect(Math.abs(sidebarHeader.getBoundingClientRect().bottom - contentHeader.getBoundingClientRect().bottom)).toBeLessThan(0.5);
      const field = toolbar.querySelector('label')!;
      expect(modeSwitch.getBoundingClientRect().height).toBe(field.getBoundingClientRect().height);
      const [filesButton, gitButton] = Array.from(modeSwitch.querySelectorAll('button'));
      expect(gitButton.getBoundingClientRect().height).toBe(filesButton.getBoundingClientRect().height);
      expect(gitButton.getBoundingClientRect().top).toBe(filesButton.getBoundingClientRect().top);
      for (const button of [filesButton, gitButton]) {
        expect(button.getBoundingClientRect().bottom).toBeLessThan(modeSwitch.getBoundingClientRect().bottom);
      }
    }
  }
});

it.each([360, 640, 1100])('keeps the header and content geometry stable while filtering at %s px', async width => {
  await page.viewport(1280, 850);
  const host = document.createElement('div');
  host.style.cssText = `width:${width}px;height:560px`;
  document.body.append(host);
  dispose = render(() => <FloeConfigProvider><LayoutProvider>
    <FileBrowserWorkspace mode="files" onModeChange={() => {}} files={[
      { id: 'readme', name: 'README.md', type: 'file', path: '/README.md' },
      { id: 'notes', name: 'notes.txt', type: 'file', path: '/notes.txt' },
    ]} currentPath="/" initialPath="/" instanceId="filter-geometry" resetKey={0} open={false} />
  </LayoutProvider></FloeConfigProvider>, host);
  const header = host.querySelector<HTMLElement>('.file-workspace-header')!;
  const toolbar = host.querySelector<HTMLElement>('[data-toolbar-layout]')!;
  const content = host.querySelector<HTMLElement>('[data-testid="file-browser-content-scroll-region"]')!;
  const statusBar = host.querySelector<HTMLElement>('[data-file-browser-status-bar="true"]')!;
  const filter = host.querySelector<HTMLInputElement>('input[aria-label="Filter files"]')!;
  await expect.poll(() => toolbar.dataset.toolbarLayout).toBe(width >= 800 ? 'inline' : 'stacked');
  await document.fonts.ready;
  await paint();
  const geometry = () => [header, content].map(element => {
    const rect = element.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, height: rect.height };
  });
  const before = geometry();
  for (const [query, count] of [['README', '1 item'], ['missing', '0 items'], ['', '2 items']]) {
    filter.value = query;
    filter.dispatchEvent(new InputEvent('input', { bubbles: true, data: query }));
    await expect.poll(() => statusBar.textContent).toContain(count);
    await paint();
    expect(geometry()).toEqual(before);
    expect(host.querySelector('[data-testid="file-browser-header-status"]')).toBeNull();
    expect(statusBar.textContent?.includes('Filtered view')).toBe(Boolean(query));
    expect(content.textContent?.includes('README.md')).toBe(query !== 'missing');
    expect(content.textContent?.includes('notes.txt')).toBe(query === '');
  }
});

it.each([360, 640, 1100])('keeps the header and content geometry stable while editing paths at %s px', async width => {
  await page.viewport(1280, 850);
  const host = document.createElement('div');
  host.style.cssText = `width:${width}px;height:560px`;
  document.body.append(host);
  const navigatedPaths: string[] = [];
  dispose = render(() => <FloeConfigProvider><LayoutProvider>
    <FileBrowserWorkspace mode="files" onModeChange={() => {}} files={[]}
      currentPath="/" initialPath="/" instanceId="path-edit-geometry" resetKey={0} open={false}
      onNavigate={path => navigatedPaths.push(path)} />
  </LayoutProvider></FloeConfigProvider>, host);
  const header = host.querySelector<HTMLElement>('.file-workspace-header')!;
  const toolbar = host.querySelector<HTMLElement>('[data-toolbar-layout]')!;
  const content = host.querySelector<HTMLElement>('[data-testid="file-browser-content-scroll-region"]')!;
  await expect.poll(() => toolbar.dataset.toolbarLayout).toBe(width >= 800 ? 'inline' : 'stacked');
  await document.fonts.ready;
  await paint();
  const geometry = () => [header, content].map(element => {
    const rect = element.getBoundingClientRect();
    return { top: rect.top, bottom: rect.bottom, height: rect.height };
  });
  const before = geometry();
  for (const action of ['Escape', 'blur', 'Enter']) {
    const currentPath = Array.from(host.querySelectorAll<HTMLButtonElement>('nav[aria-label="Breadcrumb"] button'))
      .filter(button => button.closest('[aria-hidden="true"]') === null).at(-1)!;
    currentPath.click();
    await paint();
    const input = host.querySelector<HTMLInputElement>('input[aria-label="Go to path"]')!;
    expect(document.activeElement).toBe(input);
    expect(input.value).toBe('/');
    expect(geometry()).toEqual(before);
    expect(host.querySelector('[data-testid="file-browser-header-status"]')).toBeNull();
    expect(input.hasAttribute('aria-describedby')).toBe(false);
    input.value = '/projects';
    input.dispatchEvent(new InputEvent('input', { bubbles: true, data: '/projects' }));
    if (action === 'blur') {
      host.querySelector<HTMLInputElement>('input[aria-label="Filter files"]')!.focus();
    } else {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: action, bubbles: true }));
    }
    await paint();
    expect(host.querySelector('input[aria-label="Go to path"]')).toBeNull();
    expect(geometry()).toEqual(before);
    expect(navigatedPaths).toEqual(action === 'Enter' ? ['/projects'] : []);
  }
});

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

  const audit = await axe.run(host, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa'] } });
  expect(audit.violations.map(issue => issue.id)).toEqual([]);
  const visual = await (commands as unknown as { compareSemanticPresentation: (selector: string) => Promise<{ before: unknown; after: unknown }> }).compareSemanticPresentation('.file-workspace-header');
  expect(visual.after).toEqual(visual.before);

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

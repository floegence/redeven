import '../index.css';
import { FloeConfigProvider, LayoutProvider } from '@floegence/floe-webapp-core';
import { render } from 'solid-js/web';
import { afterEach, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { FileBrowserWorkspace } from '../ui/widgets/FileBrowserWorkspace';
import { expectSingleInputFocus } from './inputFocus.test-support';

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  document.body.replaceChildren();
  document.documentElement.classList.remove('dark', 'light');
  document.documentElement.removeAttribute('data-floe-shell-theme');
  document.documentElement.removeAttribute('data-floe-surface-style');
});

function noContourShadow(element: Element) {
  const shadow = getComputedStyle(element).boxShadow;
  expect(shadow === 'none' || shadow === 'rgba(0, 0, 0, 0) 0px 0px 0px 0px', `${element.className}: no stacked contour`).toBe(true);
}

it.each(['classic-light', 'classic-dark', 'porcelain-light', 'porcelain-dark'])('keeps real Files navigation quiet in %s while retaining field focus', async (preset) => {
  await page.viewport(1440, 900);
  document.documentElement.classList.add(preset.endsWith('dark') ? 'dark' : 'light');
  document.documentElement.dataset.floeShellTheme = preset;
  document.documentElement.dataset.floeSurfaceStyle = 'soft-neumorphic';
  const host = document.createElement('main');
  host.style.height = '850px';
  document.body.append(host);
  dispose = render(() => <FloeConfigProvider><LayoutProvider><FileBrowserWorkspace
    mode="files" onModeChange={() => undefined}
    files={[{ id: 'src', name: 'src', path: '/src', type: 'folder' }, { id: 'readme', name: 'README.md', path: '/README.md', type: 'file' }]}
    currentPath="/" initialPath="/" instanceId="quiet-files" resetKey={0} open width={240}
  /></LayoutProvider></FloeConfigProvider>, host);
  const filter = host.querySelector<HTMLInputElement>('input[placeholder="Filter files"]')!;
  expect(filter).toBeTruthy();
  const boundary = filter.closest('[data-floe-input-surface]')!;
  const rail = host.querySelector('[data-browser-mode-switch]')!;
  expect(getComputedStyle(rail).borderTopColor, 'navigation does not use the input frame').not.toBe(getComputedStyle(boundary).borderTopColor);
  noContourShadow(rail);
  noContourShadow(host.querySelector('[data-browser-mode-switch] [aria-checked="true"]')!);
  noContourShadow(boundary);
  const path = host.querySelector('nav')!.parentElement!;
  expect(getComputedStyle(path).borderTopColor, 'read-only breadcrumbs are not an input').not.toBe(getComputedStyle(boundary).borderTopColor);
  noContourShadow(path);
  filter.value = 'Retained draft';
  expectSingleInputFocus(filter);
  filter.setSelectionRange(2, 7);
  document.documentElement.dataset.floeShellTheme = preset === 'porcelain-light' ? 'classic-light' : 'porcelain-light';
  expect(host.querySelector('input[placeholder="Filter files"]')).toBe(filter);
  expect(document.activeElement).toBe(filter);
  expect([filter.value, filter.selectionStart, filter.selectionEnd]).toEqual(['Retained draft', 2, 7]);
});

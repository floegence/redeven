import '../../index.css';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { page, userEvent } from 'vitest/browser';
import { afterEach, expect, it } from 'vitest';
import { TextFilePreviewPane } from './TextFilePreviewPane';
import { FilePreviewContent } from './FilePreviewContent';

let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); });

it('searches truncated text without matching line numbers or replacing content', async () => {
  await page.viewport(390, 844);
  const host = document.createElement('div');
  host.style.cssText = 'height:400px;width:360px'; document.body.append(host);
  const [active, setActive] = createSignal(true);
  const [path, setPath] = createSignal('/workspace/large.txt');
  dispose = render(() => <TextFilePreviewPane active={active()} path={path()} descriptor={{ mode: 'text', wrapText: false }} truncated
    text={['Literal [a.b]', '中文内容', 'Literal [a.b]'].join('\n')} />, host);
  const row = host.querySelector('code')!;
  const viewport = host.querySelector<HTMLElement>('[data-testid="text-preview-fallback"]')!;
  const before = viewport.getBoundingClientRect().toJSON();
  expect(before.height).toBe(host.clientHeight);
  await userEvent.click(page.getByRole('button', { name: 'Find in file', exact: true }));
  await userEvent.fill(page.getByRole('searchbox'), '[a.b]');
  expect(viewport.getBoundingClientRect().toJSON()).toEqual(before);
  await expect.element(page.getByRole('status')).toHaveTextContent('1 of 2');
  expect(host.querySelector('code')).toBe(row);
  await userEvent.keyboard('{Enter}');
  await expect.element(page.getByRole('status')).toHaveTextContent('2 of 2');
  await userEvent.fill(page.getByRole('searchbox'), '1');
  await expect.element(page.getByRole('status')).toHaveTextContent('No matches');
  await userEvent.fill(page.getByRole('searchbox'), '中文');
  await expect.element(page.getByRole('status')).toHaveTextContent('1 of 1');
  setActive(false);
  expect([...CSS.highlights.keys()].filter(key => key.startsWith('floe-find-'))).toHaveLength(0);
  setActive(true);
  await expect.element(page.getByRole('searchbox')).toHaveValue('中文');
  setPath('/workspace/replacement.txt');
  expect(host.querySelector('[role="search"]')).toBeNull();
  await userEvent.click(page.getByRole('button', { name: 'Find in file', exact: true }));
  await expect.element(page.getByRole('searchbox')).toHaveValue('');
  await userEvent.keyboard('{Escape}');
  await expect.element(page.getByRole('button', { name: 'Find in file', exact: true })).toHaveFocus();
});

it.each([320, 1280])('keeps headerless text search discoverable without reserving space at %ipx', async width => {
  await page.viewport(width, 844);
  const host = document.createElement('div');
  host.style.cssText = 'height:400px;width:100%'; document.body.append(host);
  dispose = render(() => <FilePreviewContent showHeader={false} descriptor={{ mode: 'text' }} truncated
    item={{ id: 'text', path: '/large.txt', name: 'large.txt', type: 'file' }} text={'Search this text'} />, host);
  const viewport = host.querySelector<HTMLElement>('[data-testid="text-preview-fallback"]')!;
  const before = viewport.getBoundingClientRect().toJSON();
  expect(before.height).toBe(host.clientHeight);
  await userEvent.click(page.getByRole('button', { name: 'Find in file', exact: true }));
  await userEvent.fill(page.getByRole('searchbox'), 'text');
  await expect.element(page.getByRole('status')).toHaveTextContent('1 of 1');
  expect(viewport.getBoundingClientRect().toJSON()).toEqual(before);
  const overlay = host.querySelector<HTMLElement>('.redeven-preview-search-overlay')!;
  expect(overlay.scrollWidth).toBeLessThanOrEqual(overlay.clientWidth);
  const status = overlay.querySelector<HTMLElement>('[role="status"]')!;
  expect(status.scrollWidth).toBeLessThanOrEqual(status.clientWidth);
  expect(overlay.getBoundingClientRect().height).toBeLessThanOrEqual(44);
  expect(overlay.getBoundingClientRect().right).toBeLessThanOrEqual(width);
  await page.screenshot({ element: host, path: '__screenshots__/compact-text-search-' + width + '.png' });
});

import '../../index.css';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { page, userEvent } from 'vitest/browser';
import { afterEach, expect, it } from 'vitest';
import { TextFilePreviewPane } from './TextFilePreviewPane';

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
  await userEvent.click(page.getByRole('button', { name: 'Find in file', exact: true }));
  await userEvent.fill(page.getByRole('searchbox'), '[a.b]');
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

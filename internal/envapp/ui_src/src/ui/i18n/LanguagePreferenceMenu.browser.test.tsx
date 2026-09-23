import '../../index.css';
import { render } from 'solid-js/web';
import { afterEach, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { I18nProvider } from './I18nProvider';
import { LanguagePreferenceMenu } from './LanguagePreferenceMenu';

let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); });

it.each([320, 360, 393, 430])('keeps the unlock language menu inside a %s px viewport with accessible touch targets', async width => {
  await page.viewport(width, 430);
  const host = document.createElement('div'); document.body.append(host);
  dispose = render(() => <I18nProvider><div style={{ position: 'absolute', right: '12px', top: '60px' }}><LanguagePreferenceMenu variant="access_gate" /></div></I18nProvider>, host);
  const trigger = page.getByRole('button', { name: 'Language', exact: true });
  await userEvent.click(trigger);
  const menu = document.querySelector<HTMLElement>('[role="menu"]')!;
  await expect.poll(() => menu.getBoundingClientRect().right).toBeLessThanOrEqual(width);
  expect(menu.getBoundingClientRect().left).toBeGreaterThanOrEqual(0);
  expect(menu.getBoundingClientRect().bottom).toBeLessThanOrEqual(430);
  expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(width);
  expect(menu.querySelector('button')!.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
  await userEvent.keyboard('{End}');
  expect(document.activeElement?.getAttribute('data-envapp-language-option')).toBe('ru-RU');
  await userEvent.keyboard('{Escape}');
  expect(document.querySelector('[role="menu"]')).toBeNull();
  expect(document.activeElement?.getAttribute('data-envapp-language-trigger')).toBe('access_gate');
});

it('projects the menu through the shared layer in a scaled narrow Workbench surface', async () => {
  await page.viewport(1200, 800);
  const host = document.createElement('div'); document.body.append(host);
  dispose = render(() => <I18nProvider><div class="workbench-surface" data-floe-dialog-surface-host="true" data-floe-surface-portal-layer="true"
    style={{ position: 'relative', width: '350px', height: '420px', margin: '80px', transform: 'scale(0.8)', 'transform-origin': 'top left' }}>
    <div style={{ position: 'absolute', right: '8px', top: '8px' }}><LanguagePreferenceMenu variant="topbar" /></div>
  </div></I18nProvider>, host);
  await userEvent.click(page.getByRole('button', { name: 'Language', exact: true }));
  const menu = document.querySelector<HTMLElement>('[role="menu"]')!;
  const boundary = host.querySelector('.workbench-surface')!.getBoundingClientRect();
  await expect.poll(() => menu.getBoundingClientRect().right).toBeLessThanOrEqual(boundary.right);
  expect(menu.getBoundingClientRect().bottom).toBeLessThanOrEqual(boundary.bottom);
  expect(menu.closest('[data-floe-surface-floating-layer]')).not.toBeNull();
  expect(menu.closest('.workbench-surface')).not.toBeNull();
  expect(getComputedStyle(menu).position).not.toBe('fixed');
  await userEvent.keyboard('{Escape}');
  expect(document.activeElement?.getAttribute('data-envapp-language-trigger')).toBe('topbar');
});

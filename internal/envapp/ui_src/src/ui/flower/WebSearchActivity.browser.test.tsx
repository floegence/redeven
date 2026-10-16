import { afterEach, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'solid-js/web';
import { WebSearchActivity } from '../../../../../flower_ui/src/WebSearchActivity';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../../../../../flower_ui/src/copy';
import '@floegence/floe-webapp-core/input-focus.css';
import '../../../../../flower_ui/src/styles/flower.css';

let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); });

it('shows actual sources and visible snippets with keyboard expansion', async () => {
  const host = document.createElement('div');
  host.style.cssText = 'font-family:system-ui,sans-serif;width:320px;padding:16px;box-sizing:border-box;background:#18181b;color:#fafafa;--foreground:#fafafa;--muted:#27272a;--muted-foreground:#a1a1aa;--border:#3f3f46;--primary:#93c5fd;--ring:#93c5fd';
  document.body.append(host);
  const results = Array.from({ length: 7 }, (_, index) => ({
    title: index < 2 ? '' : 'Weather source ' + (index + 1),
    url: index === 0 ? 'javascript:alert(1)' : 'https://weather.example/' + 'forecast-'.repeat(15) + index,
    snippet: 'A short weather forecast. '.repeat(12), source: '',
  }));
  dispose = render(() => <WebSearchActivity search={{ results }} copy={DEFAULT_FLOWER_SURFACE_COPY.chat.webSearch} openLabel="Open web page" />, host);
  expect(host.querySelector('input')).toBeNull();
  expect(host.querySelectorAll('li')).toHaveLength(3);
  expect(host.querySelectorAll('a[href^="javascript:"]')).toHaveLength(0);
  expect(host.querySelectorAll('details')).toHaveLength(0);
  for (const entry of host.querySelectorAll<HTMLElement>('li')) {
    expect(entry.querySelector('.flower-web-operation-snippet')?.textContent).toContain('A short weather forecast.');
    expect(entry.scrollWidth).toBeLessThanOrEqual(entry.clientWidth);
    expect(getComputedStyle(entry).userSelect).toBe('text');
    expect(getComputedStyle(entry).borderBottomWidth).toBe('0px');
  }
  expect(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth);
  const link = host.querySelector<HTMLAnchorElement>('a')!;
  expect(link.href).toContain('forecast-'.repeat(15));
  expect(link.textContent).toBe('weather.example/' + 'forecast-'.repeat(15) + '1');
  expect(link.title).toBe(link.href);
  expect(link.rel).toBe('noopener noreferrer');
  const button = host.querySelector<HTMLButtonElement>('button')!;
  expect(button.textContent).toContain('4');
  button.focus();
  await userEvent.keyboard('{Enter}');
  expect(host.querySelectorAll('li')).toHaveLength(7);
  expect(button.getAttribute('aria-expanded')).toBe('true');
  expect(document.activeElement).toBe(button);
  await userEvent.keyboard('{Enter}');
  expect(host.querySelectorAll('li')).toHaveLength(3);
  if (import.meta.env.VITE_WEB_SEARCH_SCREENSHOT === '1') await page.screenshot();
});

it('keeps short results on one compact line with the domain beside its title', async () => {
  const host = document.createElement('div');
  host.style.cssText = 'width:640px;font-family:system-ui,sans-serif';
  document.body.append(host);
  const results = Array.from({length:7}, (_, index) => ({title:`Weather ${index+1}`,url:`https://weather.example/${index+1}`,snippet:'Sunny forecast',source:''}));
  dispose = render(() => <WebSearchActivity search={{results}} copy={DEFAULT_FLOWER_SURFACE_COPY.chat.webSearch} openLabel="Open web page" />, host);
  expect(host.querySelector('.flower-activity-detail-heading')).toBeNull();
  for (const entry of host.querySelectorAll<HTMLElement>('li')) {
    const title = entry.querySelector('.flower-web-operation-source-primary')!.getBoundingClientRect();
    const domain = entry.querySelector('.flower-web-operation-source-domain')!.getBoundingClientRect();
    const snippet = entry.querySelector('.flower-web-operation-snippet')!.getBoundingClientRect();
    expect(entry.getBoundingClientRect().height).toBeLessThanOrEqual(23);
    expect(domain.left - title.right).toBeLessThanOrEqual(9);
    expect(Math.abs(snippet.top - title.top)).toBeLessThanOrEqual(3);
  }
  const button = host.querySelector<HTMLButtonElement>('button')!;
  button.click();
  expect(host.querySelectorAll('li')).toHaveLength(7);
  expect(host.getBoundingClientRect().height).toBeLessThanOrEqual(185);
});

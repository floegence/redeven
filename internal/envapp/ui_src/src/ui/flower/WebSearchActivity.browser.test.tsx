import { afterEach, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'solid-js/web';
import { WebSearchActivity } from '../../../../../flower_ui/src/WebSearchActivity';
import { DEFAULT_FLOWER_SURFACE_COPY } from '../../../../../flower_ui/src/copy';
import '@floegence/floe-webapp-core/input-focus.css';
import '../../../../../flower_ui/src/styles/flower.css';

let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); });

it('shows readonly search boxes and three compact sources with keyboard expansion', async () => {
  const host = document.createElement('div');
  host.style.cssText = 'font-family:system-ui,sans-serif;width:320px;padding:16px;box-sizing:border-box;background:#18181b;color:#fafafa;--foreground:#fafafa;--muted:#27272a;--muted-foreground:#a1a1aa;--border:#3f3f46;--primary:#93c5fd;--ring:#93c5fd';
  document.body.append(host);
  const results = Array.from({ length: 7 }, (_, index) => ({
    title: index < 2 ? '' : 'Weather source ' + (index + 1),
    url: index === 0 ? 'javascript:alert(1)' : 'https://weather.example/' + 'forecast-'.repeat(15) + index,
    snippet: 'A short weather forecast. '.repeat(12), source: '',
  }));
  dispose = render(() => <WebSearchActivity search={{ query: '长沙天气\nChangsha weather forecast', url: '', pattern: '', results, notice: '' }} copy={DEFAULT_FLOWER_SURFACE_COPY.chat.webSearch} openLabel="Open web page" />, host);
  const queries = host.querySelectorAll<HTMLInputElement>('input[readonly]');
  expect(Array.from(queries, (query) => query.value)).toEqual(['长沙天气', 'Changsha weather forecast']);
  const searchbox = queries[1].parentElement!;
  const beforeFocus = searchbox.getBoundingClientRect();
  queries[1].focus();
  queries[1].select();
  expect(searchbox.getBoundingClientRect().toJSON()).toEqual(beforeFocus.toJSON());
  expect(getComputedStyle(searchbox).boxShadow).toBe('none');
  expect(queries[1].selectionEnd).toBe(queries[1].value.length);
  expect(host.querySelectorAll('li')).toHaveLength(3);
  expect(host.querySelectorAll('a[href^="javascript:"]')).toHaveLength(0);
  expect(host.querySelectorAll('details')).toHaveLength(0);
  for (const entry of host.querySelectorAll<HTMLElement>('li')) {
    expect(entry.getBoundingClientRect().height).toBeLessThanOrEqual(28);
    expect(getComputedStyle(entry).borderBottomWidth).toBe('0px');
  }
  expect(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth);
  const link = host.querySelector<HTMLAnchorElement>('a')!;
  expect(link.href).toContain('forecast-'.repeat(15));
  expect(link.textContent).toBe('weather.example/' + 'forecast-'.repeat(15) + '1');
  expect(link.title).toContain('A short weather forecast.');
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

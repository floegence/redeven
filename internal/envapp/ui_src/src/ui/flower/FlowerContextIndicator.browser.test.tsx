import { builtInShellThemePresets } from '@floegence/floe-webapp-core/themes';
import '../../index.css';
import { afterEach, expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { FlowerComposerContextIndicator } from '../../../../../flower_ui/src/chat/FlowerComposerContextIndicator';
import { createLocalizedFlowerSurfaceCopy } from '../../../../../flower_ui/src/i18n/createLocalizedFlowerSurfaceCopy';
import { mapContextUsage } from '../../../../../flower_ui/src/flowerLiveMapper';
import type { FlowerContextUsage } from '../../../../../flower_ui/src/contracts/flowerSurfaceContracts';
import type { RedevenLocale } from '../i18n/localeMeta';
import type { EnvAppTranslationKey } from '../i18n/locales';
import { createTestI18nHelpers } from '../i18n/locales/testDictionaries';
import '../../../../../flower_ui/src/styles/flower.css';

let dispose: (() => void) | undefined;
afterEach(() => {
 dispose?.(); document.body.replaceChildren();
 document.documentElement.removeAttribute('style');
 document.documentElement.classList.remove('dark', 'light');
});
const base = { available: true, measured: true, phase: 'provider_usage', pressure_status: 'stable', input_tokens: 110000, context_window_tokens: 1000000, output_headroom_tokens: 33000, updated_at_ms: 1 } as const;
function fixture(mcpTokens = 48700): FlowerContextUsage {
 return { confirmed: { ...base, characters_available: true, characters: { source: 'prepared_characters_v1', unit: 'unicode_code_points', total_characters: (3700)+(mcpTokens + 30700)+(4200)+(3000)+(1700)+(2000)+(6200), categories: [{ category: 'system', characters: 3700 },{ category: 'tool_definition', characters: mcpTokens + 30700, details: [{ key: 'search', source: 'mcp', namespace: 'docs', characters: mcpTokens - 4000 },{ key: 'read', source: 'mcp', namespace: 'docs', characters: 2000 },{ key: 'query', source: 'mcp', namespace: 'database', characters: 2000 },{ key: 'terminal.exec', source: 'builtin', characters: 20700 },{ key: 'files.read', source: 'builtin', characters: 10000 }] },{ category: 'user', characters: 4200 },{ category: 'assistant', characters: 3000 },{ category: 'tool_call', characters: 1700 },{ category: 'tool_result', characters: 2000 },{ category: 'model_context', characters: 6200, details: [{ key: 'skills', characters: 5100 },{ key: 'repository_rules', characters: 500 },{ key: 'execution_environment', characters: 250 },{ key: 'local_time', characters: 100 },{ key: 'repository', characters: 100 },{ key: 'delegation', characters: 50 },{ key: '', characters: 100 }] }] } },
  thread_usage: { input_tokens: 55, output_tokens: 10, cache_read_tokens: 45, cache_write_tokens: 0 },
  recent_request_usage: { input_tokens: 25, output_tokens: 10, cache_read_tokens: 75, cache_write_tokens: 0 },
 };
}
function theme(preset: typeof builtInShellThemePresets[number]) {
 document.documentElement.classList.toggle('dark', preset.mode === 'dark');
 for (const [name, value] of Object.entries(preset.semanticTokens ?? {})) if (value) document.documentElement.style.setProperty(name, value);
}
function mount(locale: () => RedevenLocale, usage: () => FlowerContextUsage, projected = false, placement: 'above-end' | 'below-start' = 'above-end') {
 const copy = () => {
  const i18n = createTestI18nHelpers(locale());
  return createLocalizedFlowerSurfaceCopy({ locale: locale(), t: (key, params) => i18n.t(key as EnvAppTranslationKey, params),
   tn: (key, count, params) => i18n.tn(key as EnvAppTranslationKey, count, params) });
 };
 const host = document.createElement('div');
 host.style.cssText = 'position:fixed;inset:0;padding:24px;box-sizing:border-box;display:flex;align-items:flex-end;justify-content:flex-end;font-family:system-ui;background:var(--background);--flower-chat-surface:var(--background);--flower-chat-surface-border:var(--border);--flower-chat-surface-elevated:var(--card);--redeven-surface-shadow-source:#000';
 if (projected) {
  host.setAttribute('data-floe-dialog-surface-host', 'true');
  host.style.cssText += ';inset:auto;left:20px;top:20px;width:700px;height:600px;transform:scale(.8);transform-origin:top left';
 }
 document.body.append(host);
 dispose = render(() => <FlowerComposerContextIndicator copy={copy()} usage={usage()} placement={placement} />, host);
 return { host, copy, trigger: host.querySelector<HTMLElement>('[role="progressbar"]')!, panel: document.getElementById(host.querySelector<HTMLElement>('[role="progressbar"]')!.getAttribute('aria-controls')!)! };
}
it('owns Escape after opening with the mouse and returns focus', async () => {
 await page.viewport(820, 700);
 const { host, trigger, panel } = mount(() => 'en-US', () => fixture());
 const outside = document.createElement('button'); host.append(outside); outside.focus();
 let escaped = false;
 const onEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') escaped = true; };
 document.addEventListener('keydown', onEscape);
 try {
  await userEvent.click(trigger);
  await expect.poll(() => document.activeElement).toBe(panel);
  await userEvent.keyboard('{Escape}');
  expect(panel.getAttribute('aria-hidden')).toBe('true');
  expect(document.activeElement).toBe(trigger);
  expect(escaped).toBe(false);
 } finally { document.removeEventListener('keydown', onEscape); }
});

for (const projected of [false, true]) {
 it('keeps mouse interactions inside the popup open, projected=' + projected, async () => {
  await page.viewport(820, 700);
  const { host, trigger, panel } = mount(() => 'en-US', () => fixture(), projected);
  await userEvent.hover(trigger);
  await expect.poll(() => getComputedStyle(panel).opacity).toBe('1');
  await userEvent.click(panel.querySelector<HTMLElement>('.flower-context-total')!, { delay: 160 });
  expect(document.activeElement).toBe(panel);
  await new Promise(resolve => setTimeout(resolve, 200));
  expect(panel.dataset.open).toBe('true');
  const category = panel.querySelector<HTMLDetailsElement>('[data-category="mcp_tools"]')!;
  await userEvent.click(category.querySelector('summary')!);
  await expect.poll(() => category.open).toBe(true);
  await userEvent.hover(category.querySelector<HTMLElement>('.flower-model-context-row .flower-model-context-label')!);
  (document.activeElement as HTMLElement).blur();
  await new Promise(resolve => setTimeout(resolve, 200));
  expect(panel.dataset.open).toBe('true');
  await userEvent.click(category.querySelector<HTMLElement>('.flower-model-context-row .flower-model-context-label')!);
  await new Promise(resolve => setTimeout(resolve, 200));
  expect(panel.dataset.open).toBe('true');
  await userEvent.click(category.querySelector('summary')!);
  await expect.poll(() => category.open).toBe(false);
  const outside = document.createElement('button');
  outside.style.cssText = 'position:fixed;top:0;left:0;width:16px;height:16px';
  host.append(outside);
  await userEvent.click(outside);
  expect(panel.getAttribute('aria-hidden')).toBe('true');
  await userEvent.hover(trigger);
  await expect.poll(() => panel.dataset.open).toBe('true');
  category.querySelector<HTMLElement>('summary')!.focus();
  await userEvent.hover(panel.querySelector<HTMLElement>('.flower-context-total')!);
  outside.focus();
  await expect.poll(() => panel.getAttribute('aria-hidden')).toBe('true');
  outside.blur();
  await userEvent.hover(trigger);
  await expect.poll(() => panel.dataset.open).toBe('true');
  await userEvent.hover(panel.querySelector<HTMLElement>('.flower-context-total')!);
  await userEvent.hover(outside);
  await expect.poll(() => panel.getAttribute('aria-hidden')).toBe('true');
 });
}
for (const locale of ['en-US', 'zh-CN'] as const) for (const dark of [false, true]) {
 it('shows explicit sources, flat bars and stable keyboard interaction in ' + locale + ', dark=' + dark, async () => {
  await page.viewport(440, 720);
  theme(builtInShellThemePresets.find(preset => preset.name === 'classic-' + (dark ? 'dark' : 'light'))!);
  const [usage, setUsage] = createSignal(fixture());
  const { host, copy, trigger, panel } = mount(() => locale, usage);
  trigger.focus();
  await expect.poll(() => getComputedStyle(panel).opacity).toBe('1');
  expect(panel.getBoundingClientRect().width).toBeLessThanOrEqual(320);
  expect(panel.getBoundingClientRect().height).toBeLessThanOrEqual(420);
  expect(parseFloat(getComputedStyle(panel).fontSize)).toBeLessThanOrEqual(11);
  expect(panel.textContent).toContain(copy().chat.contextIndicator.sourceLabels.mcp_tools);
  expect(panel.textContent).toContain(copy().chat.contextIndicator.sourceLabels.system_tools);
  expect(panel.textContent).toContain(copy().chat.contextIndicator.sourceLabels.system_prompt);
  expect(panel.querySelector('pre')).toBeNull();
  expect(panel.querySelectorAll('.flower-context-heading')).toHaveLength(1);
  expect(panel.querySelector('.flower-context-budget-facts, .flower-context-shared-space, .flower-context-estimate')).toBeNull();
  const heading = panel.querySelector<HTMLElement>('.flower-context-heading')!;
  const closeButton = heading.querySelector<HTMLElement>('.flower-context-close')!;
  const total = heading.querySelector<HTMLElement>('.flower-context-total')!;
  expect(closeButton.getBoundingClientRect().right).toBeCloseTo(heading.getBoundingClientRect().right, 0);
  expect(total.getBoundingClientRect().right).toBeLessThan(closeButton.getBoundingClientRect().left);
  const rows = [...panel.querySelectorAll<HTMLElement>('.flower-context-composition-row')];
  expect(rows.length).toBe(9);
  for (const row of rows) {
   expect(row.querySelector('.flower-model-context-fill')).not.toBeNull();
   expect(row.scrollWidth).toBeLessThanOrEqual(row.clientWidth);
  }
  expect(new Set(rows.map(row => row.querySelector('.flower-model-context-amount')!.getBoundingClientRect().right)).size).toBe(1);
  expect(panel.scrollWidth).toBe(panel.clientWidth);
  expect(panel.getBoundingClientRect().top).toBeGreaterThanOrEqual(0);
  if (import.meta.env.VITE_FLOWER_CONTEXT_SCREENSHOTS === '1') await page.screenshot({ path: '__screenshots__/context-sources-' + locale + '-' + (dark ? 'dark' : 'light') + '.png' });
  const category = panel.querySelector<HTMLDetailsElement>('[data-category="mcp_tools"]')!;
  const summary = category.querySelector('summary')!;
  summary.focus(); await userEvent.keyboard('{Enter}');
  await expect.poll(() => category.open).toBe(true);
  expect(category.querySelectorAll('.flower-model-context-row')).toHaveLength(3);
  expect(category.textContent).toContain('docs · search');
  expect(category.querySelector('.flower-model-context-row details, .flower-model-context-row summary')).toBeNull();
  expect(category.querySelectorAll('.flower-model-context-row .flower-model-context-track')).toHaveLength(3);
  await expect.poll(() => panel.getBoundingClientRect().bottom).toBeLessThanOrEqual(712);
  if (import.meta.env.VITE_FLOWER_CONTEXT_SCREENSHOTS === '1') await page.screenshot({ path: '__screenshots__/context-sources-expanded-' + locale + '-' + (dark ? 'dark' : 'light') + '.png' });
  setUsage(fixture(6000));
  await expect.poll(() => document.activeElement).toBe(summary);
  expect(panel.dataset.open).toBe('true');
  expect(category.open).toBe(true);
  expect(panel.querySelector('[data-category="mcp_tools"] summary')).toBe(summary);
  await expect.poll(() => panel.getBoundingClientRect().bottom).toBeLessThanOrEqual(712);
  await userEvent.keyboard('{Escape}');
  expect(document.activeElement).toBe(trigger);
  expect(panel.getAttribute('aria-hidden')).toBe('true');
  await userEvent.keyboard('{Enter}');
  expect(panel.dataset.open).toBe('true');
  const outside = document.createElement('button'); outside.style.cssText = 'position:fixed;top:0;left:0;width:24px;height:24px'; host.append(outside);
  await userEvent.click(outside); expect(panel.getAttribute('aria-hidden')).toBe('true');
  setUsage(mapContextUsage({ confirmed: base, estimate: { ...base, phase: 'projected_request', input_tokens: 291336 } })!);
  trigger.focus(); expect(trigger.getAttribute('aria-valuenow')).toBe('11');
  expect(panel.querySelector('.flower-context-composition')).toBeNull();
 });
}
it('keeps all locales and themes within a narrow card', async () => {
 await page.viewport(320, 480);
 const [locale, setLocale] = createSignal<RedevenLocale>('en-US');
 theme(builtInShellThemePresets.find(preset => preset.name === 'classic-dark')!);
 const { trigger, panel } = mount(locale, () => fixture());
 trigger.focus(); await expect.poll(() => getComputedStyle(panel).opacity).toBe('1');
 const summary = panel.querySelector<HTMLElement>('[data-category="mcp_tools"] summary')!;
 summary.focus(); await userEvent.keyboard('{Enter}');
 for (const value of ['en-US', 'zh-CN', 'zh-TW', 'ja-JP', 'ko-KR', 'de-DE', 'fr-FR', 'es-ES', 'pt-BR', 'ru-RU'] as const) {
  setLocale(value);
  expect(panel.scrollWidth, value).toBe(panel.clientWidth);
  expect(panel.getBoundingClientRect().top, value).toBeGreaterThanOrEqual(0);
  expect(panel.getBoundingClientRect().height, value).toBeLessThanOrEqual(408);
  await expect.poll(() => panel.getBoundingClientRect().bottom, { message: value }).toBeLessThanOrEqual(472);
  for (const row of panel.querySelectorAll<HTMLElement>('.flower-context-composition-row, .flower-model-context-row')) expect(row.scrollWidth, value).toBeLessThanOrEqual(row.clientWidth);
 }
 for (const preset of builtInShellThemePresets) {
  theme(preset);
  for (const row of panel.querySelectorAll('.flower-context-composition-row, .flower-model-context-row')) {
   expect(getComputedStyle(row.querySelector('.flower-model-context-fill')!).backgroundColor, preset.name).toBe(getComputedStyle(row.querySelector('.flower-context-swatch')!).backgroundColor);
  }
 }
});

for (const placement of ['above-end', 'below-start'] as const) {
 it('keeps expanded content reachable after viewport resize with ' + placement + ' placement', async () => {
  await page.viewport(440, 720);
  theme(builtInShellThemePresets.find(preset => preset.name === 'classic-dark')!);
  const { host, trigger, panel } = mount(() => 'zh-CN', () => fixture(), false, placement);
  if (placement === 'below-start') { host.style.alignItems = 'flex-start'; host.style.justifyContent = 'flex-start'; }
  trigger.focus();
  await expect.poll(() => getComputedStyle(panel).opacity).toBe('1');
  const summary = panel.querySelector<HTMLElement>('[data-category="mcp_tools"] summary')!;
  summary.focus(); await userEvent.keyboard('{Enter}');
  await page.viewport(320, 480);
  await expect.poll(() => panel.getBoundingClientRect().bottom).toBeLessThanOrEqual(472);
  expect(panel.getBoundingClientRect().top).toBeGreaterThanOrEqual(8);
  expect(panel.getBoundingClientRect().left).toBeGreaterThanOrEqual(8);
  expect(panel.getBoundingClientRect().right).toBeLessThanOrEqual(312);
  expect(document.activeElement).toBe(summary);
  panel.scrollTop = panel.scrollHeight;
  const footer = panel.querySelector<HTMLElement>('.flower-context-cache-stats')!;
  await expect.poll(() => footer.getBoundingClientRect().bottom).toBeLessThanOrEqual(panel.getBoundingClientRect().bottom);
  expect(footer.getBoundingClientRect().top).toBeGreaterThan(panel.getBoundingClientRect().top);
  if (import.meta.env.VITE_FLOWER_CONTEXT_SCREENSHOTS === '1') await page.screenshot({ path: '__screenshots__/context-narrow-' + placement + '.png' });
  await userEvent.keyboard('{Escape}');
  expect(panel.getAttribute('aria-hidden')).toBe('true');
  expect(document.activeElement).toBe(trigger);
 });
}

it('recovers focus when attribution disappears during a live update', async () => {
 await page.viewport(320,480);
 const [usage,setUsage] = createSignal(fixture());
 const {trigger,panel,copy} = mount(() => 'zh-CN',usage); trigger.focus();
 const summary = panel.querySelector<HTMLElement>('[data-category="mcp_tools"] summary')!;
 summary.focus(); await userEvent.keyboard('{Enter}');
 setUsage({confirmed:base});
 await expect.poll(() => document.activeElement).toBe(trigger);
 expect(panel.textContent).toContain(copy().chat.contextIndicator.distributionUnavailable);
 expect(panel.querySelector('.flower-context-total')?.textContent).toContain('= 110k');
 await userEvent.keyboard('{Escape}');
 expect(panel.getAttribute('aria-hidden')).toBe('true');
});

it('uses shared projected placement and restores focus after touch and keyboard close', async()=>{
 await page.viewport(820,700);
 const {host,trigger,panel}=mount(()=> 'en-US',()=>fixture(),true);
 trigger.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'touch'}));
 trigger.click();
 await expect.poll(()=>getComputedStyle(panel).opacity).toBe('1');
 const layer=panel.closest('[data-floe-local-interaction-surface="true"]');
 expect(layer).toBeTruthy();expect(host.contains(layer)).toBe(true);
 expect(panel.style.position).not.toBe('fixed');expect(panel.style.left).toBe('');expect(panel.style.top).toBe('');
 expect(panel.getBoundingClientRect().left).toBeGreaterThanOrEqual(0);
 expect(panel.getBoundingClientRect().right).toBeLessThanOrEqual(820);
 const summary = panel.querySelector<HTMLElement>('[data-category="mcp_tools"] summary')!;
 summary.focus(); await userEvent.keyboard('{Enter}');
 await expect.poll(() => panel.getBoundingClientRect().bottom).toBeLessThanOrEqual(host.getBoundingClientRect().bottom);
 expect(panel.getBoundingClientRect().top).toBeGreaterThanOrEqual(host.getBoundingClientRect().top);
 panel.querySelector<HTMLButtonElement>('.flower-context-close')!.click();
 expect(panel.getAttribute('aria-hidden')).toBe('true');expect(document.activeElement).toBe(trigger);
 await userEvent.keyboard('{Enter}');
 expect(panel.dataset.open).toBe('true');
 await userEvent.keyboard('{Escape}');
 expect(panel.getAttribute('aria-hidden')).toBe('true');expect(document.activeElement).toBe(trigger);
});

it('keeps zero input and close reachable at high zoom after a disclosure becomes flat', async () => {
 await page.viewport(440,720);
 const [usage,setUsage]=createSignal(fixture());
 const {host,trigger,panel}=mount(()=> 'en-US',usage);
 host.style.zoom='2';
 trigger.focus();
 const summary=panel.querySelector<HTMLElement>('[data-category="environment"] summary')!;
 summary.focus();await userEvent.keyboard('{Enter}');
 const next=fixture();
 next.confirmed!.characters!.categories=next.confirmed!.characters!.categories.filter(item=>item.category!=='model_context');
 next.confirmed!.characters!.categories.push({category:'model_context',characters:250,details:[{key:'execution_environment',characters:250}]});
 next.confirmed!.characters!.total_characters=next.confirmed!.characters!.categories.reduce((sum,item)=>sum+item.characters,0);
 setUsage(next);
 await expect.poll(()=>document.activeElement).toBe(trigger);
 setUsage({confirmed:{...base,input_tokens:0,context_window_tokens:undefined,characters_available:true,characters:{source:'prepared_characters_v1',unit:'unicode_code_points',total_characters:0,categories:[]}}});
 expect(panel.querySelector('.flower-context-total')?.textContent).toContain('= 0');
 expect(panel.querySelector('.flower-context-composition-heading')?.textContent).toContain('0 chars');
 const close=panel.querySelector<HTMLButtonElement>('.flower-context-close')!;
 close.focus();await userEvent.keyboard('{Enter}');
 expect(panel.getAttribute('aria-hidden')).toBe('true');expect(document.activeElement).toBe(trigger);
});

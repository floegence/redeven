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
const base = { phase: 'provider_usage', pressure_status: 'stable', input_tokens: 95400, context_window_tokens: 1000000, output_headroom_tokens: 33000, updated_at_ms: 1 } as const;
function fixture(mcpTokens = 48700): FlowerContextUsage {
 return { confirmed: { ...base, breakdown: { source: 'rendered_deepseek_v4_content_v3', quality: 'token_estimate', tokenizer: 'deepseek_v4', system_tokens: 3700,
  tool_definition_tokens: mcpTokens + 30700, user_tokens: 4200, assistant_tokens: 3000, tool_call_tokens: 1700,
  tool_result_tokens: 2000, framing_tokens: 240, model_context_tokens: 6200, details: { items: [
   { category: 'tool_definition', key: 'search', source: 'mcp', namespace: 'docs', tokens: mcpTokens - 4000 },
   { category: 'tool_definition', key: 'read', source: 'mcp', namespace: 'docs', tokens: 2000 },
   { category: 'tool_definition', key: 'query', source: 'mcp', namespace: 'database', tokens: 2000 },
   { category: 'tool_definition', key: 'terminal.exec', source: 'builtin', tokens: 20700 },
   { category: 'tool_definition', key: 'files.read', source: 'builtin', tokens: 10000 },
   { category: 'model_context', key: 'skills', tokens: 5100 },
   { category: 'model_context', key: 'repository_rules', tokens: 500 },
   { category: 'model_context', key: 'execution_environment', tokens: 250 },
   { category: 'model_context', key: 'local_time', tokens: 100 },
   { category: 'model_context', key: 'repository', tokens: 100 },
   { category: 'model_context', key: 'delegation', tokens: 50 },
   { category: 'model_context', key: '', tokens: 100 },
  ] } } },
  thread_usage: { input_tokens: 55, output_tokens: 10, cache_read_tokens: 45, cache_write_tokens: 0 },
  recent_request_usage: { input_tokens: 25, output_tokens: 10, cache_read_tokens: 75, cache_write_tokens: 0 },
 };
}
function theme(preset: typeof builtInShellThemePresets[number]) {
 document.documentElement.classList.toggle('dark', preset.mode === 'dark');
 for (const [name, value] of Object.entries(preset.semanticTokens ?? {})) if (value) document.documentElement.style.setProperty(name, value);
}
function mount(locale: () => RedevenLocale, usage: () => FlowerContextUsage, projected = false) {
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
 dispose = render(() => <FlowerComposerContextIndicator copy={copy()} usage={usage()} />, host);
 return { host, copy, trigger: host.querySelector<HTMLElement>('[role="progressbar"]')!, panel: document.getElementById(host.querySelector<HTMLElement>('[role="progressbar"]')!.getAttribute('aria-controls')!)! };
}
for (const locale of ['en-US', 'zh-CN'] as const) for (const dark of [false, true]) {
 it('shows explicit sources, flat bars and stable keyboard interaction in ' + locale + ', dark=' + dark, async () => {
  await page.viewport(440, 720);
  theme(builtInShellThemePresets.find(preset => preset.name === 'classic-' + (dark ? 'dark' : 'light'))!);
  const [usage, setUsage] = createSignal(fixture());
  const { host, copy, trigger, panel } = mount(() => locale, usage);
  trigger.focus();
  await expect.poll(() => getComputedStyle(panel).opacity).toBe('1');
  expect(panel.textContent).toContain(copy().chat.contextIndicator.sourceLabels.mcp_tools);
  expect(panel.textContent).toContain(copy().chat.contextIndicator.sourceLabels.system_tools);
  expect(panel.textContent).toContain(copy().chat.contextIndicator.sourceLabels.system_prompt);
  expect(panel.querySelector('pre')).toBeNull();
  const rows = [...panel.querySelectorAll<HTMLElement>('.flower-context-composition-row')];
  expect(rows.length).toBe(10);
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
  if (import.meta.env.VITE_FLOWER_CONTEXT_SCREENSHOTS === '1') await page.screenshot({ path: '__screenshots__/context-sources-expanded-' + locale + '-' + (dark ? 'dark' : 'light') + '.png' });
  setUsage(fixture(6000));
  await expect.poll(() => document.activeElement).toBe(summary);
  expect(panel.dataset.open).toBe('true');
  expect(category.open).toBe(true);
  expect(panel.querySelector('[data-category="mcp_tools"] summary')).toBe(summary);
  await userEvent.keyboard('{Escape}');
  expect(document.activeElement).toBe(trigger);
  expect(panel.getAttribute('aria-hidden')).toBe('true');
  await userEvent.keyboard('{Enter}');
  expect(panel.dataset.open).toBe('true');
  const outside = document.createElement('button'); outside.style.cssText = 'position:fixed;top:0;left:0;width:24px;height:24px'; host.append(outside);
  await userEvent.click(outside); expect(panel.getAttribute('aria-hidden')).toBe('true');
  setUsage(mapContextUsage({ confirmed: base, estimate: { ...base, phase: 'projected_request', input_tokens: 291336 } })!);
  trigger.focus(); expect(trigger.getAttribute('aria-valuenow')).toBe('10');
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
  for (const row of panel.querySelectorAll<HTMLElement>('.flower-context-composition-row, .flower-model-context-row')) expect(row.scrollWidth, value).toBeLessThanOrEqual(row.clientWidth);
 }
 for (const preset of builtInShellThemePresets) {
  theme(preset);
  for (const row of panel.querySelectorAll('.flower-context-composition-row, .flower-model-context-row')) {
   expect(getComputedStyle(row.querySelector('.flower-model-context-fill')!).backgroundColor, preset.name).toBe(getComputedStyle(row.querySelector('.flower-context-swatch')!).backgroundColor);
  }
 }
});

for (const mode of ['relative', 'historical', 'media'] as const) {
 it('presents share-only '+mode+' data without leaking token amounts', async () => {
  await page.viewport(320,480);
  theme(builtInShellThemePresets.find(preset => preset.name === 'classic-dark')!);
  const value=fixture(); const {quality: _quality,tokenizer: _tokenizer,...historical}=value.confirmed!.breakdown!;
  const breakdown=mode==='historical'?historical:{...historical,quality:'relative_weight' as const,...(mode==='media'?{attachment_tokens:100}:{})};
  const [usage,setUsage]=createSignal<FlowerContextUsage>({...value,confirmed:{...value.confirmed!,breakdown}});
  const {trigger,panel,copy}=mount(()=>'zh-CN',usage);trigger.focus();
  await expect.poll(()=>getComputedStyle(panel).opacity).toBe('1');
  const distribution=panel.querySelector('.flower-context-composition')!;
  const summary=distribution.querySelector<HTMLElement>('[data-category="mcp_tools"] summary')!;
  summary.focus();await userEvent.keyboard('{Enter}');
  expect(distribution.querySelector('.flower-model-context-amount')).toBeNull();
  expect(distribution.textContent).not.toContain('≈');
  for(const row of distribution.querySelectorAll('[title],[aria-label]')){
   expect(row.getAttribute('title')??'').not.toContain('48700');
   expect(row.getAttribute('aria-label')??'').not.toContain('48700');
  }
  expect(panel.scrollWidth).toBe(panel.clientWidth);
  setUsage({confirmed:base});
  await expect.poll(()=>panel.textContent).toContain(copy().chat.contextIndicator.distributionUnavailable);
  await userEvent.keyboard('{Escape}');expect(document.activeElement).toBe(trigger);
 });
}

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
 panel.querySelector<HTMLButtonElement>('.flower-context-close')!.click();
 expect(panel.getAttribute('aria-hidden')).toBe('true');expect(document.activeElement).toBe(trigger);
 await userEvent.keyboard('{Enter}');
 expect(panel.dataset.open).toBe('true');
 await userEvent.keyboard('{Escape}');
 expect(panel.getAttribute('aria-hidden')).toBe('true');expect(document.activeElement).toBe(trigger);
});

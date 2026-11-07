import '../../index.css';
import { FloeConfigProvider, ThemeProvider, builtInShellThemePresets, useTheme } from '@floegence/floe-webapp-core';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, expect, it } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import axe from 'axe-core';
import { I18nProvider, useI18n } from '../i18n';
import { SUPPORTED_LOCALES } from '../i18n/localeMeta';
import { EnvAppDrawer } from '../primitives/EnvAppDrawer';
import { ServiceTemplateCatalog, type ServiceTemplatePresentation } from './ServiceTemplateCatalog';
import { ManagedReleaseCandidates } from './EnvPortForwardsPage';

const templates: ServiceTemplatePresentation[] = [
  { id: 'host', name: 'Example Studio', description: 'A development workspace for your projects.', source: 'builtin', kind: 'host', deploymentLabel: 'Host', defaultReleaseLabel: '2.4.0', revision: 4, defaultAccessMode: 'desktop_loopback', diskBytes: 2147483648, defaultWorkspacePath: '/Users/demo/Projects/studio', dataLocation: '/Users/demo/.redeven/services/studio', developerPreview: false, available: true, installed: false, duplicateable: true, editable: false, runtimeSpec: { schema_version: 6, kind: 'host', endpoint: { scheme: 'http', path: '/', health_path: '/health', startup_timeout_sec: 60 }, host: { npm: { package_name: '@example/studio', version: '2.4.0', registry_url: 'https://registry.npmjs.org/', executable: 'studio' }, start_script: 'exec studio --port "$REDEVEN_SERVICE_PORT"' } } },
  { id: 'custom', name: 'Workspace dashboard', description: 'Project metrics and build results.', source: 'custom', kind: 'host', deploymentLabel: 'Host', revision: 1, defaultReleaseLabel: '1.1.0', developerPreview: false, available: true, installed: true, duplicateable: true, editable: true },
  { id: 'container', name: 'Example Desktop', description: 'A browser desktop for the current Environment.', source: 'builtin', kind: 'container', deploymentLabel: 'Container', defaultReleaseLabel: '2.4.0', revision: 3, developerPreview: false, available: true, installed: false, duplicateable: true, editable: false },
];
templates[0] = {...templates[0], developerPreview: true, hostLifecyclePlan: {
  schema_version: 1, driver: 'npm_host', runtime_bundle: 'node-24.19.0',
  install: {ownership: 'redeven', steps: [{kind: 'prepare_verified_node_runtime', reference: 'node-24.19.0'}, {kind: 'install_npm_package_without_scripts', command_template: '<managed-node> <managed-npm-cli> install @example/studio@2.4.0 --package-lock=false --ignore-scripts'}, {kind: 'remove_temporary_registry_credentials'}, {kind: 'run_npm_lifecycle_scripts'}, {kind: 'verify_npm_release_identity'}]},
  start: {ownership: 'template', steps: [{kind: 'run_template_script', command_template: 'exec studio --port "$REDEVEN_SERVICE_PORT"'}]},
  stop: {ownership: 'redeven', steps: [{kind: 'terminate_managed_process_group'}]},
  uninstall: {ownership: 'redeven', steps: [{kind: 'remove_managed_installation'}, {kind: 'remove_managed_logs'}, {kind: 'remove_managed_data_on_request'}]},
}};
type ReleaseResult = NonNullable<Parameters<typeof ManagedReleaseCandidates>[0]['result']>;
const releases: ReleaseResult = {
  schema_version: 2, check_status: 'fresh', catalog_status: 'complete', has_more: false, loaded_count: 18, checked_at_unix_ms: Date.UTC(2026, 10, 3, 12),
  candidates: Array.from({ length: 18 }, (_, index) => ({ schema_version: 2, candidate_id: String(index), source_kind: 'npm', source: '@example/studio', registry: 'https://registry.npmjs.org/', version: index === 0 ? '2.5.0-preview.2' : '2.4.' + (18 - index), channel: index === 0 ? 'preview' : 'stable', trust: 'registry_verified', selectable: true, platform: 'darwin-arm64', integrity: 'sha512-' + 'Ab12cd34'.repeat(12), relation: 'newer', verification_status: 'verified', is_latest_preview: index === 0, is_recommended: index === 1, recommendation_status: index === 1 ? 'available' : undefined, published_at_unix_ms: Date.UTC(2026, 10, 2) })),
};
let dispose: (() => void) | undefined;
const preferences = new Map<string, string>();
const rootAttributes = Array.from(document.documentElement.attributes, a => [a.name, a.value] as const);
let localeValue: () => string;
function LocaleProbe() { localeValue = useI18n().locale; return null; }
const settle = async () => { await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))); };
afterEach(async () => {
  dispose?.(); document.body.replaceChildren(); localStorage.clear();
  for (const [key, value] of preferences) localStorage.setItem(key, value);
  for (const a of Array.from(document.documentElement.attributes)) document.documentElement.removeAttribute(a.name);
  for (const [name, value] of rootAttributes) document.documentElement.setAttribute(name, value);
  await (commands as unknown as { emulateMediaPreferences: (value: { reducedMotion: string }) => Promise<void> }).emulateMediaPreferences({ reducedMotion: 'no-preference' });
});
async function mount(view: 'templates' | 'versions', width: number, preset: string, locale = 'zh-CN') {
  preferences.clear(); for (const key of Object.keys(localStorage)) preferences.set(key, localStorage.getItem(key)!);
  localStorage.setItem('redeven_ui_language_preference', locale);
  await page.viewport(width, width < 600 ? 840 : 900);
  const host = document.createElement('div'); host.style.cssText = 'width:100%;height:100vh;background:var(--background)'; document.body.append(host);
  function Surface() {
    const theme = useTheme(); theme.selectShellTheme(preset.endsWith('dark') ? 'dark' : 'light', preset);
    const [category, setCategory] = createSignal<'host' | 'container'>('host');
    const [query, setQuery] = createSignal('');
    const [selected, setSelected] = createSignal('1');
    const [filter, setFilter] = createSignal<'all' | 'stable' | 'preview'>('all');
    const [loading, setLoading] = createSignal(false);
    return <I18nProvider><LocaleProbe /><EnvAppDrawer open onOpenChange={() => undefined} title={view === 'templates' ? 'Service templates' : 'Example Studio'} class={view === 'templates' ? 'service-template-explorer-drawer' : 'managed-service-version-drawer'} bodyClass="h-full min-h-0">
      {view === 'templates' ? <div class="service-template-drawer-shell h-full min-h-0 p-1" data-view="catalog"><ServiceTemplateCatalog category={category()} query={query()} hostCount={2} containerCount={1} templates={templates.filter(t => t.kind === category() && t.name.toLowerCase().includes(query().toLowerCase()))} loading={false} canManage onCategoryChange={setCategory} onQueryChange={setQuery} onCreate={() => undefined} onImport={() => undefined} onDeploy={() => undefined} onOpen={() => undefined} onDuplicate={() => undefined} onEdit={() => undefined} onDelete={() => undefined} /></div> : <div class="h-full min-h-0 p-1"><ManagedReleaseCandidates result={releases} loading={loading()} error="" query={query()} filter={filter()} selectedID={selected()} onQueryChange={setQuery} onFilterChange={setFilter} onSelect={setSelected} showRiskHints /></div>}
      <button hidden data-testid="refresh-fixture" onClick={() => setLoading(v => !v)} />
    </EnvAppDrawer></I18nProvider>;
  }
  dispose = render(() => <FloeConfigProvider config={{ theme: { shellPresets: builtInShellThemePresets }, storage: { enabled: false } }}><ThemeProvider><Surface /></ThemeProvider></FloeConfigProvider>, host);
  await expect.poll(() => localeValue?.()).toBe(locale); await document.fonts.ready; await settle();
  const panel = document.querySelector<HTMLElement>('[data-floe-dialog-panel]')!;
  await Promise.allSettled(panel.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity).map(animation => animation.finished));
  return panel;
}
function contrast(element: HTMLElement) {
  const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d')!;
  const ancestors: HTMLElement[] = []; for (let node: HTMLElement | null = element; node; node = node.parentElement) ancestors.unshift(node);
  ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 1, 1);
  for (const node of ancestors) { ctx.fillStyle = getComputedStyle(node).backgroundColor; ctx.fillRect(0, 0, 1, 1); }
  const luminance = (rgba: Uint8ClampedArray) => Array.from(rgba).slice(0, 3).reduce((total, c, i) => total + [0.2126, 0.7152, 0.0722][i] * ((c / 255) <= .04045 ? c / 255 / 12.92 : ((c / 255 + .055) / 1.055) ** 2.4), 0);
  const background = luminance(ctx.getImageData(0, 0, 1, 1).data);
  ctx.fillStyle = getComputedStyle(element).color; ctx.fillRect(0, 0, 1, 1);
  const foreground = luminance(ctx.getImageData(0, 0, 1, 1).data);
  return (Math.max(background, foreground) + .05) / (Math.min(background, foreground) + .05);
}
for (const view of ['templates', 'versions'] as const) for (const preset of ['porcelain-light', 'porcelain-dark', 'classic-light', 'classic-dark']) for (const width of [1440, 390]) {
  it('keeps ' + view + ' readable and operable in ' + preset + ' at ' + width, async () => {
    const panel = await mount(view, width, preset, width === 390 ? 'de-DE' : 'zh-CN');
    expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth + 1);
    expect(panel.getBoundingClientRect().right).toBeLessThanOrEqual(width);
    if (view === 'templates') {
      const tabs = Array.from(panel.querySelectorAll<HTMLElement>('[role=tab]'));
      for (const tab of tabs) expect(contrast(tab)).toBeGreaterThanOrEqual(4.5);
      tabs[0].focus(); await userEvent.keyboard('{ArrowRight}');
      await expect.poll(() => panel.querySelector('[data-testid=service-template-details]')?.getAttribute('data-template-id')).toBe('container');
      expect(document.activeElement).toBe(tabs[1]);
      await userEvent.keyboard('{ArrowLeft}');
      await expect.poll(() => panel.querySelector('[data-testid=service-template-details]')?.getAttribute('data-template-id')).toBe('host');
      expect(panel.querySelector('[role=tabpanel]')?.getAttribute('aria-labelledby')).toBe(tabs[0].id);
      const detail = panel.querySelector<HTMLElement>('[data-testid=service-template-details]')!;
      const technical = detail.querySelector<HTMLDetailsElement>('[data-testid=host-template-technical]')!;
      const lifecycle = technical.querySelector<HTMLElement>('[data-testid=host-lifecycle-plan]')!;
      const overview = detail.querySelector<HTMLElement>('[data-testid=host-template-overview]')!;
      expect(overview.querySelectorAll('.service-template-detail-field')).toHaveLength(3);
      expect(technical.open).toBe(false);
      expect(lifecycle.checkVisibility()).toBe(false);
      expect(detail.innerText).not.toContain('node-24.19.0');
      expect(detail.innerText).not.toContain('/Users/demo/Projects');
      expect(detail.querySelector('.service-template-details__status')).toBeNull();
      const actions = detail.querySelector<HTMLElement>('.service-template-details__actions')!;
      const footerTop = actions.getBoundingClientRect().top;
      const deploy = actions.querySelector<HTMLElement>('[data-testid=service-template-primary]')!;
      const secondary = actions.querySelector<HTMLElement>('.service-template-actions__secondary')!;
      for (const action of actions.querySelectorAll<HTMLElement>('button, [data-testid=service-template-more]')) {
        expect(action.getBoundingClientRect().height).toBe(width < 600 ? 44 : 36);
      }
      if (width < 600) {
        expect(getComputedStyle(actions).display).toBe('grid');
        expect(deploy.getBoundingClientRect().top).toBeGreaterThanOrEqual(secondary.getBoundingClientRect().bottom);
        expect(deploy.getBoundingClientRect().width).toBe(actions.getBoundingClientRect().width);
        expect(Math.abs(secondary.children[0].getBoundingClientRect().top - secondary.lastElementChild!.getBoundingClientRect().top)).toBeLessThan(1);
      } else {
        expect(deploy.getBoundingClientRect().width).toBeLessThanOrEqual(160);
        expect(deploy.getBoundingClientRect().right).toBe(actions.getBoundingClientRect().right);
      }
      if (width === 1440) {
        const body = detail.querySelector<HTMLElement>('.service-template-details__body')!;
        expect(body.scrollHeight).toBeLessThanOrEqual(body.clientHeight + 1);
      }
      if (width < 600) { overview.scrollIntoView({block: 'center'}); await settle(); }
      await page.screenshot({path: '../../../dist/compact-host-template/overview-' + preset + '-' + width + '.png'});
      technical.querySelector('summary')!.focus();
      await userEvent.keyboard('{Enter}');
      expect(technical.open).toBe(true);
      expect(lifecycle.checkVisibility()).toBe(true);
      expect(technical.innerText).toContain('node-24.19.0');
      expect(technical.innerText).toContain('--ignore-scripts');
      expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth + 1);
      if (width === 1440) expect(actions.getBoundingClientRect().top).toBe(footerTop);
      const expandedAudit = await axe.run(panel);
      expect(expandedAudit.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => v.id)).toEqual([]);
      technical.querySelector('summary')!.focus();
      await userEvent.keyboard('{Enter}');
      expect(technical.open).toBe(false);
    } else {
      const viewport = panel.querySelector<HTMLElement>('[data-testid=managed-release-candidate-scroll]')!;
      const status = panel.querySelector<HTMLElement>('[role=status]')!;
      const bounds = status.getBoundingClientRect();
      viewport.scrollTop = 80; const before = viewport.scrollTop;
      panel.querySelector<HTMLButtonElement>('[data-testid=refresh-fixture]')!.click(); await settle();
      expect(viewport.scrollTop).toBe(before); expect(status.getBoundingClientRect().top).toBe(bounds.top);
      panel.querySelector<HTMLButtonElement>('[data-testid=refresh-fixture]')!.click();
      const option = panel.querySelector<HTMLElement>('[data-release-id="1"]')!;
      option.focus(); await userEvent.keyboard('{Home}');
      expect(panel.querySelector('[data-release-id="0"]')?.getAttribute('aria-checked')).toBe('true');
      expect(panel.querySelectorAll('.managed-release-plan-heading')).toHaveLength(1);
      expect(panel.querySelector('.managed-release-provenance')?.textContent).toContain('@example/studio');
      expect(contrast(panel.querySelector<HTMLElement>('.managed-release-version-label')!)).toBeGreaterThanOrEqual(4.5);
      const details = panel.querySelector<HTMLDetailsElement>('.managed-release-artifact-details')!;
      details.querySelector('summary')!.focus(); await userEvent.keyboard('{Enter}'); expect(details.open).toBe(true);
      expect(details.textContent).toContain('sha512-');
      expect(status.getBoundingClientRect().top).toBe(bounds.top);
      details.open = false;
      panel.querySelector<HTMLElement>('[data-release-id="1"]')!.click(); await settle();
    }
    const audit = await axe.run(panel);
    expect(audit.violations.filter(v => v.impact === 'serious' || v.impact === 'critical').map(v => ({ id: v.id, targets: v.nodes.map(n => n.target) }))).toEqual([]);
    (document.activeElement as HTMLElement)?.blur();
    await settle();
    await page.screenshot({ path: '../../../dist/service-catalog-design/' + view + '-' + preset + '-' + width + '.png' });
  });
}
for (const locale of SUPPORTED_LOCALES) it('keeps host template decisions readable at 320px in ' + locale, async () => {
  const panel = await mount('templates', 320, 'porcelain-dark', locale);
  const detail = panel.querySelector<HTMLElement>('[data-testid=service-template-details]')!;
  const technical = detail.querySelector<HTMLDetailsElement>('[data-testid=host-template-technical]')!;
  expect(technical.open).toBe(false);
  expect(detail.innerText).not.toContain('npm_host');
  expect(detail.querySelector<HTMLElement>('[data-testid=host-template-overview]')!.scrollWidth).toBeLessThanOrEqual(detail.clientWidth);
  const submit = detail.querySelector<HTMLButtonElement>('[data-testid=service-template-primary]')!;
  submit.scrollIntoView({block: 'center'});
  await settle();
  expect(submit.disabled).toBe(false);
  expect(submit.getBoundingClientRect().right).toBeLessThanOrEqual(320);
  expect(submit.getBoundingClientRect().bottom).toBeLessThanOrEqual(840);
  technical.querySelector('summary')!.focus();
  await userEvent.keyboard('{Enter}');
  expect(technical.open).toBe(true);
  await userEvent.click(page.elementLocator(panel.querySelector<HTMLElement>('[data-testid=service-template-row][data-template-id=custom]')!));
  const installed = panel.querySelector<HTMLElement>('[data-testid=service-template-details]')!;
  expect(installed.getAttribute('data-template-id')).toBe('custom');
  expect(installed.querySelector<HTMLDetailsElement>('[data-testid=host-template-technical]')!.open).toBe(false);
  expect(installed.querySelector('.service-template-details__status')).toBeTruthy();
  expect(installed.querySelector<HTMLButtonElement>('[data-testid=service-template-primary]')!.disabled).toBe(true);
  expect(panel.scrollWidth).toBeLessThanOrEqual(panel.clientWidth + 1);
});
it('keeps release selection motion quiet and removes it for reduced motion', async () => {
  await mount('versions', 1200, 'porcelain-light', 'en-US');
  document.querySelector<HTMLElement>('[data-release-id="0"]')!.click();
  const heading = document.querySelector<HTMLElement>('.managed-release-plan-heading')!;
  expect(heading.getAnimations().length).toBeGreaterThan(0);
  await Promise.allSettled(heading.getAnimations().map(animation => animation.finished));
  const top = heading.getBoundingClientRect().top;
  await (commands as unknown as { emulateMediaPreferences: (value: { reducedMotion: string }) => Promise<void> }).emulateMediaPreferences({ reducedMotion: 'reduce' });
  document.querySelector<HTMLElement>('[data-release-id="1"]')!.click(); await settle();
  expect(document.querySelector<HTMLElement>('.managed-release-plan-heading')!.getAnimations()).toHaveLength(0);
  expect(document.querySelector<HTMLElement>('.managed-release-plan-heading')!.getBoundingClientRect().top).toBe(top);
});

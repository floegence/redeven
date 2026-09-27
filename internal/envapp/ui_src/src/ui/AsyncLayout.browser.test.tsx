import '../index.css';
import { expectSingleLineButtonLabels } from '../test/buttonLayoutAssertions';
import { I18nProvider } from './i18n';
import { REDEVEN_LANGUAGE_PREFERENCE_STORAGE_KEY } from './i18n/storageKey';
import './flower-feature.css';
import { createSignal, type ComponentProps } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { ManagedServiceRow, PortForwardRow } from './pages/EnvPortForwardsPage';
import { modelCatalogCopy } from '../../../../flower_ui/src/settings/modelCatalogCopy';
import { ModelCatalogControls } from '../../../../flower_ui/src/settings/ModelCatalogControls';
import { FlowerAutoSaveIndicator, FlowerSubSectionHeader } from '../../../../flower_ui/src/settings/FlowerSettingsPrimitives';
import { GitPagedTableFooter } from './widgets/GitWorkbenchPrimitives';
import { CopyButton } from './pages/settings/SettingsPrimitives';
import { FilePreviewErrorState } from './widgets/FilePreviewErrorState';

let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); vi.restoreAllMocks(); document.body.replaceChildren(); localStorage.removeItem(REDEVEN_LANGUAGE_PREFERENCE_STORAGE_KEY); });
const settle = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
const rect = (element: Element) => { const { x, y, width, height } = element.getBoundingClientRect(); return { x, y, width, height }; };
const forward = { forward_id: 'stable', name: 'Dashboard', target_url: 'http://localhost:3001', description: '', health_path: '/', insecure_skip_verify: false, created_at_unix_ms: 1, updated_at_unix_ms: 1, last_opened_at_unix_ms: 1, health: { status: 'healthy' as const, last_checked_at_unix_ms: 1, latency_ms: 10, last_error: '' } };

it.each(['en-US', 'zh-CN', 'zh-TW', 'ja-JP', 'ko-KR', 'de-DE', 'fr-FR', 'es-ES', 'pt-BR', 'ru-RU'].flatMap(locale => [1280, 600, 320].map(width => ({ locale, width }))))('preserves single-line web service actions at $width px in $locale', async ({ width, locale }) => {
  localStorage.setItem(REDEVEN_LANGUAGE_PREFERENCE_STORAGE_KEY, locale);
  await page.viewport(width, 1000);
  const host = document.createElement('div'); host.className = 'web-services'; document.body.append(host);
  const [busy, setBusy] = createSignal(false);
  dispose = render(() => <I18nProvider><div class="web-service-list"><PortForwardRow forward={forward} busy={busy()} onOpen={() => {}} onEdit={() => {}} onDelete={() => {}} /><PortForwardRow forward={{ ...forward, forward_id: 'neighbor' }} busy={false} onOpen={() => {}} onEdit={() => {}} onDelete={() => {}} /></div></I18nProvider>, host);
  await vi.waitFor(() => expect(host.querySelectorAll('.web-service-row')).toHaveLength(2));
  await document.fonts.ready; await settle();
  const geometry = () => [...host.querySelectorAll('.web-service-open button, .web-service-identity, .web-service-row')].map(rect);
  const idle = geometry();
  for (const pending of [true, false]) {
    setBusy(pending); await settle(); expect(geometry()).toEqual(idle);
    expectSingleLineButtonLabels(host);
    expect(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth);
    for (const button of host.querySelectorAll('button')) {
      expect(button.getBoundingClientRect().right).toBeLessThanOrEqual(host.getBoundingClientRect().right);
      expect(button.scrollWidth).toBeLessThanOrEqual(button.clientWidth);
    }
  }
});

it('keeps copy feedback and its neighboring value still through the success timeout', async () => {
  vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  const host = document.createElement('div'); document.body.append(host);
  dispose = render(() => <div class="flex items-center gap-2"><CopyButton value="environment-123" label="Copy environment ID" /><code>environment-123</code></div>, host);
  await settle(); const geometry = () => [...host.querySelectorAll('button, code')].map(rect);
  const idle = geometry();
  await userEvent.click(host.querySelector('button')!); await settle();
  expect(navigator.clipboard.writeText).toHaveBeenCalledWith('environment-123');
  expect(geometry()).toEqual(idle);
  await vi.waitFor(() => expect(host.querySelector('button')?.textContent?.endsWith('Copy environment ID')).toBe(true), { timeout: 3000 });
  expect(geometry()).toEqual(idle);
});

it('keeps file error actions still when copying diagnostic details', async () => {
  vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
  const host = document.createElement('div'); host.style.height = '400px'; document.body.append(host);
  dispose = render(() => <FilePreviewErrorState errorType="connection_error" message="Request failed" onRetry={() => {}} />, host);
  await settle(); const geometry = () => [...host.querySelectorAll('button')].map(rect);
  const idle = geometry(); await userEvent.click(host.querySelector('button')!); await settle();
  expect(geometry()).toEqual(idle);
});

it('preserves footer and auto-save geometry while loading and after feedback disappears', async () => {
  await page.viewport(600, 1000);
  const host = document.createElement('div'); document.body.append(host);
  const [busy, setBusy] = createSignal(false);
  dispose = render(() => <><div data-footer><GitPagedTableFooter summary="10 changes" loading={busy()} hasMore onLoadMore={() => {}} /></div><div data-save><FlowerSubSectionHeader title="Default permissions" description="Approval behavior" actions={<FlowerAutoSaveIndicator dirty={false} saving={busy()} />} /></div><p data-neighbor>Following content</p></>, host);
  await settle(); const geometry = () => [...host.children].map(rect);
  const idle = geometry(); setBusy(true); await settle(); expect(geometry()).toEqual(idle);
  setBusy(false); await settle(); expect(geometry()).toEqual(idle);
});

it('keeps the model toolbar and result list still through refresh and a long error', async () => {
  await page.viewport(600, 1000);
  const host = document.createElement('div'); host.style.width = '488px'; document.body.append(host);
  const [loading, setLoading] = createSignal(false); const [error, setError] = createSignal('');
  dispose = render(() => <><ModelCatalogControls hasContent copy={modelCatalogCopy('zh-CN')} query="" count={2} loading={loading()} error={error()} onQuery={() => {}} onSelectAll={() => {}} onClear={() => {}} onRefresh={() => {}} /><p data-neighbor>Model results</p></>, host);
  await settle(); const initial = rect(host.querySelector('[data-neighbor]')!);
  setLoading(true); await settle(); expect(rect(host.querySelector('[data-neighbor]')!)).toEqual(initial);
  setError('The model provider could not be reached. '.repeat(20)); setLoading(false); await settle(); expect(rect(host.querySelector('[data-neighbor]')!)).toEqual(initial);
});


it.each([1280, 390])('keeps neighboring services still through operation settlement and dismissal at %ipx', async width => {
  await page.viewport(width, 900);
  const host = document.createElement('div'); host.className = 'web-services'; document.body.append(host);
  type RowProps = ComponentProps<typeof ManagedServiceRow>;
  const service: RowProps['service'] = {
    service_id: 'layout', template_id: 'example', name: 'Workspace', template_source: 'builtin', deployment: 'container',
    workspace_path: '/workspace', workspace_ownership: 'redeven_created', desired_state: 'running', observed_state: 'running',
    status: 'running', pending_changes: true, primary_action: 'stop', management_state: 'active', forward_id: 'forward', runtime_port: 3000,
    release_status: { schema_version: 2, check_status: 'pending' },
    actions: { open: { available: true }, inspect: { available: true }, stop: { available: true }, start: { available: false }, restart: { available: true }, retry: { available: false } },
  };
  const operation: NonNullable<RowProps['operation']> = {
    operation_id: 'operation', service_id: 'layout', action: 'start', state: 'running', stage: 'starting',
    progress_current: 1, progress_total: 3,
  };
  const [current, setCurrent] = createSignal<RowProps['operation']>(null);
  const [phase, setPhase] = createSignal<RowProps['operationPhase']>('visible');
  const [expanded, setExpanded] = createSignal(false);
  dispose = render(() => <div class="web-service-list"><ManagedServiceRow service={service} operation={current()} operationPhase={phase()}
    operationExpanded={expanded()} busy={false} canOpen canManage onOpen={() => {}} onOpenResource={() => {}} onAction={() => {}}
    onOperationExpandedChange={(_id, value) => setExpanded(value)} onLogs={() => {}} onUninstall={() => {}} />
    <PortForwardRow forward={forward} busy={false} onOpen={() => {}} onEdit={() => {}} onDelete={() => {}} /></div>, host);
  await settle();
  const geometry = () => [...host.querySelectorAll('.web-service-row, .web-service-identity, .web-service-status, .web-service-open')].map(rect);
  const initial = geometry();
  for (const next of [operation, { ...operation, state: 'succeeded', stage: 'completed' }, null]) {
    setCurrent(next); await settle(); expect(geometry()).toEqual(initial);
    if (next?.state === 'succeeded') { setPhase('exiting'); await new Promise(resolve => setTimeout(resolve, 250)); expect(geometry()).toEqual(initial); }
  }
  setPhase('visible'); setCurrent({ ...operation, state: 'failed', stage: 'failed' }); await settle();
  expect(geometry()).toEqual(initial);
  const notice = host.querySelector<HTMLElement>('[data-testid="managed-service-notice"]')!;
  expect(notice.checkVisibility()).toBe(false);
  await userEvent.click(host.querySelector('.web-service-status-trigger')!); await settle();
  expect(notice.checkVisibility()).toBe(true);
  expect(notice.getBoundingClientRect().width).toBeGreaterThan(100);
  expect(notice.getBoundingClientRect().height).toBeGreaterThan(16);
  expect(notice.innerText.trim()).not.toBe('');
  await userEvent.click(host.querySelector('.web-service-status-trigger')!); await settle();
  expect(geometry()).toEqual(initial);
});

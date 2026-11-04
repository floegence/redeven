import '../../index.css';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { FloeConfigProvider, ThemeProvider, builtInShellThemePresets, useTheme } from '@floegence/floe-webapp-core';
import { afterEach, expect, it, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { I18nProvider } from '../i18n';
import { ManagedServiceRow, type ManagedService } from './EnvPortForwardsPage';
import type { ManagedOperation } from './managedServiceOperationController';
import realImagePull from './__fixtures__/managed-image-pull.json';

vi.mock('./EnvContext', () => ({ useEnvContext: () => ({ env_id: () => 'operation-acceptance' }) }));
vi.mock('@floegence/floe-webapp-protocol', () => ({ useProtocol: () => ({ session: () => null }) }));
vi.mock('../protocol/redeven_v1', () => ({ useRedevenRpc: () => ({ fs: { list: vi.fn() } }) }));
const media = commands as unknown as { emulateMediaPreferences: (value: { reducedMotion: 'reduce' | 'no-preference' }) => Promise<void> };
const settle = () => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
let dispose: (() => void) | undefined;
let originalAttributes: [string, string][];
let originalLanguage: string | null;
afterEach(async () => {
  dispose?.();
  document.body.replaceChildren();
  for (const attr of Array.from(document.documentElement.attributes)) document.documentElement.removeAttribute(attr.name);
  for (const [name, value] of originalAttributes) document.documentElement.setAttribute(name, value);
  if (originalLanguage === null) localStorage.removeItem('redeven_ui_language_preference');
  else localStorage.setItem('redeven_ui_language_preference', originalLanguage);
  await media.emulateMediaPreferences({ reducedMotion: 'no-preference' });
});

it.each([
  { width: 1200, theme: 'classic-light', locale: 'zh-CN', reduced: false },
  { width: 1200, theme: 'classic-dark', locale: 'en-US', reduced: false },
  { width: 390, theme: 'classic-light', locale: 'de-DE', reduced: false },
  { width: 390, theme: 'classic-dark', locale: 'zh-TW', reduced: true },
])('keeps update execution readable and bounded at $width in $theme / $locale', async ({ width, theme, locale, reduced }) => {
  originalAttributes = Array.from(document.documentElement.attributes, ({ name, value }) => [name, value]);
  originalLanguage = localStorage.getItem('redeven_ui_language_preference');
  localStorage.setItem('redeven_ui_language_preference', locale);
  await page.viewport(width, 900);
  await media.emulateMediaPreferences({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
  const host = document.createElement('div');
  host.className = 'web-services';
  host.style.cssText = 'padding:16px;width:100%;';
  document.body.append(host);
  const base: ManagedService = {
    service_id: 'update-service', template_id: 'example-host', name: 'Example dashboard', template_source: 'builtin', deployment: 'host',
    workspace_path: '/workspace/dashboard', workspace_ownership: 'redeven_created', desired_state: 'running', observed_state: 'running', status: 'running', primary_action: 'stop',
    forward_id: 'forward', runtime_port: 3000, release_status: { schema_version: 2, current_release: { schema_version: 1, kind: 'npm', version: '2.0.0' }, check_status: 'pending' },
    actions: { retry: { available: false }, start: { available: false }, open: { available: true }, stop: { available: true }, inspect: { available: true }, restart: { available: true } },
  };
  const [operation, setOperation] = createSignal<ManagedOperation>({ operation_id: 'update', service_id: base.service_id, action: 'update', state: 'running', stage: 'downloading', progress_current: 2, progress_total: 7,
    progress_detail: { schema_version: 2, stage_started_at_unix_ms: Date.now() - 10000, transfer: { artifact_reference: 'node-v24.19.0-darwin-arm64.tar.gz', downloaded_bytes: 26000000, total_bytes: 52000000, bytes_per_second: 5200000 } },
  });
  const [expanded, setExpanded] = createSignal(true);
  const [deployment, setDeployment] = createSignal<ManagedService['deployment']>('host');
  const opened = vi.fn();
  function Surface() {
    const palette = useTheme();
    palette.selectShellTheme(theme === 'classic-dark' ? 'dark' : 'light', theme);
    return <I18nProvider><div class="web-services-list">
      <ManagedServiceRow service={{ ...base, deployment: deployment() }} operation={operation()} operationExpanded={expanded()} busy={false} canOpen canManage onOpen={opened} onOpenResource={() => undefined} onAction={() => undefined} onOperationExpandedChange={(_, value) => setExpanded(value)} onLogs={() => undefined} onUninstall={() => undefined} />
      <div data-testid="neighbor">Example workspace</div>
    </div></I18nProvider>;
  }
  dispose = render(() => <FloeConfigProvider config={{ theme: { shellPresets: builtInShellThemePresets }, storage: { enabled: false } }}><ThemeProvider><Surface /></ThemeProvider></FloeConfigProvider>, host);
  await expect.poll(() => document.documentElement.lang).toBe(locale);
  await document.fonts.ready;
  await new Promise(resolve => setTimeout(resolve, 300));
  const detail = host.querySelector<HTMLElement>('.service-operation-details')!;
  const panel = host.querySelector<HTMLElement>('.service-operation-stage')!;
  const neighbor = host.querySelector<HTMLElement>('[data-testid="neighbor"]')!;
  const output = host.querySelector<HTMLElement>('[role="log"]')!;
  const open = host.querySelector<HTMLButtonElement>('.web-service-open button')!;
  expect(open.disabled).toBe(true);
  expect(open.querySelector('.text-warning')).toBeNull();
  expect(open.querySelector('svg polygon')).toBeNull();
  expect(host.querySelector('[data-state="active"][data-managed-operation-step]')?.textContent).not.toContain('Pulling');
  const control = host.querySelector<HTMLElement>('.web-service-open-control')!;
  control.focus();
  await expect.poll(() => document.querySelector('[role="tooltip"]')?.textContent).toContain('·');
  open.click(); expect(opened).not.toHaveBeenCalled();
  control.blur();
  const before = { height: panel.clientHeight, next: neighbor.getBoundingClientRect().top, detail: detail.clientHeight };
  expect(output.clientHeight).toBeGreaterThan(60);
  expect(detail.querySelector('details')).toBeNull();
  expect(detail.getBoundingClientRect().right).toBeLessThanOrEqual(width);
  expect(host.scrollWidth).toBeLessThanOrEqual(host.clientWidth);
  const fill = panel.querySelector('[data-floe-surface-part="progress-fill"]');
  setOperation(value => ({ ...value, progress_detail: { ...value.progress_detail!, transfer: { ...value.progress_detail!.transfer!, downloaded_bytes: 36000000 } } }));
  await settle();
  expect(panel.querySelector('[data-floe-surface-part="progress-fill"]')).toBe(fill);
  // Recorded through the real Docker CLI, managed reporter and SQLite boundary.
  setDeployment('container');
  setOperation({ ...realImagePull, operation_id: 'update', service_id: base.service_id } as ManagedOperation);
  await settle();
  const facts = host.querySelector('.service-operation-transfer-facts')!;
  expect(facts.textContent).toContain('6.29 MB / 6.29 MB');
  expect(facts.textContent).toContain('/s');
  expect(facts.textContent).toContain('1 / 2');
  expect(output.textContent).toContain('docker pull');
  expect(output.textContent).toContain('Downloading');
  expect(output.textContent).not.toContain(String.fromCharCode(27));
  expect(panel.clientHeight).toBe(before.height);
  expect(neighbor.getBoundingClientRect().top).toBe(before.next);
  await page.screenshot({ path: '__screenshots__/image-pull-' + width + '-' + theme + '.png', element: host });
  setOperation(value => ({ ...value, progress_detail: { ...value.progress_detail!, transfer: { ...value.progress_detail!.transfer!, total_bytes: undefined } } }));
  await settle();
  expect(facts.querySelector('dd')?.textContent).toBe('6.29 MB');
  expect(facts.textContent).toContain('/s');
  setOperation(value => ({ ...value, progress_detail: { ...value.progress_detail!, transfer: { phase: 'cached', downloaded_bytes: 0, bytes_per_second: 0, completed_layers: 2, total_layers: 2 } } }));
  await settle();
  expect(facts.querySelector('dd')?.textContent).toBe('0 B');
  expect(facts.textContent).toContain('0 B/s');
  expect(panel.clientHeight).toBe(before.height);
  const lines = Array.from({ length: 80 }, (_, index) => ({ sequence: index + 1, command_id: 'install', stream: 'stdout' as const, text: 'Verified package output ' + (index + 1) }));
  setOperation(value => ({ ...value, stage: 'installing', progress_current: 4, progress_detail: { ...value.progress_detail!, commands: Array.from({length: 20}, (_, index) => ({ command_id: 'command-' + index, display: '<managed-node> <managed-npm-cli> install @example/dashboard@2.0.0 --prefix <managed-install-root>', state: 'succeeded' as const })), output: lines } }));
  await settle();
  expect(panel.clientHeight).toBe(before.height);
  expect(detail.clientHeight).toBe(before.detail);
  expect(neighbor.getBoundingClientRect().top).toBe(before.next);
  expect(output.clientHeight).toBeGreaterThan(40);
  expect(output.scrollHeight).toBeGreaterThan(output.clientHeight);
  expect(host.querySelectorAll('.service-operation-command')).toHaveLength(20);
  expect(panel.querySelectorAll('[role="log"]')).toHaveLength(1);
  expect(output.clientHeight).toBeGreaterThan(120);
  const retainedLine = output.querySelector('[data-sequence="1"]');
  output.scrollTop = 0;
  output.dispatchEvent(new Event('scroll'));
  setOperation(value => ({ ...value, progress_detail: { ...value.progress_detail!, output: [...lines, { sequence: 81, command_id: 'command-0', stream: 'stderr', text: 'Concurrent command output' }, { sequence: 82, command_id: 'install', stream: 'stdout', text: 'Installation continues' }] } }));
  await settle();
  expect(output.querySelector('[data-sequence="1"]')).toBe(retainedLine);
  expect(Array.from(output.querySelectorAll('[data-sequence]'), line => Number(line.getAttribute('data-sequence')))).toEqual(Array.from({ length: 82 }, (_, index) => index + 1));
  expect(output.scrollTop).toBe(0);
  const concurrentLine = output.querySelector('[data-sequence="81"]')!;
  expect(concurrentLine.previousElementSibling?.classList.contains('service-operation-command')).toBe(true);
  expect(concurrentLine.nextElementSibling?.getAttribute('data-sequence')).toBe('82');
  const active = host.querySelector<HTMLElement>('[aria-current="step"]')!;
  const rail = host.querySelector<HTMLElement>('.service-operation-timeline')!;
  expect(active.getBoundingClientRect().left).toBeGreaterThanOrEqual(rail.getBoundingClientRect().left);
  expect(active.getBoundingClientRect().right).toBeLessThanOrEqual(rail.getBoundingClientRect().right);
  setOperation(value => ({ ...value, progress_detail: { ...value.progress_detail!, commands: [{ command_id: 'install', display: '<managed-node> <managed-npm-cli> install @example/dashboard@2.0.0 --prefix <managed-install-root>', state: 'running' }], output: lines.slice(0, 6) } }));
  await settle();
  output.scrollTop = 0;
  await userEvent.click(host.querySelector<HTMLElement>('[data-testid="neighbor"]')!);
  await page.screenshot({ path: '__screenshots__/operation-' + width + '-' + theme + '.png', element: host });
  setOperation(value => ({ ...value, state: 'succeeded', stage: 'completed', progress_current: 7, progress_detail: { ...value.progress_detail!, transfer: undefined } }));
  await settle();
  expect(panel.clientHeight).toBe(before.height);
  expect(neighbor.getBoundingClientRect().top).toBe(before.next);
  expect(open.disabled).toBe(false);
  await userEvent.click(open); expect(opened).toHaveBeenCalledTimes(1);
  expect(host.querySelector('[data-testid="managed-service-notice"]')?.getAttribute('aria-hidden')).toBe('true');
  if (reduced) expect(getComputedStyle(host.querySelector('.service-operation')!).transitionDuration).toBe('0s');
  setExpanded(false);
  await settle();
  if (!reduced) expect(host.querySelector('[data-presentation-state="exiting"]')).toBeTruthy();
  await expect.poll(() => host.querySelector('.service-operation')).toBeNull();
});

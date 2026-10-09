import '../index.css';
import '../ui/flower-feature.css';
import '../../../../tessiven_ui/src/tessiven.css';
import { createSignal, onCleanup } from 'solid-js';
import { render } from 'solid-js/web';
import { FloeConfigProvider, LayoutProvider } from '@floegence/floe-webapp-core';
import { builtInShellThemePresets } from '@floegence/floe-webapp-core/themes';
import { afterEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { DesktopFlowerRuntimeBoundary } from '../../../../../desktop/src/welcome/flower/DesktopFlowerRuntimeBoundary';
import { createLocalEnvironmentFlowerSurfaceAdapter, type DesktopSettingsBridge } from '../../../../../desktop/src/welcome/flower/localEnvironmentFlowerSurfaceAdapter';
import { createDesktopI18n } from '../../../../../desktop/src/shared/i18n';
import { normalizeRuntimeServiceSnapshot, RUNTIME_SERVICE_COMPATIBILITY_EPOCH, RUNTIME_SERVICE_PROTOCOL_VERSION, type RuntimeServiceAIReadinessState } from '../../../../../desktop/src/shared/runtimeService';
import { FlowerSurface, createFlowerComposerDraftCoordinator } from '../../../../flower_ui/src';
import { TessivenFlowerPanel } from '../../../../tessiven_ui/src/TessivenFlowerPanel';
import { TessivenGraph } from '../../../../tessiven_ui/src/TessivenGraph';
import { tessivenText } from '../../../../tessiven_ui/src/i18n';
import { canvasFlowerAdapter } from './tessiven-flower.test-support';
import { modelDirectoryWireFixture } from '../test/modelDirectoryWireFixture';
import hadoop from './fixtures/tessiven-hadoop.json';
import type { CanvasDocument } from '../../../../tessiven_ui/src/types';

let dispose: (() => void) | undefined;
let host: HTMLDivElement;
afterEach(() => {
  dispose?.(); host?.remove();
  document.documentElement.removeAttribute('style');
  document.documentElement.classList.remove('dark', 'light');
});

it.each(['porcelain-light', 'porcelain-dark'])('recovers the Desktop canvas model and draft through AI startup in %s', async themeID => {
  await page.viewport(1200, 800);
  const theme = builtInShellThemePresets.find(value => value.name === themeID)!;
  document.documentElement.classList.add(theme.mode ?? 'light');
  for (const [key, value] of Object.entries(theme.semanticTokens ?? {})) if (value) document.documentElement.style.setProperty(key, value);
  host = document.createElement('div');
  host.className = 'tessiven';
  host.style.cssText = 'position:absolute;inset:20px;';
  document.body.append(host);
  const [state, setState] = createSignal<RuntimeServiceAIReadinessState>('inspecting');
  let releaseSettings!: () => void;
  const settingsReady = new Promise<void>(resolve => { releaseSettings = resolve; });
  const request = vi.fn(async ({ path }: { path: string }) => {
    if (path.endsWith('/settings')) await settingsReady;
    if (path.endsWith('/settings')) return { ok: true, data: { ai: { permission_type: 'full_access', current_model_id: 'deepseek/deepseek-flash', providers: [
      { id: 'deepseek', name: 'DeepSeek', type: 'deepseek', model_selection: { selected_models: ['deepseek-flash', 'deepseek-pro'] } },
    ] }, ai_secrets: { provider_api_key_set: { deepseek: true } } } };
    if (path.includes('/models')) return { ok: true, data: modelDirectoryWireFixture({ ai: { current_model_id: 'deepseek/deepseek-flash', providers: [{ id: 'deepseek', name: 'DeepSeek', type: 'deepseek', models: [], model_selection: { selected_models: ['deepseek-flash', 'deepseek-pro'] } }] } }, { current_model: 'deepseek/deepseek-flash', models: [{ id: 'deepseek/deepseek-flash', label: 'DeepSeek / deepseek-flash' }, { id: 'deepseek/deepseek-pro', label: 'DeepSeek / deepseek-pro' }] }) };
    throw new Error(`Unexpected model request: ${path}`);
  });
  const desktop = createLocalEnvironmentFlowerSurfaceAdapter({ requestRuntimeFlower: request } as unknown as DesktopSettingsBridge);
  const adapter = {
    ...canvasFlowerAdapter(),
    loadSettings: desktop.loadSettings,
    loadModelDirectory: desktop.loadModelDirectory,
    subscribeModelDirectory: desktop.subscribeModelDirectory,
  };
  const Canvas = () => {
    const drafts = createFlowerComposerDraftCoordinator();
    onCleanup(() => drafts.dispose());
    return <FloeConfigProvider><LayoutProvider>
      <TessivenGraph t={tessivenText('en-US')} historical={false} onAsk={() => {}} onInspect={() => {}}
        version={{ canvas_id: 'hadoop', number: 2, document: hadoop as CanvasDocument, document_yaml: '', digest: 'fixture', created_at: 1, source: 'flower', summary: '' }} />
      <TessivenFlowerPanel visible request={{ selection: { canvas_id: 'hadoop', version_id: 2, object_refs: [] }, labels: {}, nonce: 0 }}
        t={tessivenText('en-US')} onOpenConversation={() => {}} onRemoveReference={() => {}}
        renderSurface={surface => <DesktopFlowerRuntimeBoundary embedded i18n={createDesktopI18n('en-US')} onBack={() => {}} onRecover={async () => {}}
          snapshot={normalizeRuntimeServiceSnapshot({ compatibility_epoch: RUNTIME_SERVICE_COMPATIBILITY_EPOCH, protocol_version: RUNTIME_SERVICE_PROTOCOL_VERSION,
            compatibility: 'compatible', open_readiness: { state: 'openable' }, ai_readiness: { state: state() } })}>
          <FlowerSurface {...surface} adapter={adapter} draftCoordinator={drafts} presentation="companion" notify={() => {}} />
        </DesktopFlowerRuntimeBoundary>} />
    </LayoutProvider></FloeConfigProvider>;
  };
  dispose = render(() => <Canvas />, host);
  await expect.poll(() => host.querySelectorAll('.tessiven-node').length).toBe(10);
  expect(request).not.toHaveBeenCalled();
  const warmup = host.querySelector<HTMLElement>('[data-flower-runtime-availability="preparing"]')!;
  expect(warmup.getBoundingClientRect().bottom).toBeLessThanOrEqual(host.getBoundingClientRect().bottom);
  expect(warmup.getBoundingClientRect().height).toBeLessThan(320);
  await page.screenshot({ element: host, path: `__screenshots__/desktop-canvas-preparing-${themeID}.png` });
  setState('ready');
  await expect.element(page.getByRole('status', { name: 'Flower settings are still loading.' })).toBeVisible();
  expect(host.querySelector('.flower-composer')?.textContent).not.toContain('No model selected');
  await page.screenshot({ element: host, path: `__screenshots__/desktop-canvas-model-loading-${themeID}.png` });
  releaseSettings();
  await expect.poll(() => host.querySelector('.flower-composer')?.textContent).toContain('DeepSeek');
  await expect.element(page.getByRole('textbox')).toBeVisible();
  expect(host.querySelector('.flower-composer')?.textContent).not.toContain('No model selected');
  await page.getByRole('textbox').fill('Arrange this architecture from left to right');
  await expect.element(page.getByRole('button', { name: 'Send', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Hide replies', exact: true }).click();
  await expect.poll(() => document.querySelector('.tessiven-flower-output')).toBeNull();
  await page.screenshot({ element: host, path: `__screenshots__/desktop-canvas-model-${themeID}.png` });
  setState('recovering');
  await expect.poll(() => host.querySelector('.flower-composer')).toBeNull();
  setState('degraded');
  await expect.element(page.getByRole('textbox')).toHaveValue('Arrange this architecture from left to right');
  await expect.poll(() => host.querySelector('.flower-composer')?.textContent).toContain('DeepSeek');
  await expect.poll(() => request.mock.calls.length).toBe(3);
});

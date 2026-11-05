import '../../index.css';
import { Suspense, createResource, createSignal, onCleanup, onMount } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { FloeConfigProvider } from '@floegence/floe-webapp-core';
import { createFlowerComposerDraftCoordinator } from '../../../../../flower_ui/src';
import { bindSessionHTTP } from '../services/sessionHTTP';
import { I18nProvider } from '../i18n';
import { PluginCreationWorkspace } from './PluginCreationWorkspace';

// This fixture observes product container lifetime only; sandbox execution is
// qualified separately against the actual released Host and Surface SDK.
const lifetime = { opened: 0, disposed: 0, close: vi.fn(async () => true) };
vi.mock('./PluginAuthorPreview', () => ({
  PluginAuthorPreview: (props: { registerClose: (close: (() => Promise<boolean>) | null) => void }) => {
    onMount(() => { lifetime.opened++; props.registerClose(lifetime.close); });
    onCleanup(() => { lifetime.disposed++; props.registerClose(null); });
    return <div data-preview-fixture />;
  },
}));
let dispose: (() => void) | undefined;
let release: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  release?.();
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  lifetime.opened = 0;
  lifetime.disposed = 0;
  lifetime.close.mockReset();
});
it('keeps the live preview connected while a conversation resource is pending', async () => {
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path.endsWith('/status')) return Response.json({ data: {
      artifacts: [{ artifact_id: 'artifact-1', version: '0.1.0', stages: [] }],
      preview: { artifact_id: 'artifact-1', plugin_instance_id: 'preview-1', generation: 1 },
    } });
    if (path.endsWith('/catalog/query')) return Response.json({ ok: true, data: { plugins: [{
      plugin_id: 'dev.example.focus', plugin_instance_id: 'preview-1', management_revision: 4,
      manifest: { plugin: { display_name: 'Focus Timer' }, surfaces: [{ kind: 'view', surface_id: 'focus.view' }] },
    }] } });
    return Response.json({ data: { id: 'draft-1', title: 'Focus Timer', lifecycle: 'active', revision: 3, workspace_id: 'author-1' } });
  });
  vi.stubGlobal('fetch', fetch);
  release = bindSessionHTTP({ fetch, events: async function* () {} });
  const [load, setLoad] = createSignal(false);
  let settle!: (value: string) => void;
  const pending = new Promise<string>(resolve => { settle = resolve; });
  const Conversation = () => {
    const [resource] = createResource(load, () => pending);
    return <div data-conversation-resource>{resource() ?? 'Conversation'}</div>;
  };
  const host = document.createElement('div');
  document.body.append(host);
  dispose = render(() => <FloeConfigProvider><I18nProvider><Suspense fallback={<div data-page-loading />}>
    <PluginCreationWorkspace draftCoordinator={createFlowerComposerDraftCoordinator()} draftID="draft-1"
      visible canManage onBack={vi.fn()} onSaved={vi.fn()} onInstalled={vi.fn()}
      renderFlower={() => <Conversation />} />
  </Suspense></I18nProvider></FloeConfigProvider>, host);
  await expect.poll(() => lifetime.opened).toBe(1);
  const preview = host.querySelector('[data-preview-fixture]')!;
  try {
    setLoad(true);
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    expect(preview.isConnected).toBe(true);
    expect(host.querySelector('[data-page-loading]')).toBeNull();
  } finally { settle('Conversation ready'); }
  await expect.element(page.getByText('Conversation ready', { exact: true })).toBeVisible();
  expect(host.querySelector('[data-preview-fixture]')).toBe(preview);
  expect(lifetime.opened).toBe(1);
  expect(lifetime.disposed).toBe(0);
});
it.each(['accepted', 'cancelled', 'failed'])('closes the preview before %s draft deletion', async (outcome) => {
  const events: string[] = [];
  lifetime.close.mockImplementation(async () => { events.push('close'); return outcome !== 'cancelled'; });
  const draft = { id: 'draft-1', title: 'Focus Timer', lifecycle: 'active', revision: 3, workspace_id: 'author-1' };
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path.endsWith('/delete')) {
      events.push('delete');
      return outcome === 'failed'
        ? Response.json({ error: { message: 'Draft deletion unavailable' } }, { status: 409 })
        : Response.json({ data: { ...draft, lifecycle: 'deleted' } });
    }
    if (path.endsWith('/status')) return Response.json({ data: {
      artifacts: [{ artifact_id: 'artifact-1', version: '0.1.0', stages: [] }],
      preview: { artifact_id: 'artifact-1', plugin_instance_id: 'preview-1', generation: 1 },
    } });
    if (path.endsWith('/catalog/query')) return Response.json({ ok: true, data: { plugins: [{
      plugin_id: 'dev.example.focus', plugin_instance_id: 'preview-1', management_revision: 4,
      manifest: { plugin: { display_name: 'Focus Timer' }, surfaces: [{ kind: 'view', surface_id: 'focus.view' }] },
    }] } });
    return Response.json({ data: draft });
  });
  vi.stubGlobal('fetch', fetch);
  release = bindSessionHTTP({ fetch, events: async function* () {} });
  const onBack = vi.fn();
  const host = document.createElement('div');
  host.style.cssText = 'height:700px;width:100%';
  document.body.append(host);
  dispose = render(() => <FloeConfigProvider><I18nProvider>
    <PluginCreationWorkspace draftCoordinator={createFlowerComposerDraftCoordinator()} draftID="draft-1"
      visible canManage onBack={onBack} onSaved={vi.fn()} onInstalled={vi.fn()}
      renderFlower={() => <div>Conversation fixture</div>} />
  </I18nProvider></FloeConfigProvider>, host);
  await expect.poll(() => lifetime.opened).toBe(1);
  await page.getByRole('button', { name: 'More actions', exact: true }).click();
  await page.getByText('Delete draft', { exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete draft', exact: true }).click();
  await expect.poll(() => events.length).toBe(outcome === 'cancelled' ? 1 : 2);
  expect(events).toEqual(outcome === 'cancelled' ? ['close'] : ['close', 'delete']);
  if (outcome === 'accepted') await expect.poll(() => onBack.mock.calls.length).toBe(1);
  else {
    expect(onBack).not.toHaveBeenCalled();
    await expect.poll(() => lifetime.opened).toBe(outcome === 'failed' ? 2 : 1);
  }
});
it.each(['applied', 'rejected', 'cancelled', 'pending'])('preserves preview lifetime when an identical-byte update is %s', async (outcome) => {
  await page.viewport(1200, 800);
  lifetime.close.mockResolvedValue(outcome !== 'cancelled');
  let applied = false;
  let finishApply: (() => void) | undefined;
  const pendingApply = new Promise<void>((resolve) => { finishApply = resolve; });
  const artifacts = [
    { artifact_id: 'artifact-2', version: '0.1.0', stages: [] },
    { artifact_id: 'artifact-1', version: '0.1.0', stages: [] },
  ];
  const plugins = [{
    plugin_id: 'dev.example.focus', plugin_instance_id: 'instance-1', management_revision: 4,
    manifest: { plugin: { display_name: 'Focus Timer' }, surfaces: [{ kind: 'view', surface_id: 'focus.view' }] },
  }];
  const snapshot = () => ({ artifacts, preview: {
    artifact_id: applied ? 'artifact-2' : 'artifact-1', plugin_instance_id: 'instance-1', generation: applied ? 2 : 1,
  } });
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path.endsWith('/apply')) {
      if (outcome === 'pending') await pendingApply;
      if (outcome === 'rejected') return Response.json({ error: { message: 'Update rejected' } }, { status: 409 });
      applied = true;
      return Response.json({ data: snapshot() });
    }
    if (path.endsWith('/status')) return Response.json({ data: snapshot() });
    if (path.endsWith('/catalog/query')) return Response.json({ ok: true, data: { plugins } });
    return Response.json({ data: { id: 'draft-1', title: 'Focus Timer', lifecycle: 'active', revision: 2, workspace_id: 'author-1' } });
  });
  vi.stubGlobal('fetch', fetch);
  release = bindSessionHTTP({ fetch, events: async function* () {} });
  const host = document.createElement('div');
  host.style.cssText = 'height:700px;width:100%';
  document.body.append(host);
  dispose = render(() => <FloeConfigProvider><I18nProvider>
    <PluginCreationWorkspace draftCoordinator={createFlowerComposerDraftCoordinator()} draftID="draft-1"
      visible canManage onBack={vi.fn()} onSaved={vi.fn()} onInstalled={vi.fn()}
      renderFlower={() => <div>Conversation fixture</div>} />
  </I18nProvider></FloeConfigProvider>, host);
  await expect.poll(() => lifetime.opened).toBe(1);
  await page.getByRole('button', { name: 'Update preview', exact: true }).click();
  await expect.poll(() => lifetime.close.mock.calls.length).toBe(1);
  if (outcome === 'pending') {
    try {
      await expect.element(page.getByRole('button', { name: 'Install in this environment', exact: true })).toBeDisabled();
    } finally { finishApply?.(); }
  }
  if (outcome === 'cancelled') {
    await expect.element(page.getByRole('button', { name: 'Update preview', exact: true })).toBeEnabled();
    expect(lifetime.opened).toBe(1);
    expect(lifetime.disposed).toBe(0);
    expect(fetch.mock.calls.some(([input]) => String(input).endsWith('/apply'))).toBe(false);
    return;
  }
  await expect.poll(() => lifetime.opened, { timeout: 6000 }).toBe(2);
  expect(lifetime.disposed).toBe(1);
});
it.each(['cancelled', 'accepted', 'failed', 'pending'])('handles %s navigation from the preview to the installed application', async (outcome) => {
  lifetime.close.mockResolvedValue(outcome !== 'cancelled');
  const draft = { id: 'draft-1', title: 'Focus Timer', lifecycle: 'active', revision: 3, workspace_id: 'author-1',
    install_request_id: 'install-1', install_artifact_id: 'artifact-1', install_inspection_id: 'review-1' };
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path.endsWith('/installation')) return Response.json({ data: { request_id: 'install-1', mutation_outcome: 'committed',
      execution: { status: 'completed', plugin_instance_id: 'installed-1' } } });
    if (path.endsWith('/status')) return Response.json({ data: {
      artifacts: [{ artifact_id: 'artifact-1', version: '0.1.0', stages: [] }],
      preview: { artifact_id: 'artifact-1', plugin_instance_id: 'preview-1', generation: 1 },
    } });
    if (path.endsWith('/catalog/query')) return Response.json({ ok: true, data: { plugins: [{
      plugin_id: 'dev.example.focus', plugin_instance_id: 'preview-1', management_revision: 4,
      manifest: { plugin: { display_name: 'Focus Timer' }, surfaces: [{ kind: 'view', surface_id: 'focus.view' }] },
    }] } });
    return Response.json({ data: draft });
  });
  vi.stubGlobal('fetch', fetch);
  release = bindSessionHTTP({ fetch, events: async function* () {} });
  let finishNavigation: (() => void) | undefined;
  const pendingNavigation = new Promise<void>((resolve) => { finishNavigation = resolve; });
  const openInstalled = vi.fn(async () => {
    if (outcome === 'pending') await pendingNavigation;
    if (outcome === 'failed') throw new Error('Installed application unavailable');
  });
  const host = document.createElement('div');
  host.style.cssText = 'height:700px;width:100%';
  document.body.append(host);
  dispose = render(() => <FloeConfigProvider><I18nProvider>
    <PluginCreationWorkspace draftCoordinator={createFlowerComposerDraftCoordinator()} draftID="draft-1"
      visible canManage onBack={vi.fn()} onSaved={vi.fn()} onInstalled={vi.fn()} onOpenInstalled={openInstalled}
      renderFlower={() => <div>Conversation fixture</div>} />
  </I18nProvider></FloeConfigProvider>, host);
  await expect.poll(() => lifetime.opened).toBe(1);
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  await expect.poll(() => lifetime.close.mock.calls.length).toBe(1);
  if (outcome === 'cancelled') {
    expect(openInstalled).not.toHaveBeenCalled();
    expect(lifetime.disposed).toBe(0);
  } else {
    await expect.poll(() => openInstalled.mock.calls.length).toBe(1);
    expect(openInstalled).toHaveBeenCalledWith('installed-1');
    if (outcome === 'pending') {
      try {
        await new Promise((resolve) => setTimeout(resolve, 2800));
        expect(lifetime.opened).toBe(1);
      } finally { finishNavigation?.(); }
    }
    // This fixture leaves the page mounted, including when navigation fails.
    await expect.poll(() => lifetime.opened).toBe(2);
    expect(lifetime.disposed).toBe(1);
    if (outcome === 'failed') await expect.element(page.getByText('Installed application unavailable', { exact: true })).toBeVisible();
  }
});

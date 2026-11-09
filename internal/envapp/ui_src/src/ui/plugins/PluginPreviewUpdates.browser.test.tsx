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
afterEach(async () => {
  dispose?.();
  release?.();
  vi.unstubAllGlobals();
  localStorage.removeItem('redeven.plugin-creation.preview-version:author-1');
  document.body.replaceChildren();
  lifetime.opened = 0;
  lifetime.disposed = 0;
  lifetime.close.mockReset();
  await page.viewport(1200, 800);
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
  expect(host.querySelector('.plugin-creation-empty-preview')).toBeNull();
  expect(host.querySelector('.plugin-creation-preview .plugin-creation-atmosphere')).toBeNull();
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
  await page.getByText('Delete project', { exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Delete project', exact: true }).click();
  await expect.poll(() => events.length).toBe(outcome === 'cancelled' ? 1 : 2);
  expect(events).toEqual(outcome === 'cancelled' ? ['close'] : ['close', 'delete']);
  if (outcome === 'accepted') await expect.poll(() => onBack.mock.calls.length).toBe(1);
  else {
    expect(onBack).not.toHaveBeenCalled();
    await expect.poll(() => lifetime.opened).toBe(outcome === 'failed' ? 2 : 1);
  }
});
it.each([1200, 390].flatMap(width => ['applied', 'rejected', 'cancelled', 'pending'].map(outcome => ({ width, outcome }))))('preserves preview lifetime when an identical-byte update is $outcome at $width px', async ({ width, outcome }) => {
  await page.viewport(width, 800);
  lifetime.close.mockResolvedValue(outcome !== 'cancelled');
  let applied = false;
  let built = false;
  let rejectApply = outcome === 'rejected';
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
  const snapshot = () => ({ artifacts: built ? artifacts : artifacts.slice(1), preview: {
    artifact_id: applied ? 'artifact-2' : 'artifact-1', plugin_instance_id: 'instance-1', generation: applied ? 2 : 1,
  } });
  const fetch = vi.fn(async (input: RequestInfo | URL) => {
    const path = String(input);
    if (path.endsWith('/apply')) {
      if (outcome === 'pending') await pendingApply;
      if (rejectApply) return Response.json({ error: { message: 'Update rejected' } }, { status: 409 });
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
  built = true;
  await expect.poll(() => lifetime.close.mock.calls.length, { timeout: 6000 }).toBe(1);
  if (outcome === 'pending') {
    try {
      await expect.element(page.getByRole('button', { name: 'Install in this environment', exact: true })).toBeDisabled();
    } finally { finishApply?.(); }
  }
  if (outcome === 'cancelled') {
    if (width >= 720) await expect.element(page.getByRole('button', { name: 'Preview versions', exact: true })).toBeEnabled();
    expect(lifetime.opened).toBe(1);
    expect(lifetime.disposed).toBe(0);
    expect(fetch.mock.calls.some(([input]) => String(input).endsWith('/apply'))).toBe(false);
    return;
  }
  await expect.poll(() => lifetime.opened, { timeout: 6000 }).toBe(2);
  expect(lifetime.disposed).toBe(1);
  if (outcome === 'rejected') {
    await expect.element(page.getByText('Update rejected', { exact: true })).toBeVisible();
    rejectApply = false;
    await page.getByRole('button', { name: 'Try again', exact: true }).click();
    await expect.poll(() => applied).toBe(true);
    await expect.poll(() => lifetime.opened).toBe(3);
  }
});
it.each(['accepted', 'failed', 'pending'])('preserves the author preview while opening the installed application: %s', async (outcome) => {
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
  const preview = host.querySelector('[data-preview-fixture]');
  await page.getByRole('button', { name: 'Open', exact: true }).click();
  try {
    await expect.poll(() => openInstalled.mock.calls.length).toBe(1);
    expect(openInstalled).toHaveBeenCalledWith('installed-1');
    if (outcome === 'pending') {
      try {
        await expect.element(page.getByRole('button', { name: 'Open', exact: true })).toBeDisabled();
        expect(lifetime.opened).toBe(1);
      } finally { finishNavigation?.(); }
    }
    await expect.element(page.getByRole('button', { name: 'Open', exact: true })).toBeEnabled();
    expect(lifetime.close).not.toHaveBeenCalled();
    expect(lifetime.opened).toBe(1);
    expect(lifetime.disposed).toBe(0);
    expect(host.querySelector('[data-preview-fixture]')).toBe(preview);
    if (outcome === 'failed') await expect.element(page.getByText('Installed application unavailable', { exact: true })).toBeVisible();
  } finally { finishNavigation?.(); }
});

// The released Host owns update validation; this fixture exercises the complete
// product sequence and verifies exact artifact/request binding at each boundary.
it.each([1200, 390].flatMap(width => ['completed', 'newer'].map(outcome => ({ width, outcome }))))('updates an installed plugin without leaving creation: $outcome at $width px', async ({ width, outcome }) => {
  await page.viewport(width, 800);
  lifetime.close.mockResolvedValue(true);
  let draft = { id: 'draft-1', title: 'Focus Timer', lifecycle: 'active', revision: 3, workspace_id: 'author-1',
    installed_plugin_id: 'installed-1', install_request_id: 'install-1', install_artifact_id: 'artifact-1', install_inspection_id: 'review-1' };
  let latest = 'artifact-1', preview = 'artifact-1';
  const calls: Array<{ action: string; body: Record<string, string> }> = [];
  const hash = 'sha256:' + 'a'.repeat(64);
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input), body = init?.body ? JSON.parse(String(init.body)) : {};
    if (path.endsWith('/installation')) return Response.json({ data: { request_id: draft.install_request_id, mutation_outcome: 'committed',
      execution: { status: 'completed', plugin_instance_id: 'installed-1' } } });
    const snapshot = () => ({ artifacts: [...new Set([latest, preview, 'artifact-1'])].map(id => ({
      artifact_id: id, version: id === 'artifact-1' ? '0.1.0' : '0.2.0', stages: [] })),
      preview: { artifact_id: preview, plugin_instance_id: 'preview-1', generation: preview === 'artifact-1' ? 1 : 2 } });
    if (path.endsWith('/status')) return Response.json({ data: snapshot() });
    if (path.endsWith('/apply')) { calls.push({ action: 'apply', body });
      preview = body.artifact_id; return Response.json({ data: snapshot() }); }
    if (path.endsWith('/inspect')) {
      calls.push({ action: 'inspect', body });
      return Response.json({ data: { inspection_id: 'review-2', intent: { action: 'update', plugin_instance_id: 'installed-1' },
        plugin_id: 'dev.example.focus', publisher_id: 'dev.example', version: '0.2.0', expires_at: '2026-12-01T00:00:00Z',
        inspected_hashes: { package_sha256: hash, manifest_sha256: hash, entries_sha256: hash },
        source_provenance: { kind: 'package_upload', package_sha256: hash, resolved_at: '2026-11-07T00:00:00Z' },
        execution_approval: { state: 'pending', reason_codes: [], assessed_at: '2026-11-07T00:00:00Z' },
        update_eligibility: { state: 'manual_only', reason_codes: [], assessed_at: '2026-11-07T00:00:00Z' },
        security_summary: { summary_sha256: hash, permissions: [], methods: [], capability_contracts: [], workers: [], network: [], storage: [], secret_refs: [], core_actions: [], intents: [], surfaces: [] },
      } });
    }
    if (path.endsWith('/install')) {
      calls.push({ action: 'install', body });
      draft = { ...draft, revision: draft.revision + 1, install_request_id: body.request_id,
        install_artifact_id: body.artifact_id, install_inspection_id: body.inspection_id };
      return Response.json({ data: { request_id: body.request_id, mutation_outcome: 'committed', execution: { status: 'completed', plugin_instance_id: 'installed-1' } } });
    }
    if (path.endsWith('/catalog/query')) return Response.json({ ok: true, data: { plugins: [{
      plugin_id: 'dev.example.focus', plugin_instance_id: 'preview-1', management_revision: 4,
      manifest: { plugin: { display_name: 'Focus Timer' }, surfaces: [{ kind: 'view', surface_id: 'focus.view' }] },
    }] } });
    return Response.json({ data: draft });
  });
  vi.stubGlobal('fetch', fetch);
  release = bindSessionHTTP({ fetch, events: async function* () {} });
  const host = document.createElement('div'); host.style.cssText = 'height:700px;width:100%'; document.body.append(host);
  const onOpen = vi.fn(), installed = vi.fn();
  dispose = render(() => <FloeConfigProvider><I18nProvider>
    <PluginCreationWorkspace draftCoordinator={createFlowerComposerDraftCoordinator()} draftID="draft-1"
      visible canManage onBack={vi.fn()} onSaved={vi.fn()} onInstalled={installed} onOpenInstalled={onOpen}
      renderFlower={() => <textarea aria-label="Conversation draft" />} />
  </I18nProvider></FloeConfigProvider>, host);
  await expect.element(page.getByRole('button', { name: 'Open', exact: true })).toBeEnabled();
  const conversation = host.querySelector('textarea')!; conversation.value = 'Keep my next request';
  draft = { ...draft, title: 'Daily Focus', revision: draft.revision + 1 };
  latest = 'artifact-2';
  await expect.element(page.getByRole('heading', { name: 'Daily Focus', exact: true })).toBeVisible();
  await expect.element(page.getByRole('button', { name: 'Update', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Update', exact: true }).click();
  await expect.element(page.getByRole('dialog')).toBeVisible();
  if (outcome === 'newer') {
    latest = 'artifact-3';
    await expect.element(page.getByText('This installs the current preview. Changes that have not been applied are not included.', { exact: true })).toBeVisible();
  }
  expect(calls.map(call => call.action)).toEqual(['apply', 'inspect']);
  expect(calls.every(call => call.body.artifact_id === 'artifact-2')).toBe(true);
  await page.getByRole('dialog').getByRole('button', { name: 'Update plugin', exact: true }).click();
  await expect.poll(() => calls.filter(call => call.action === 'install').length).toBe(1);
  await expect.element(page.getByRole('dialog')).not.toBeInTheDocument();
  if (outcome === 'newer') {
    await expect.element(page.getByRole('button', { name: 'Update', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'More actions', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Open', exact: true }).click();
  } else {
    await expect.element(page.getByRole('button', { name: 'Open', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Open', exact: true }).click();
  }
  const commit = calls.find(call => call.action === 'install')!;
  expect(commit.body.artifact_id).toBe('artifact-2');
  expect(commit.body.inspection_id).toBe('review-2');
  expect(commit.body.request_id).not.toBe('install-1');
  expect(installed).toHaveBeenLastCalledWith('installed-1');
  expect(onOpen).toHaveBeenCalledWith('installed-1');
  expect(conversation.isConnected).toBe(true);
  expect(conversation.value).toBe('Keep my next request');
});


it.each([1200, 390])('follows new builds, pins history across reopen and resumes latest at %s px', async width => {
  await page.viewport(width, 800);
  const openVersions = async () => {
    if (width < 720) {
      await page.getByRole('button', { name: 'More actions', exact: true }).click();
      await page.getByRole('menuitem', { name: 'Preview versions', exact: true }).click();
    } else await page.getByRole('button', { name: 'Preview versions', exact: true }).click();
  };
  lifetime.close.mockResolvedValue(true);
  let latest = 'artifact-1';
  let selected = 'artifact-1';
  const applied: string[] = [];
  const inspected: string[] = [];
  const artifacts = ['artifact-1'];
  let reading = 0;
  let finishApply: (() => void) | undefined;
  let delayApply = false;
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    const snapshot = () => ({
      artifacts: artifacts.map(artifact_id => ({ artifact_id, version: '0.1.0', stages: [] })),
      preview: { artifact_id: selected, plugin_instance_id: 'preview-1', generation: applied.length + 1 },
    });
    if (path.endsWith('/inspect')) {
      inspected.push(JSON.parse(String(init?.body)).artifact_id);
      return Response.json({ error: { message: 'Selected history review fixture' } }, { status: 409 });
    }
    if (path.endsWith('/apply')) {
      const artifactID = JSON.parse(String(init?.body)).artifact_id;
      if (delayApply) await new Promise<void>(resolve => { finishApply = resolve; });
      selected = artifactID;
      applied.push(selected);
      return Response.json({ data: snapshot() });
    }
    if (path.endsWith('/status')) { reading++; return Response.json({ data: snapshot() }); }
    if (path.endsWith('/catalog/query')) return Response.json({ ok: true, data: { plugins: [{
      plugin_id: 'dev.example.focus', plugin_instance_id: 'preview-1', management_revision: 4,
      manifest: { plugin: { display_name: 'Focus Timer' }, surfaces: [{ kind: 'view', surface_id: 'focus.view' }] },
    }] } });
    return Response.json({ data: { id: 'draft-1', title: 'Focus Timer', lifecycle: 'active', revision: 3, workspace_id: 'author-1' } });
  });
  vi.stubGlobal('fetch', fetch);
  release = bindSessionHTTP({ fetch, events: async function* () {} });
  const host = document.createElement('div'); host.style.cssText = 'height:700px;width:100%'; document.body.append(host);
  const [visible, setVisible] = createSignal(true);
  const mount = () => render(() => <FloeConfigProvider><I18nProvider>
    <PluginCreationWorkspace draftCoordinator={createFlowerComposerDraftCoordinator()} draftID="draft-1"
      visible={visible()} canManage onBack={vi.fn()} onSaved={vi.fn()} onInstalled={vi.fn()}
      renderFlower={() => <textarea aria-label="Conversation draft" />} />
  </I18nProvider></FloeConfigProvider>, host);
  dispose = mount();
  await expect.poll(() => lifetime.opened).toBe(1);
  setVisible(false);
  latest = 'artifact-2'; artifacts.unshift(latest);
  setVisible(true);
  await expect.poll(() => applied, { timeout: 6500 }).toEqual(['artifact-2']);
  expect(lifetime.close).toHaveBeenCalledOnce();
  await expect.poll(() => lifetime.opened).toBe(2);
  await openVersions();
  await page.getByRole('menuitem', { name: 'Build 1', exact: false }).click();
  await expect.poll(() => selected).toBe('artifact-1');
  await expect.poll(() => localStorage.getItem('redeven.plugin-creation.preview-version:author-1')).toBe('artifact-1');
  latest = 'artifact-3'; artifacts.unshift(latest);
  const priorRead = reading;
  await expect.poll(() => reading, { timeout: 6000 }).toBeGreaterThan(priorRead);
  expect(selected).toBe('artifact-1');
  await page.getByRole('button', { name: 'Install in this environment', exact: true }).click();
  await expect.poll(() => inspected).toEqual(['artifact-1']);
  expect(selected).toBe('artifact-1');
  dispose?.(); dispose = mount();
  await expect.poll(() => host.querySelector('.plugin-creation-version-label')?.textContent).toBe('Build 1');
  expect(selected).toBe('artifact-1');
  delayApply = true;
  await openVersions();
  await page.getByRole('menuitem', { name: 'Follow latest', exact: true }).click();
  await expect.poll(() => Boolean(finishApply)).toBe(true);
  latest = 'artifact-4'; artifacts.unshift(latest);
  delayApply = false; finishApply?.();
  await expect.poll(() => selected, { timeout: 6000 }).toBe('artifact-4');
  expect(applied).toEqual(['artifact-2', 'artifact-1', 'artifact-3', 'artifact-4']);
  expect(localStorage.getItem('redeven.plugin-creation.preview-version:author-1')).toBeNull();
});

it('reconciles a lost historical apply response without following latest or repeating the mutation', async () => {
  await page.viewport(1200, 800);
  lifetime.close.mockResolvedValue(true);
  let selected = 'artifact-2';
  const applied: string[] = [];
  const snapshot = () => ({
    artifacts: ['artifact-2', 'artifact-1'].map(artifact_id => ({ artifact_id, version: '0.1.0', stages: [] })),
    preview: { artifact_id: selected, plugin_instance_id: 'preview-1', generation: applied.length + 1 },
  });
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input);
    if (path.endsWith('/apply')) {
      selected = JSON.parse(String(init?.body)).artifact_id;
      applied.push(selected);
      throw new Error('Preview response lost');
    }
    if (path.endsWith('/status')) return Response.json({ data: snapshot() });
    if (path.endsWith('/catalog/query')) return Response.json({ ok: true, data: { plugins: [{
      plugin_id: 'dev.example.focus', plugin_instance_id: 'preview-1', management_revision: 4,
      manifest: { plugin: { display_name: 'Focus Timer' }, surfaces: [{ kind: 'view', surface_id: 'focus.view' }] },
    }] } });
    return Response.json({ data: { id: 'draft-1', title: 'Focus Timer', lifecycle: 'active', revision: 3, workspace_id: 'author-1' } });
  });
  vi.stubGlobal('fetch', fetch);
  release = bindSessionHTTP({ fetch, events: async function* () {} });
  const host = document.createElement('div'); document.body.append(host);
  dispose = render(() => <FloeConfigProvider><I18nProvider>
    <PluginCreationWorkspace draftCoordinator={createFlowerComposerDraftCoordinator()} draftID="draft-1"
      visible canManage onBack={vi.fn()} onSaved={vi.fn()} onInstalled={vi.fn()}
      renderFlower={() => <div>Conversation fixture</div>} />
  </I18nProvider></FloeConfigProvider>, host);
  await expect.poll(() => lifetime.opened).toBe(1);
  await page.getByRole('button', { name: 'Preview versions', exact: true }).click();
  await page.getByRole('menuitem', { name: /^Build 1/ }).click();
  await expect.element(page.getByText('Preview response lost', { exact: true })).toBeVisible();
  await expect.poll(() => lifetime.opened).toBe(2);
  expect(selected).toBe('artifact-1');
  expect(localStorage.getItem('redeven.plugin-creation.preview-version:author-1')).toBe('artifact-1');
  await page.getByRole('button', { name: 'Try again', exact: true }).click();
  await expect.element(page.getByText('Preview response lost', { exact: true })).not.toBeInTheDocument();
  expect(applied).toEqual(['artifact-1']);
  expect(lifetime.opened).toBe(2);
});

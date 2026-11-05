import { For, Show, Suspense, createEffect, createMemo, createSignal, onCleanup, onMount, untrack, type JSX } from 'solid-js';
import { ArrowLeft, AlertTriangle, Check, MoreHorizontal, Refresh, Wand } from '@floegence/floe-webapp-core/icons';
import { Button, Dropdown, Input, Tabs } from '@floegence/floe-webapp-core/ui';
import { Dialog, ConfirmDialog } from '../primitives/EnvAppModal';
import type { FlowerEmbeddedConversation, FlowerConversationParts } from '../../../../../flower_ui/src';
import {
  CONTEXT_ACTION_SCHEMA_VERSION,
  type ContextActionEnvelope,
} from '../../../../../flower_ui/src/contextActionWire';
import { useI18n } from '../i18n';
import {
  createPluginDraft,
  getPluginDraft,
  deletePluginDraft,
  renamePluginDraft,
  resumePluginDraft,
  pluginCreationAPI,
  type PluginDraft,
} from './pluginCreationApi';
import {
  authorStatus,
  applyAuthorArtifact,
  inspectAuthorArtifact,
  installAuthorArtifact,
  queryAuthorInstall,
  type AuthorSnapshot,
  type AuthorInstallOperation,
} from './pluginAuthorApi';
import { InspectionReview } from './ExternalPluginInstallDialog';
import { PluginAuthorAccess } from './PluginAuthorAccess';
import { PluginAuthorPreview } from './PluginAuthorPreview';
import type { ExternalPluginInspection, PluginSurfaceLaunchTarget } from './pluginTypes';
import type {
  FlowerComposerDraftCoordinator,
  FlowerComposerDraftSnapshot,
} from '../../../../../flower_ui/src/composer/createFlowerComposerDraftCoordinator';
import { loadPluginComposer, savePluginComposer, removePluginComposer } from './pluginComposerPersistence';
import './plugin-creation-workspace.css';

export type PluginCreationMode = 'chat' | 'direct';
export type PluginCreationWorkspaceProps = Readonly<{
  draftCoordinator: FlowerComposerDraftCoordinator;
  draftID: string;
  visible: boolean;
  centerEntry?: boolean;
  canManage?: boolean;
  referenceThreadID?: string;
  onBack: () => void;
  onNavigationReady?: (navigate: ((commit: () => unknown) => Promise<boolean>) | undefined) => void;
  onSaved: (id: string) => void;
  onOpenInstalled?: (pluginInstanceID: string) => Promise<unknown> | unknown;
  onInstalled: (pluginInstanceID: string) => Promise<unknown> | unknown;
  renderFlower: (options: {
    embeddedConversation: FlowerEmbeddedConversation;
    prepareTurnRoute: (requestID: string) => Promise<string>;
  }) => JSX.Element;
}>;

export function PluginCreationWorkspace(props: PluginCreationWorkspaceProps): JSX.Element {
  const i18n = useI18n();
  const initialID = props.draftID;
  const requestID = crypto.randomUUID();
  const [draft, setDraft] = createSignal<PluginDraft>();
  const [loading, setLoading] = createSignal(initialID !== 'new');
  const [saving, setSaving] = createSignal(false);
  const [composerSaving, setComposerSaving] = createSignal(false);
  const [composerSaved, setComposerSaved] = createSignal(false);
  const [renameOpen, setRenameOpen] = createSignal(false);
  const [name, setName] = createSignal('');
  const [error, setError] = createSignal('');
  const [reference, setReference] = createSignal(props.referenceThreadID);
  const [snapshot, setSnapshot] = createSignal<AuthorSnapshot>();
  const [narrow, setNarrow] = createSignal(false);
  const [tab, setTab] = createSignal<'conversation' | 'preview'>('conversation');
  const [accessOpen, setAccessOpen] = createSignal(false);
  const [checks, setChecks] = createSignal(false);
  const [deleteOpen, setDeleteOpen] = createSignal(false);
  const [deleting, setDeleting] = createSignal(false);
  const [applying, setApplying] = createSignal(false);
  const [leaving, setLeaving] = createSignal(false);
  const [previewClosed, setPreviewClosed] = createSignal(false);
  const [review, setReview] = createSignal<ExternalPluginInspection>();
  const [reviewArtifact, setReviewArtifact] = createSignal('');
  const [install, setInstall] = createSignal<AuthorInstallOperation>();
  const [installing, setInstalling] = createSignal(false);
  const [reviewing, setReviewing] = createSignal(false);
  let createPending: Promise<PluginDraft> | undefined;
  let previewClose: (() => Promise<boolean>) | null = null;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const [activeInstallRequest, setActiveInstallRequest] = createSignal('');
  const [installAbsent, setInstallAbsent] = createSignal(false);
  let installTimer: ReturnType<typeof setTimeout> | undefined;
  let observingInstall = false;
  let refreshPending: Promise<void> | undefined;
  let snapshotRevision = 0;
  let notifiedInstall = '';
  const installationUnsettled = () =>
    installing() ||
    (Boolean(activeInstallRequest()) && !installAbsent() && (!install() || install()?.mutation_outcome === 'unknown'));
  const currentInstalled = () =>
    install()?.mutation_outcome === 'committed' &&
    install()?.execution.status === 'completed' &&
    draft()?.install_artifact_id === currentArtifact()?.artifact_id;
  let latestComposer: FlowerComposerDraftSnapshot | undefined;
  let composerRevision = 0;
  let saveChain = Promise.resolve();
  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  const persistComposer = (): Promise<void> => {
    const id = draft()?.id;
    const current = latestComposer;
    if (!id || !current) return Promise.resolve();
    try {
      const value = props.draftCoordinator.snapshotForRestart(current.scope_id);
      const revision = composerRevision;
      setComposerSaving(true);
      saveChain = saveChain.catch(() => {}).then(() => savePluginComposer(id, value));
      const pending = saveChain;
      void pending.then(
        () => {
          if (!disposed && pending === saveChain && revision === composerRevision) {
            setComposerSaved(true);
            setComposerSaving(false);
          }
        },
        (e) => {
          if (!disposed && pending === saveChain && revision === composerRevision) {
            setComposerSaved(false);
            setComposerSaving(false);
          }
          fail(e);
        },
      );
      return pending;
    } catch (e) {
      setComposerSaved(false);
      setComposerSaving(false);
      saveChain = Promise.reject(e);
      void saveChain.catch(fail);
      return saveChain;
    }
  };
  const composerChanged = (value: FlowerComposerDraftSnapshot) => {
    composerRevision++;
    latestComposer = value;
    setComposerSaved(false);
    setComposerSaving(
      Boolean(draft() || value.value.text || value.value.attachments.length || value.value.references.length),
    );
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(persistComposer, 250);
  };
  const fail = (e: unknown) => {
    if (!disposed) setError(e instanceof Error ? e.message : String(e));
  };
  const title = () => draft()?.title || i18n.t('uiCopy.plugin.creation.untitled');
  const ensureDraft = (): Promise<PluginDraft> => {
    if (initialID !== 'new' && !draft()) return Promise.reject(new Error(i18n.t('uiCopy.plugin.creation.saveFailed')));
    if (draft()?.lifecycle === 'active') return Promise.resolve(draft()!);
    if (!createPending) {
      setSaving(true);
      setError('');
      createPending = createPluginDraft(requestID)
        .then((value) => {
          if (value.lifecycle !== 'active') throw new Error(i18n.t('uiCopy.plugin.creation.saveFailed'));
          setDraft(value);
          if (!disposed) props.onSaved(value.id);
          persistComposer();
          return value;
        })
        .catch((e) => {
          createPending = undefined;
          fail(e);
          throw e;
        })
        .finally(() => setSaving(false));
    }
    return createPending;
  };
  const context = (direct = false): ContextActionEnvelope => ({
    schema_version: CONTEXT_ACTION_SCHEMA_VERSION,
    action_id: 'assistant.ask.flower',
    provider: 'flower',
    target: { target_id: 'current', locality: 'auto' },
    source: { surface: 'flower_composer' },
    presentation: { label: i18n.t('uiCopy.plugin.creationTitle'), priority: 100 },
    context: [
      {
        kind: 'text_snapshot',
        title: 'Plugin creation workspace',
        content: direct
          ? 'Begin implementation from the conversation and this submission. Read the redeven-plugin-authoring skill, then use plugin_author.status to resolve the dedicated workspace. Use ordinary approved tools for source changes and dependency installation, then plugin_author.build. Installation and permission grants require the user review in the workspace.'
          : 'This is a dedicated plugin draft conversation. Read the redeven-plugin-authoring skill and plugin_author.status before editing. Discuss requirements or implement as requested. Use the managed source directory and plugin_author.build; the workspace shows retained artifacts and handles preview and installation review.',
      },
      ...(reference()
        ? [
            {
              kind: 'text_snapshot' as const,
              title: 'Reference conversation',
              content: `The user referenced conversation ${reference()}. Consult it through the normal authorized thread tools when relevant; it remains a separate conversation.`,
            },
          ]
        : []),
    ],
  });
  const currentArtifact = createMemo(() =>
    snapshot()?.artifacts.find((a) => a.artifact_id === snapshot()?.preview.artifact_id),
  );
  const pendingArtifact = createMemo(() => {
    const latest = snapshot()?.artifacts[0];
    return latest?.artifact_id !== snapshot()?.preview.artifact_id ? latest : undefined;
  });
  const preview = createMemo<
    { generation: number; artifactID?: string; target: PluginSurfaceLaunchTarget } | undefined
  >(
    () => {
      if (previewClosed()) return undefined;
      const record = snapshot()?.plugins.find((p) => p.plugin_instance_id === snapshot()?.preview.plugin_instance_id);
      const surface = record?.manifest.surfaces.find((s) => s.kind === 'view');
      return record && surface
        ? {
            generation: snapshot()!.preview.generation,
            artifactID: snapshot()!.preview.artifact_id,
            target: {
              pluginID: record.plugin_id,
              pluginInstanceID: record.plugin_instance_id,
              surfaceID: surface.surface_id,
              displayName: record.manifest.plugin.display_name,
              expectedManagementRevision: record.management_revision,
            },
          }
        : undefined;
    },
    undefined,
    { equals: (a, b) => JSON.stringify(a) === JSON.stringify(b) },
  );
  const refresh = (): Promise<void> => {
    const id = draft()?.workspace_id;
    if (!id || disposed || !props.visible || draft()?.lifecycle !== 'active' || applying() || leaving() || deleting()) return Promise.resolve();
    if (refreshPending) return refreshPending;
    const revision = snapshotRevision;
    refreshPending = (async () => {
      const value = await authorStatus(id);
      if (disposed || snapshotRevision !== revision || draft()?.lifecycle !== 'active') return;
      setSnapshot(value);
      setPreviewClosed(false);
      if (!value.preview.artifact_id && value.artifacts[0] && !applying()) {
        setApplying(true);
        try {
          const next = await applyAuthorArtifact(id, value.artifacts[0].artifact_id);
          if (!disposed && snapshotRevision === revision && draft()?.lifecycle === 'active') setSnapshot(next);
        } finally {
          setApplying(false);
        }
      }
    })().finally(() => {
      refreshPending = undefined;
    });
    return refreshPending;
  };
  const schedule = () => {
    if (disposed) return;
    timer = setTimeout(async () => {
      try {
        await refresh();
      } catch (e) {
        fail(e);
      } finally {
        schedule();
      }
    }, 2500);
  };
  const loadDraft = async () => {
    setLoading(true);
    try {
      const found = await getPluginDraft(initialID);
      if (disposed) return;
      const value = found.lifecycle === 'preparing' || found.launch_pending ? await resumePluginDraft(found.id) : found;
      if (disposed) return;
      setDraft(value);
      if (value.lifecycle === 'deleting') {
        await remove();
        return;
      }
      if (value.install_request_id) {
        setActiveInstallRequest(value.install_request_id);
        void observeInstall(value.install_request_id).catch(fail);
      }
      if (value.lifecycle === 'active') {
        const saved = await loadPluginComposer(value.id);
        if (saved && !disposed)
          props.draftCoordinator.restoreDraft({
            ...saved,
            scope_id: value.thread_id || `__new_thread__:plugin-creation:${initialID}`,
          });
      }
    } catch (e) {
      fail(e);
    } finally {
      setLoading(false);
    }
  };

  const preventUnsavedDocumentExit = (event: BeforeUnloadEvent) => {
    if (!latestComposer || composerSaved() || (!draft() && !createPending && !latestComposer.value.text
      && !latestComposer.value.attachments.length && !latestComposer.value.references.length)) return;
    event.preventDefault();
    event.returnValue = '';
    void persistComposer().catch(fail);
  };
  onMount(() => {
    window.addEventListener('beforeunload', preventUnsavedDocumentExit);
    props.onNavigationReady?.(async commit => {
      try { return await navigateFromPreview(commit); } catch (error) { fail(error); return false; }
    });
    const media = window.matchMedia('(max-width: 720px)');
    const syncViewport = () => setNarrow(media.matches);
    syncViewport();
    media.addEventListener('change', syncViewport);
    onCleanup(() => media.removeEventListener('change', syncViewport));
    if (initialID !== 'new') void loadDraft();
    window.addEventListener('pagehide', persistComposer);
    schedule();
  });
  onCleanup(() => {
    window.removeEventListener('beforeunload', preventUnsavedDocumentExit);
    props.onNavigationReady?.(undefined);
    window.removeEventListener('pagehide', persistComposer);
    if (saveTimer) clearTimeout(saveTimer);
    persistComposer();
    disposed = true;
    if (timer) clearTimeout(timer);
    if (installTimer) clearTimeout(installTimer);
  });
  createEffect(() => {
    if (draft()?.workspace_id && props.visible) void untrack(refresh).catch(fail);
  });
  const apply = async () => {
    const id = draft()?.workspace_id;
    const next = pendingArtifact();
    if (!id || !next || applying() || installationUnsettled()) return;
    snapshotRevision++;
    setApplying(true);
    setError('');
    try {
      if (previewClose && !(await previewClose())) return;
      setPreviewClosed(true);
      setReview(undefined);
      setSnapshot(await applyAuthorArtifact(id, next.artifact_id));
      setPreviewClosed(false);
    } catch (e) {
      fail(e);
    } finally {
      setApplying(false);
      if (previewClosed()) await refresh().catch(fail);
    }
  };
  const inspect = async () => {
    const id = draft()?.workspace_id;
    const artifact = currentArtifact();
    if (!id || !artifact || !props.canManage || applying() || previewClosed() || installationUnsettled()) return;
    setReviewing(true);
    setError('');
    try {
      const value = await inspectAuthorArtifact(id, artifact.artifact_id);
      setReviewArtifact(artifact.artifact_id);
      setReview(value);
      const current = draft();
      if (current) setDraft(await getPluginDraft(current.id));
    } catch (e) {
      fail(e);
    } finally {
      setReviewing(false);
    }
  };
  const observeInstall = async (request: string) => {
    const id = draft()?.workspace_id;
    if (!id || disposed || observingInstall) return;
    observingInstall = true;
    try {
      if (installTimer) clearTimeout(installTimer);
      const value = await queryAuthorInstall(id, request);
      if (disposed) return;
      setInstall(value);
      setInstallAbsent(false);
      const current = draft();
      if (current) setDraft(await getPluginDraft(current.id));
      if (value.execution.status === 'completed' && value.mutation_outcome === 'committed') {
        setReview(undefined);
        if (notifiedInstall !== request) {
          try {
            await props.onInstalled(value.execution.plugin_instance_id);
            notifiedInstall = request;
          } catch {
            throw new Error(i18n.t('uiCopy.plugin.creation.inventoryFailed'));
          }
        }
      } else if (['queued', 'running', 'pending'].includes(value.execution.status)) {
        installTimer = setTimeout(() => void observeInstall(request).catch(fail), 1500);
      } else throw new Error(value.execution.error?.message ?? value.execution.failure_code ?? value.execution.status);
    } catch (e) {
      if ((e as { code?: string }).code === 'execution_not_found') {
        setInstallAbsent(true);
        setInstall(undefined);
      }
      throw e;
    } finally {
      observingInstall = false;
    }
  };
  const commit = async () => {
    const value = draft();
    const checked = review();
    if (!value?.workspace_id || !checked || !props.canManage || applying() || previewClosed() || installationUnsettled()) return;
    if (reviewArtifact() !== currentArtifact()?.artifact_id) {
      setReview(undefined);
      return;
    }
    const existing =
      value.install_inspection_id === checked.inspection_id && value.install_artifact_id === reviewArtifact();
    const request = existing ? value.install_request_id! : crypto.randomUUID();
    setInstalling(true);
    setError('');
    try {
      setActiveInstallRequest(request);
      setInstallAbsent(false);
      setInstall(
        await installAuthorArtifact(
          value.workspace_id,
          reviewArtifact(),
          checked.inspection_id,
          request,
          value.revision,
        ),
      );
      setDraft(await getPluginDraft(value.id));
      await observeInstall(request);
    } catch (e) {
      fail(e);
      try {
        const current = await getPluginDraft(value.id);
        setDraft(current);
        setActiveInstallRequest(current.install_request_id ?? '');
        if (current.install_request_id) await observeInstall(current.install_request_id);
      } catch (recoveryError) {
        fail(recoveryError);
      }
    } finally {
      setInstalling(false);
    }
  };
  const retry = async () => {
    setError('');
    if (!draft() && initialID === 'new') {
      await ensureDraft();
      await persistComposer();
      await refresh();
      return;
    }
    if (!draft() && initialID !== 'new') {
      await loadDraft();
      return;
    }
    const value = draft();
    if (value?.lifecycle === 'deleting') {
      await remove();
      return;
    }
    if (value?.install_request_id && installAbsent() && value.workspace_id) {
      setInstalling(true);
      try {
        setInstall(
          await installAuthorArtifact(
            value.workspace_id,
            value.install_artifact_id!,
            value.install_inspection_id!,
            value.install_request_id,
            value.revision,
          ),
        );
        setInstallAbsent(false);
        await observeInstall(value.install_request_id);
      } catch (e) {
        if ((e as { mutationOutcome?: string }).mutationOutcome === 'not_committed') {
          setInstalling(false);
          await inspect();
        } else throw e;
      } finally {
        setInstalling(false);
      }
    } else if (install()?.request_id === activeInstallRequest() && install()?.mutation_outcome === 'not_committed') {
      await inspect();
    } else if (activeInstallRequest()) {
      try {
        await observeInstall(activeInstallRequest());
      } catch (e) {
        if (installAbsent() || (install()?.request_id === activeInstallRequest() && install()?.mutation_outcome === 'not_committed')) {
          await inspect();
        } else throw e;
      }
    } else {
      await persistComposer();
      await refresh();
    }
  };
  const rename = async () => {
    if (saving() || deleting()) return;
    setSaving(true);
    try {
      const value = draft() ?? await ensureDraft();
      setSaving(true);
      setDraft(await renamePluginDraft(value, name()));
      setRenameOpen(false);
    } catch (e) {
      fail(e);
    } finally {
      setSaving(false);
    }
  };
  const navigateFromPreview = async (navigate: () => unknown): Promise<boolean> => {
    if (applying() || leaving() || deleting()) return false;
    setLeaving(true);
    try {
      if (previewClose && !(await previewClose())) return false;
      snapshotRevision++;
      setPreviewClosed(true);
      if (!draft() && (createPending || latestComposer && (latestComposer.value.text
        || latestComposer.value.attachments.length || latestComposer.value.references.length))) await ensureDraft();
      await persistComposer();
      await navigate();
      return true;
    } finally {
      setLeaving(false);
      if (!disposed && previewClosed()) {
        await refreshPending?.catch(fail);
        await refresh().catch(fail);
      }
    }
  };
  const leave = () => navigateFromPreview(props.onBack);
  const remove = async () => {
    if (deleting()) return;
    let value = draft();
    if (!value && !createPending) {
      props.onBack();
      return;
    }
    snapshotRevision++;
    setDeleting(true);
    setError('');
    try {
      if (!value) value = await createPending!;
      if (previewClose && !(await previewClose())) return;
      setPreviewClosed(true);
      await refreshPending?.catch(() => {});
      const result = await deletePluginDraft(value);
      setDraft(result);
      if (result.lifecycle === 'deleted') {
        if (saveTimer) clearTimeout(saveTimer);
        latestComposer = undefined;
        await saveChain.catch(() => {});
        await removePluginComposer(value.id);
        props.onBack();
      }
    } catch (e) {
      fail(e);
      try {
        if (value) setDraft(await getPluginDraft(value.id));
      } catch (readError) {
        fail(readError);
      }
    } finally {
      setDeleting(false);
      if (!disposed && previewClosed() && draft()?.lifecycle === 'active') await refresh().catch(fail);
    }
  };
  const renderConversation = (parts: FlowerConversationParts) => (
    <div class="plugin-creation-flower-surface" data-plugin-creation-flower>
      <div class="plugin-creation-flower-conversation">{parts.conversation}</div>
      <div class="plugin-creation-flower-composer">
        {parts.composer}
        <Show when={parts.actionLayout() === 'chat'}>
          <div class="plugin-creation-submit-intents">
            <Button
              size="sm"
              variant="ghost"
              disabled={!parts.canSubmit(parts.threadID() ? i18n.t('uiCopy.plugin.creation.directPrompt') : undefined)}
              onClick={() =>
                void parts.submit({
                  fallbackPrompt: parts.threadID() ? i18n.t('uiCopy.plugin.creation.directPrompt') : undefined,
                  context: context(true),
                })
              }
            >
              <Wand class="h-3.5 w-3.5" />
              {i18n.t('uiCopy.plugin.creation.direct')}
            </Button>
          </div>
        </Show>
      </div>
    </div>
  );
  return (
    <section
      class="redeven-plugin-creation-page"
      data-plugin-creation-page
      data-plugin-creation-workspace
      data-project-id={draft()?.id ?? ''}
      data-thread-id={draft()?.thread_id ?? ''}
    >
      <header class="plugin-creation-toolbar">
        <Button
          size="icon"
          variant="ghost"
          class="h-8 w-8"
          disabled={leaving() || applying()}
          onClick={() => void leave().catch(fail)}
          aria-label={i18n.t('uiCopy.plugin.backToCenter')}
        >
          <ArrowLeft class="h-4 w-4" />
        </Button>
        <h1 class="min-w-0 flex-1 truncate text-[13px] font-medium">
          {draft() ? title() : i18n.t('uiCopy.plugin.creationTitle')}
        </h1>
        <span class="hidden text-[11px] text-muted-foreground sm:block" role="status">
          {saving() || composerSaving()
            ? i18n.t('uiCopy.plugin.creation.saving')
            : draft() && composerSaved()
              ? i18n.t('uiCopy.plugin.creation.saved')
              : ''}
        </span>
        <Show
          when={currentInstalled() && props.onOpenInstalled}
          fallback={
            <Button
              size="sm"
              disabled={
                !props.canManage || !currentArtifact() || reviewing() || applying() || previewClosed() || installationUnsettled() || currentInstalled()
              }
              onClick={() => void inspect()}
            >
              {currentInstalled()
                ? i18n.t('uiCopy.plugin.creation.installed')
                : i18n.t('uiCopy.plugin.creation.install')}
            </Button>
          }
        >
          <Button
            size="sm"
            disabled={applying() || previewClosed() || leaving()}
            onClick={() =>
              void navigateFromPreview(() => props.onOpenInstalled?.(install()!.execution.plugin_instance_id)).catch(fail)
            }
          >
            {i18n.t('common.actions.open')}
          </Button>
        </Show>
        <Dropdown
          items={[
            { id: 'rename', label: i18n.t('uiCopy.plugin.creation.rename') },
            { id: 'delete', label: i18n.t('uiCopy.plugin.creation.deleteDraft') },
          ]}
          onSelect={(id) => {
            if (id === 'rename') {
              setName(draft()?.title ?? '');
              setRenameOpen(true);
            } else setDeleteOpen(true);
          }}
          triggerAriaLabel={i18n.t('common.actions.more')}
          triggerClass="inline-flex h-8 w-8 items-center justify-center rounded-control hover:bg-[var(--floe-state-hover)]"
          trigger={<MoreHorizontal class="h-4 w-4" />}
        />
      </header>
      <Show when={error()}>
        <div role="alert" class="flex shrink-0 items-center gap-2 border-b px-3 py-2 text-xs text-destructive">
          <span class="min-w-0 flex-1 break-words">{error()}</span>
          <Button size="sm" variant="ghost" onClick={() => void retry().catch(fail)}>
            {i18n.t('uiCopy.plugin.creation.retry')}
          </Button>
        </div>
      </Show>
      <Show when={reference()}>
        <div class="flex items-center gap-2 border-b px-3 py-1 text-xs text-muted-foreground">
          <span>{i18n.t('uiCopy.plugin.creation.reference')}</span>
          <Button variant="ghost" size="sm" onClick={() => setReference(undefined)}>
            {i18n.t('uiCopy.plugin.creation.removeReference')}
          </Button>
        </div>
      </Show>
      <Tabs
        class="plugin-creation-mobile-tabs"
        activeId={tab()}
        onChange={(id) => setTab(id as 'conversation' | 'preview')}
        slotClassNames={{ scrollContainer: 'grid grid-cols-2 w-full', tab: 'min-h-[44px] justify-center' }}
        ariaLabel={i18n.t('uiCopy.plugin.creationTitle')}
        size="sm"
        features={{ scrollButtons: 'never', closeButton: { enabledByDefault: false } }}
        items={(['conversation', 'preview'] as const).map((id) => ({
          id,
          label: i18n.t(`uiCopy.plugin.creation.${id}`),
          domId: `plugin-creation-tab-${id}`,
          panelId: `plugin-creation-panel-${id}`,
        }))}
      />
      <div class="plugin-creation-workspace-body" data-active-tab={tab()}>
        <section
          id="plugin-creation-panel-conversation"
          role={narrow() ? 'tabpanel' : undefined}
          aria-labelledby={narrow() ? 'plugin-creation-tab-conversation' : undefined}
          class="plugin-creation-main"
          inert={leaving() || deleting()}
          aria-busy={leaving() || deleting()}
          aria-label={i18n.t('uiCopy.plugin.creation.conversation')}
        >
          <Show
            when={!loading() && ((initialID === 'new' && !draft()) || draft()?.lifecycle === 'active')}
            fallback={
              <div class="m-auto text-xs text-muted-foreground">
                <Show when={loading() || deleting()} fallback={error()}>
                  <Refresh class="h-4 w-4 animate-spin" />
                </Show>
              </div>
            }
          >
            <Suspense fallback={<div class="m-auto text-muted-foreground" role="status" aria-label={i18n.t('uiCopy.plugin.creation.conversation')}><Refresh class="h-4 w-4 animate-spin" aria-hidden="true" /></div>}>
            {props.renderFlower({
              prepareTurnRoute: async () =>
                `${pluginCreationAPI}/drafts/${encodeURIComponent((await ensureDraft()).id)}/turns`,
              embeddedConversation: {
                scope: `plugin-creation:${initialID === 'new' ? requestID : initialID}`,
                threadID: draft()?.thread_id,
                placeholder: i18n.t('uiCopy.plugin.flowerCreationPlaceholder'),
                contextAction: context(),
                emptyContent: (
                  <div class="plugin-creation-welcome">
                    <Wand class="h-6 w-6 text-primary" />
                    <h2>{i18n.t('uiCopy.plugin.creation.question')}</h2>
                  </div>
                ),
                onDraftChange: composerChanged,
                onDraftPresence: (present) => {
                  if (present && !draft()) void ensureDraft().catch(fail);
                },
                onAccepted: () => {
                  const id = draft()?.id;
                  if (id) void getPluginDraft(id).then(setDraft).catch(fail);
                },
                render: renderConversation,
              },
            })}
            </Suspense>
          </Show>
        </section>
        <section
          id="plugin-creation-panel-preview"
          role={narrow() ? 'tabpanel' : undefined}
          aria-labelledby={narrow() ? 'plugin-creation-tab-preview' : undefined}
          class="plugin-creation-preview"
          aria-label={i18n.t('uiCopy.plugin.creation.preview')}
        >
          <div class="plugin-creation-section-header">
            <span>{i18n.t('uiCopy.plugin.creation.preview')}</span>
            <span class="min-w-0 flex-1 truncate text-[11px] text-muted-foreground">{currentArtifact()?.version}</span>
            <Show when={pendingArtifact() && currentArtifact()}>
              <Button
                size="sm"
                variant="secondary"
                disabled={applying() || installationUnsettled()}
                onClick={() => void apply()}
              >
                {i18n.t('uiCopy.plugin.creation.apply')}
              </Button>
            </Show>
            <Show when={snapshot()?.preview.plugin_instance_id}>
              <Button size="sm" variant="ghost" onClick={() => setAccessOpen(true)}>
                {i18n.t('uiCopy.plugin.external.permissions')}
              </Button>
            </Show>
            <Button variant="ghost" size="sm" onClick={() => setChecks(!checks())}>
              {i18n.t('uiCopy.plugin.creation.checks')}
            </Button>
          </div>
          <Show when={checks()}>
            <div class="plugin-creation-checks">
              <Show when={snapshot()?.build?.status === 'running'}>
                <p role="status" class="mb-2 text-muted-foreground">
                  {i18n.t('uiCopy.plugin.creation.building')}
                </p>
              </Show>
              <For each={snapshot()?.build?.stages ?? snapshot()?.artifacts[0]?.stages ?? []}>
                {(stage) => (
                  <div>
                    <Show
                      when={stage.status === 'passed'}
                      fallback={<AlertTriangle class="h-3 w-3 text-muted-foreground" />}
                    >
                      <Check class="h-3 w-3" />
                    </Show>
                    <span>{stage.name}</span>
                    <span>
                      {i18n.t(
                        stage.status === 'passed'
                          ? 'uiCopy.plugin.creation.passed'
                          : stage.status === 'failed'
                            ? 'uiCopy.plugin.creation.failed'
                            : 'uiCopy.plugin.creation.not_run',
                      )}
                    </span>
                  </div>
                )}
              </For>
              <Show when={snapshot()?.build?.error}>
                <p class="mt-2 break-words text-destructive">{snapshot()?.build?.error}</p>
              </Show>
              <Show when={snapshot()?.build?.commands.length}>
                <details class="mt-2">
                  <summary class="cursor-pointer rounded-sm py-1 text-muted-foreground focus-visible:outline-2 focus-visible:outline-ring">
                    {i18n.t('shellBlock.output')}
                  </summary>
                  <For each={snapshot()?.build?.commands}>
                    {(command) => (
                      <section class="mt-2">
                        <code class="block whitespace-pre-wrap break-all text-muted-foreground">
                          {command.arguments.join(' ')}
                        </code>
                        <pre class="mt-1 whitespace-pre-wrap break-words font-mono text-[11px]">{command.output}</pre>
                        <Show when={command.truncated}>
                          <p class="mt-1 text-muted-foreground">
                            {i18n.t('flowerTurnLauncher.preview.showingPartialContent')}
                          </p>
                        </Show>
                      </section>
                    )}
                  </For>
                </details>
              </Show>
            </div>
          </Show>
          <div class="plugin-creation-preview-content">
            <Show
              when={preview()}
              keyed
              fallback={
                <div class="plugin-creation-empty-preview">
                  <Wand class="h-7 w-7 opacity-35" />
                  <p>{i18n.t('uiCopy.plugin.creation.emptyPreview')}</p>
                </div>
              }
            >
              {(value) => (
                <PluginAuthorPreview
                  workspaceID={draft()!.workspace_id!}
                  target={value.target}
                  refreshInventory={async () => {
                    await refresh();
                    return true;
                  }}
                  centerEntry={props.centerEntry}
                  visible={props.visible && (!narrow() || tab() === 'preview')}
                  onError={fail}
                  registerClose={(close) => {
                    previewClose = close;
                  }}
                />
              )}
            </Show>
          </div>
        </section>
      </div>
      <Dialog open={accessOpen()} onOpenChange={setAccessOpen} title={i18n.t('uiCopy.plugin.external.permissions')}>
        <Show when={accessOpen() && snapshot()?.preview.plugin_instance_id}>
          {(id) => (
            <PluginAuthorAccess
              workspaceID={draft()!.workspace_id!}
              pluginInstanceID={id() as string}
              canManage={Boolean(props.canManage)}
              onChanged={refresh}
              onError={fail}
            />
          )}
        </Show>
      </Dialog>
      <Dialog open={renameOpen()} onOpenChange={setRenameOpen} title={i18n.t('uiCopy.plugin.creation.rename')}>
        <form
          class="space-y-3 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            void rename();
          }}
        >
          <Input
            class="h-8 w-full text-[13px]"
            aria-label={i18n.t('uiCopy.plugin.creation.rename')}
            value={name()}
            maxLength={120}
            onInput={(e) => setName(e.currentTarget.value)}
            autofocus
          />
          <Button type="submit" size="sm" disabled={saving()}>
            {i18n.t('common.actions.save')}
          </Button>
        </form>
      </Dialog>
      <ConfirmDialog
        open={deleteOpen()}
        onOpenChange={setDeleteOpen}
        title={i18n.t('uiCopy.plugin.creation.deleteTitle')}
        bodyDescription={i18n.t('uiCopy.plugin.creation.deleteBody')}
        confirmText={i18n.t('uiCopy.plugin.creation.deleteDraft')}
        loading={deleting()}
        variant="destructive"
        onConfirm={() => void remove()}
      />
      <Dialog
        open={Boolean(review())}
        onOpenChange={(open) => {
          if (!open && !installing()) {
            setReview(undefined);
          }
        }}
        title={i18n.t('uiCopy.plugin.creation.review')}
      >
        <Show when={review()}>
          {(value) => (
            <InspectionReview
              inspection={value()}
              operation={value().intent.action === 'update' ? 'update' : 'install'}
            />
          )}
        </Show>
        <Show when={pendingArtifact()}>
          <p class="my-3 text-xs text-muted-foreground">{i18n.t('uiCopy.plugin.creation.changesNotice')}</p>
        </Show>
        <Button class="mt-4 w-full" disabled={applying() || previewClosed() || installationUnsettled()} onClick={() => void commit()}>
          {installing()
            ? i18n.t('uiCopy.plugin.creation.installUnknown')
            : i18n.t('uiCopy.plugin.creation.confirmInstall')}
        </Button>
      </Dialog>
    </section>
  );
}

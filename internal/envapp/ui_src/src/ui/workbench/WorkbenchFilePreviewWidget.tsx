import { Show, createEffect, createSignal, onCleanup, untrack } from 'solid-js';
import { useNotification } from '@floegence/floe-webapp-core';
import type { FileItem } from '@floegence/floe-webapp-core/file-browser';
import type { WorkbenchWidgetBodyProps } from '@floegence/floe-webapp-core/workbench';
import { useProtocol } from '@floegence/floe-webapp-protocol';
import { Button } from '@floegence/floe-webapp-core/ui';

import { useRedevenRpc } from '../protocol/redeven_v1';
import { useEnvContext } from '../pages/EnvContext';
import { useDownloadManager } from '../downloads/DownloadContext';
import { buildFilePreviewDownloadCommand } from '../downloads/downloadCommands';
import { writeTextToClipboard } from '../utils/clipboard';
import { buildFilePreviewAskFlowerIntent } from '../utils/filePreviewAskFlower';
import { FilePreviewPanel } from '../widgets/FilePreviewPanel';
import { createFilePreviewController } from '../widgets/createFilePreviewController';
import { useEnvWorkbenchInstancesContext } from './EnvWorkbenchInstancesContext';
import type { RuntimeWorkbenchPreviewItem } from './runtimeWorkbenchLayout';
import { useI18n } from '../i18n';

type PreviewOpenIntentSource =
  | 'direct_request'
  | 'shared_state'
  | 'pending_synced_user_action';

type PreviewFileLike = Readonly<{
  id?: string;
  type?: string;
  path?: string;
  name?: string;
  size?: number;
}>;

type PreviewOpenIntent = Readonly<{
  key: string;
  item: FileItem;
  source: PreviewOpenIntentSource;
  requestId?: string;
}>;

type PreviewOpenLifecycle =
  | Readonly<{ phase: 'idle' }>
  | Readonly<{ phase: 'hydrating'; key: string; requestIds: readonly string[] }>
  | Readonly<{ phase: 'hydrated'; key: string }>
  | Readonly<{ phase: 'blocked_by_dirty_draft'; key: string }>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function previewOpenIntentKey(item: PreviewFileLike | null | undefined): string {
  const path = compact(item?.path);
  if (!path) {
    return '';
  }
  return [
    path,
    compact(item?.name),
    typeof item?.size === 'number' ? String(item.size) : '',
  ].join('\u0000');
}

function normalizePreviewIntentFromFileItem(
  item: PreviewFileLike | null | undefined,
  source: PreviewOpenIntentSource,
  requestId?: string,
): PreviewOpenIntent | null {
  if (!item || item.type !== 'file') {
    return null;
  }
  const path = compact(item.path);
  if (!path) {
    return null;
  }
  const normalizedItem: FileItem = {
    ...item,
    id: compact(item.id) || path,
    type: 'file',
    path,
    name: compact(item.name) || path,
  };
  const key = previewOpenIntentKey(normalizedItem);
  if (!key) {
    return null;
  }
  const normalizedRequestId = compact(requestId);
  return {
    key,
    item: normalizedItem,
    source,
    ...(normalizedRequestId ? { requestId: normalizedRequestId } : {}),
  };
}

function runtimePreviewItemFromFileItem(item: FileItem): RuntimeWorkbenchPreviewItem {
  return {
    id: compact(item.id) || item.path,
    type: 'file',
    path: item.path,
    name: compact(item.name) || item.path,
    ...(typeof item.size === 'number' ? { size: item.size } : {}),
  };
}

function appendRequestId(requestIds: readonly string[], requestId: string | undefined): readonly string[] {
  const normalizedRequestId = compact(requestId);
  if (!normalizedRequestId || requestIds.includes(normalizedRequestId)) {
    return requestIds;
  }
  return [...requestIds, normalizedRequestId];
}

export function WorkbenchFilePreviewWidget(props: WorkbenchWidgetBodyProps) {
  const notification = useNotification();
  const i18n = useI18n();
  const protocol = useProtocol();
  const rpc = useRedevenRpc();
  const env = useEnvContext();
  const downloads = useDownloadManager();
  const workbench = useEnvWorkbenchInstancesContext();
  const controller = createFilePreviewController({
    client: () => protocol.client(),
    rpc: () => rpc,
    canWrite: () => Boolean(env.env()?.permissions?.can_write),
    onSaved: (path) => {
      notification.success(i18n.t('filePreview.savedTitle'), i18n.t('filePreview.savedMessage', { path }));
    },
    onSaveError: (path, message) => {
      notification.error(i18n.t('filePreview.saveFailedTitle'), i18n.t('filePreview.saveFailedMessage', { path, message }));
    },
  });
  const [openLifecycle, setOpenLifecycle] = createSignal<PreviewOpenLifecycle>({ phase: 'idle' });
  const [dismissedSyncedPreviewKey, setDismissedSyncedPreviewKey] = createSignal('');
  const [pendingWidgetRemoval, setPendingWidgetRemoval] = createSignal(false);
  const pendingSyncedItem = () => workbench.pendingSyncedPreviewItem(props.widgetId);
  const consumedPreviewOpenRequestIds = new Set<string>();

  const clearPendingSyncedPreviewItem = (key: string) => {
    const pendingItem = untrack(pendingSyncedItem);
    if (!pendingItem || previewOpenIntentKey(pendingItem) !== key) {
      return;
    }
    workbench.setPendingSyncedPreviewItem(props.widgetId, null);
    setDismissedSyncedPreviewKey('');
  };

  const markIntentAccepted = (intent: PreviewOpenIntent) => {
    const lifecycle = openLifecycle();
    if (lifecycle.phase === 'hydrating' && lifecycle.key === intent.key) {
      if (intent.requestId) {
        setOpenLifecycle((current) => (
          current.phase === 'hydrating' && current.key === intent.key
            ? { ...current, requestIds: appendRequestId(current.requestIds, intent.requestId) }
            : current
        ));
      }
      clearPendingSyncedPreviewItem(intent.key);
      return true;
    }
    if (lifecycle.phase === 'hydrated' && lifecycle.key === intent.key) {
      clearPendingSyncedPreviewItem(intent.key);
      return true;
    }
    if (
      lifecycle.phase === 'blocked_by_dirty_draft'
      && lifecycle.key === intent.key
      && intent.source !== 'pending_synced_user_action'
    ) {
      if (
        intent.source === 'shared_state'
        || previewOpenIntentKey(untrack(pendingSyncedItem)) === intent.key
        || untrack(dismissedSyncedPreviewKey) === intent.key
      ) {
        return true;
      }
    }
    return false;
  };

  const markHydratedFromControllerItem = (key: string) => {
    if (!key) {
      return;
    }
    setOpenLifecycle((current) => (
      current.phase === 'hydrated' && current.key === key
        ? current
        : { phase: 'hydrated', key }
    ));
    clearPendingSyncedPreviewItem(key);
  };

  const startPreviewHydration = (intent: PreviewOpenIntent) => {
    setOpenLifecycle({
      phase: 'hydrating',
      key: intent.key,
      requestIds: appendRequestId([], intent.requestId),
    });
    void controller.openPreview(intent.item)
      .then(() => {
        const currentKey = previewOpenIntentKey(controller.item());
        if (currentKey === intent.key) {
          markHydratedFromControllerItem(intent.key);
          return;
        }
        setOpenLifecycle((current) => (
          current.phase === 'hydrating' && current.key === intent.key
            ? { phase: 'idle' }
            : current
        ));
      })
      .catch(() => {
        setOpenLifecycle((current) => (
          current.phase === 'hydrating' && current.key === intent.key
            ? { phase: 'idle' }
            : current
        ));
      });
  };

  const openPreviewIntent = (intent: PreviewOpenIntent) => {
    if (markIntentAccepted(intent)) {
      return;
    }
    if (controller.open() && previewOpenIntentKey(controller.item()) === intent.key) {
      markHydratedFromControllerItem(intent.key);
      return;
    }
    if (intent.source === 'shared_state' && controller.dirty()) {
      setOpenLifecycle((current) => (
        current.phase === 'blocked_by_dirty_draft' && current.key === intent.key
          ? current
          : { phase: 'blocked_by_dirty_draft', key: intent.key }
      ));
      if (dismissedSyncedPreviewKey() !== intent.key) {
        workbench.setPendingSyncedPreviewItem(props.widgetId, runtimePreviewItemFromFileItem(intent.item));
      }
      return;
    }
    setDismissedSyncedPreviewKey('');
    startPreviewHydration(intent);
  };

  const handleCopyPath = async (): Promise<boolean> => {
    const path = compact(controller.item()?.path);
    if (!path) {
      notification.error(i18n.t('shell.notifications.copyFailedTitle'), i18n.t('shell.notifications.missingFilePath'));
      return false;
    }

    try {
      await writeTextToClipboard(path);
      return true;
    } catch (error) {
      notification.error(
        i18n.t('shell.notifications.copyFailedTitle'),
        error instanceof Error ? error.message : i18n.t('shell.notifications.clipboardCopyFailed'),
      );
      return false;
    }
  };

  const handleAskFlower = (selectionText: string) => {
    const result = buildFilePreviewAskFlowerIntent({
      item: controller.item(),
      selectionText,
    });
    if (result.error) {
      notification.error(i18n.t('shell.notifications.askFlowerUnavailableTitle'), result.error);
      return;
    }
    if (!result.intent) return;
    env.openAskFlowerComposer(result.intent);
  };

  const handleDownload = () => {
    const command = buildFilePreviewDownloadCommand({
      item: controller.item(),
      descriptor: controller.descriptor(),
      dirty: controller.dirty(),
      draftText: controller.draftText(),
      origin: 'workbench_preview',
    });
    if (!command) {
      notification.error(i18n.t('shell.notifications.downloadUnavailableTitle'), i18n.t('shell.notifications.onlyFilesDownloaded'));
      return;
    }
    downloads.enqueue(command);
  };

  createEffect(() => {
    const request = workbench.previewOpenRequest(props.widgetId);
    const requestId = compact(request?.requestId);
    if (!requestId || !request) {
      return;
    }
    if (consumedPreviewOpenRequestIds.has(requestId)) {
      return;
    }
    consumedPreviewOpenRequestIds.add(requestId);
    workbench.consumePreviewOpenRequest(requestId);
    const intent = normalizePreviewIntentFromFileItem(request.item, 'direct_request', requestId);
    if (!intent) {
      return;
    }
    untrack(() => openPreviewIntent(intent));
  });

  createEffect(() => {
    const item = workbench.previewItem(props.widgetId);
    const intent = normalizePreviewIntentFromFileItem(item, 'shared_state');
    if (!intent) {
      return;
    }
    untrack(() => openPreviewIntent(intent));
  });

  createEffect(() => {
    const item = controller.item();
    if (!item || item.type !== 'file') {
      if (untrack(openLifecycle).phase === 'hydrating') {
        return;
      }
      setOpenLifecycle((current) => (
        current.phase === 'idle'
          ? current
          : { phase: 'idle' }
      ));
      workbench.updatePreviewItem(props.widgetId, null);
      return;
    }
    markHydratedFromControllerItem(previewOpenIntentKey(item));
    workbench.updatePreviewItem(props.widgetId, item);
    const pendingItem = untrack(pendingSyncedItem);
    if (pendingItem && previewOpenIntentKey(pendingItem) === previewOpenIntentKey(item)) {
      workbench.setPendingSyncedPreviewItem(props.widgetId, null);
      setDismissedSyncedPreviewKey('');
    }
  });

  createEffect(() => {
    workbench.registerWidgetRemoveGuard(props.widgetId, () => {
      if (!controller.dirty()) {
        return true;
      }
      setPendingWidgetRemoval(true);
      controller.handleOpenChange(false);
      return false;
    });
  });

  createEffect(() => {
    if (!pendingWidgetRemoval()) {
      return;
    }
    const confirmOpen = controller.closeConfirmOpen();
    const previewOpen = controller.open();
    if (!confirmOpen && previewOpen) {
      setPendingWidgetRemoval(false);
      return;
    }
    if (!confirmOpen && !previewOpen) {
      setPendingWidgetRemoval(false);
      workbench.removeWidget(props.widgetId);
    }
  });

  onCleanup(() => {
    workbench.registerWidgetRemoveGuard(props.widgetId, null);
  });

  return (
    <div class="redeven-workbench-body-surface flex h-full min-h-0 flex-col overflow-hidden">
      <Show when={pendingSyncedItem()}>
        {(item) => (
          <div class="shrink-0 border-b border-warning/25 bg-warning/10 px-3 py-2 text-xs text-foreground">
            <div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div class="min-w-0">
                <span class="font-semibold text-warning">Synced preview pending</span>
                <span class="ml-2 text-muted-foreground">
                  Another window opened {item().name || item().path}. Keep your draft or switch explicitly.
                </span>
              </div>
              <div class="flex shrink-0 items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const intent = normalizePreviewIntentFromFileItem(item(), 'pending_synced_user_action');
                    if (intent) {
                      openPreviewIntent(intent);
                    }
                  }}
                >
                  Open synced file
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setDismissedSyncedPreviewKey(previewOpenIntentKey(item()));
                    workbench.setPendingSyncedPreviewItem(props.widgetId, null);
                  }}
                >
                  Keep current draft
                </Button>
              </div>
            </div>
          </div>
        )}
      </Show>
      <div class="min-h-0 flex-1 overflow-hidden">
      <FilePreviewPanel
        item={controller.item()}
        descriptor={controller.descriptor()}
        text={controller.text()}
        draftText={controller.draftText()}
        editing={controller.editing()}
        dirty={controller.dirty()}
        saving={controller.saving()}
        saveError={controller.saveError()}
        canEdit={controller.canEdit()}
        selectedText={controller.selectedText()}
        closeConfirmOpen={controller.closeConfirmOpen()}
        closeConfirmMessage={controller.closeConfirmMessage()}
        onCloseConfirmChange={(open) => {
          if (open) return;
          controller.cancelPendingAction();
        }}
        onConfirmDiscardClose={() => void controller.confirmDiscardAndContinue()}
        onStartEdit={controller.beginEditing}
        onDraftChange={controller.updateDraft}
        onSelectionChange={controller.updateSelection}
        onSave={() => void controller.saveCurrent()}
        onDiscard={controller.revertCurrent}
        message={controller.message()}
        objectUrl={controller.objectUrl()}
        bytes={controller.bytes()}
        truncated={controller.truncated()}
        loading={controller.loading()}
        error={controller.error()}
        xlsxSheetName={controller.xlsxSheetName()}
        xlsxRows={controller.xlsxRows()}
        onCopyPath={handleCopyPath}
        onDownload={handleDownload}
        onAskFlower={handleAskFlower}
        closeConfirmVariant="dialog"
      />
      </div>
    </div>
  );
}

import { Show, createEffect, createSignal, onCleanup } from 'solid-js';
import { useNotification } from '@floegence/floe-webapp-core';
import type { WorkbenchWidgetBodyProps } from '@floegence/floe-webapp-core/workbench';
import { useProtocol } from '@floegence/floe-webapp-protocol';
import { Button } from '@floegence/floe-webapp-core/ui';

import { useRedevenRpc } from '../protocol/redeven_v1';
import { useEnvContext } from '../pages/EnvContext';
import { writeTextToClipboard } from '../utils/clipboard';
import { buildFilePreviewAskFlowerIntent } from '../utils/filePreviewAskFlower';
import { FilePreviewPanel } from '../widgets/FilePreviewPanel';
import { createFilePreviewController } from '../widgets/createFilePreviewController';
import { useEnvWorkbenchInstancesContext } from './EnvWorkbenchInstancesContext';

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function previewItemKey(item: { path?: string; name?: string; size?: number } | null | undefined): string {
  return [
    compact(item?.path),
    compact(item?.name),
    typeof item?.size === 'number' ? String(item.size) : '',
  ].join('\u0000');
}

export function WorkbenchFilePreviewWidget(props: WorkbenchWidgetBodyProps) {
  const notification = useNotification();
  const protocol = useProtocol();
  const rpc = useRedevenRpc();
  const env = useEnvContext();
  const workbench = useEnvWorkbenchInstancesContext();
  const controller = createFilePreviewController({
    client: () => protocol.client(),
    rpc: () => rpc,
    canWrite: () => Boolean(env.env()?.permissions?.can_write),
    onSaved: (path) => {
      notification.success('File saved', `${path} saved successfully.`);
    },
    onSaveError: (path, message) => {
      notification.error('Save failed', `${path}: ${message}`);
    },
  });
  const [hydratedPath, setHydratedPath] = createSignal('');
  const [dismissedSyncedPreviewKey, setDismissedSyncedPreviewKey] = createSignal('');
  const [pendingWidgetRemoval, setPendingWidgetRemoval] = createSignal(false);
  const pendingSyncedItem = () => workbench.pendingSyncedPreviewItem(props.widgetId);

  const handleCopyPath = async (): Promise<boolean> => {
    const path = compact(controller.item()?.path);
    if (!path) {
      notification.error('Copy failed', 'Missing file path');
      return false;
    }

    try {
      await writeTextToClipboard(path);
      return true;
    } catch (error) {
      notification.error('Copy failed', error instanceof Error ? error.message : 'Failed to copy text to clipboard.');
      return false;
    }
  };

  const handleAskFlower = (selectionText: string) => {
    const result = buildFilePreviewAskFlowerIntent({
      item: controller.item(),
      selectionText,
    });
    if (result.error) {
      notification.error('Ask Flower unavailable', result.error);
      return;
    }
    if (!result.intent) return;
    env.openAskFlowerComposer(result.intent);
  };

  createEffect(() => {
    const request = workbench.previewOpenRequest(props.widgetId);
    const requestId = compact(request?.requestId);
    if (!requestId || !request) {
      return;
    }
    workbench.consumePreviewOpenRequest(requestId);
    const requestPath = compact(request.item?.path);
    if (!requestPath) {
      return;
    }
    setHydratedPath(requestPath);
    void controller.openPreview(request.item);
  });

  createEffect(() => {
    const item = workbench.previewItem(props.widgetId);
    if (!item) {
      return;
    }
    if (item.type !== 'file') {
      return;
    }
    const previewPath = compact(item?.path);
    if (!previewPath || previewPath === hydratedPath()) {
      return;
    }
    const syncedItem = {
      id: compact(item.id) || previewPath,
      type: 'file' as const,
      path: previewPath,
      name: compact(item.name) || previewPath,
      ...(typeof item.size === 'number' ? { size: item.size } : {}),
    };
    if (controller.open() && compact(controller.item()?.path) === previewPath) {
      setHydratedPath(previewPath);
      setDismissedSyncedPreviewKey('');
      workbench.setPendingSyncedPreviewItem(props.widgetId, null);
      return;
    }
    const nextKey = previewItemKey(syncedItem);
    if (controller.dirty()) {
      if (dismissedSyncedPreviewKey() !== nextKey) {
        workbench.setPendingSyncedPreviewItem(props.widgetId, syncedItem);
      }
      return;
    }
    setDismissedSyncedPreviewKey('');
    workbench.setPendingSyncedPreviewItem(props.widgetId, null);
    setHydratedPath(previewPath);
    void controller.openPreview(syncedItem);
  });

  createEffect(() => {
    const item = controller.item();
    if (!item || item.type !== 'file') {
      workbench.updatePreviewItem(props.widgetId, null);
      return;
    }
    workbench.updatePreviewItem(props.widgetId, item);
    const pendingItem = pendingSyncedItem();
    if (pendingItem && compact(pendingItem.path) === compact(item.path)) {
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
    <div class="flex h-full min-h-0 flex-col overflow-hidden bg-background">
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
                    void controller.openPreview(item());
                  }}
                >
                  Open synced file
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => {
                    setDismissedSyncedPreviewKey(previewItemKey(item()));
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
        downloadLoading={controller.downloadLoading()}
        onCopyPath={handleCopyPath}
        onDownload={() => {
          void controller.downloadCurrent();
        }}
        onAskFlower={handleAskFlower}
        closeConfirmVariant="dialog"
      />
      </div>
    </div>
  );
}

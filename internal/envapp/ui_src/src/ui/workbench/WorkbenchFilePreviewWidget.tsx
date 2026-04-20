import { createEffect, createSignal, onCleanup } from 'solid-js';
import { useNotification } from '@floegence/floe-webapp-core';
import type { WorkbenchWidgetBodyProps } from '@floegence/floe-webapp-core/workbench';
import { useProtocol } from '@floegence/floe-webapp-protocol';

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
  const [pendingWidgetRemoval, setPendingWidgetRemoval] = createSignal(false);

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
    const previewPath = compact(item?.path);
    if (!previewPath || previewPath === hydratedPath()) {
      return;
    }
    if (controller.open() && compact(controller.item()?.path) === previewPath) {
      setHydratedPath(previewPath);
      return;
    }
    setHydratedPath(previewPath);
    void controller.openPreview(item);
  });

  createEffect(() => {
    const item = controller.item();
    if (!item) {
      return;
    }
    workbench.updatePreviewItem(props.widgetId, item);
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
    <div class="h-full min-h-0 overflow-hidden bg-background">
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
  );
}

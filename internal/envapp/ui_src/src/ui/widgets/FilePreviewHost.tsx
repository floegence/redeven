import { useNotification } from '@floegence/floe-webapp-core';
import { useEnvContext } from '../pages/EnvContext';
import { buildFilePreviewAskFlowerIntent } from '../utils/filePreviewAskFlower';
import { useFilePreviewContext } from './FilePreviewContext';
import { FilePreviewSurface } from './FilePreviewSurface';

export function FilePreviewHost() {
  const notification = useNotification();
  const env = useEnvContext();
  const filePreview = useFilePreviewContext();

  const handleAskFlower = (selectionText: string) => {
    const result = buildFilePreviewAskFlowerIntent({
      item: filePreview.controller.item(),
      selectionText,
    });
    if (result.error) {
      notification.error('Ask Flower unavailable', result.error);
      return;
    }
    if (!result.intent) return;
    env.openAskFlowerComposer(result.intent);
  };

  return (
    <FilePreviewSurface
      open={filePreview.controller.open()}
      onOpenChange={filePreview.controller.handleOpenChange}
      item={filePreview.controller.item()}
      descriptor={filePreview.controller.descriptor()}
      text={filePreview.controller.text()}
      draftText={filePreview.controller.draftText()}
      editing={filePreview.controller.editing()}
      dirty={filePreview.controller.dirty()}
      saving={filePreview.controller.saving()}
      saveError={filePreview.controller.saveError()}
      canEdit={filePreview.controller.canEdit()}
      selectedText={filePreview.controller.selectedText()}
      closeConfirmOpen={filePreview.controller.closeConfirmOpen()}
      closeConfirmMessage={filePreview.controller.closeConfirmMessage()}
      onCloseConfirmChange={(open) => {
        if (open) return;
        filePreview.controller.cancelPendingAction();
      }}
      onConfirmDiscardClose={() => void filePreview.controller.confirmDiscardAndContinue()}
      onStartEdit={filePreview.controller.beginEditing}
      onDraftChange={filePreview.controller.updateDraft}
      onSelectionChange={filePreview.controller.updateSelection}
      onSave={() => void filePreview.controller.saveCurrent()}
      onDiscard={filePreview.controller.revertCurrent}
      message={filePreview.controller.message()}
      objectUrl={filePreview.controller.objectUrl()}
      bytes={filePreview.controller.bytes()}
      truncated={filePreview.controller.truncated()}
      loading={filePreview.controller.loading()}
      error={filePreview.controller.error()}
      xlsxSheetName={filePreview.controller.xlsxSheetName()}
      xlsxRows={filePreview.controller.xlsxRows()}
      downloadLoading={filePreview.controller.downloadLoading()}
      onDownload={() => {
        void filePreview.controller.downloadCurrent();
      }}
      onAskFlower={handleAskFlower}
    />
  );
}

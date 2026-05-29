import { useNotification } from '@floegence/floe-webapp-core';
import { useEnvContext } from '../pages/EnvContext';
import { useDownloadManager } from '../downloads/DownloadContext';
import { buildFilePreviewDownloadCommand } from '../downloads/downloadCommands';
import { writeTextToClipboard } from '../utils/clipboard';
import { buildFilePreviewAskFlowerIntent } from '../utils/filePreviewAskFlower';
import { useFilePreviewContext } from './FilePreviewContext';
import { FilePreviewSurface } from './FilePreviewSurface';
import { useI18n } from '../i18n';

export function FilePreviewHost() {
  const notification = useNotification();
  const i18n = useI18n();
  const env = useEnvContext();
  const filePreview = useFilePreviewContext();
  const downloads = useDownloadManager();

  const handleCopyPath = async (): Promise<boolean> => {
    const path = String(filePreview.controller.item()?.path ?? '').trim();
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
      item: filePreview.controller.item(),
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
      item: filePreview.controller.item(),
      descriptor: filePreview.controller.descriptor(),
      dirty: filePreview.controller.dirty(),
      draftText: filePreview.controller.draftText(),
      origin: 'file_preview',
    });
    if (!command) {
      notification.error(i18n.t('shell.notifications.downloadUnavailableTitle'), i18n.t('shell.notifications.onlyFilesDownloaded'));
      return;
    }
    downloads.enqueue(command);
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
      resourceUrl={filePreview.controller.resourceUrl()}
      bytes={filePreview.controller.bytes()}
      truncated={filePreview.controller.truncated()}
      loading={filePreview.controller.loading()}
      error={filePreview.controller.error()}
      xlsxSheetName={filePreview.controller.xlsxSheetName()}
      xlsxRows={filePreview.controller.xlsxRows()}
      onCopyPath={handleCopyPath}
      onDownload={handleDownload}
      onAskFlower={handleAskFlower}
    />
  );
}

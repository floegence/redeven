import type { FilePreviewContentProps } from './FilePreviewContent';
import { FilePreviewContent } from './FilePreviewContent';
import type { FilePreviewController } from './createFilePreviewController';

export interface FilePreviewControllerContentProps extends Pick<FilePreviewContentProps, 'contentRef' | 'onCopyPath'> {
  controller: FilePreviewController;
}

export function FilePreviewControllerContent(props: FilePreviewControllerContentProps) {
  return (
    <FilePreviewContent
      item={props.controller.item()}
      descriptor={props.controller.descriptor()}
      text={props.controller.text()}
      draftText={props.controller.draftText()}
      editing={props.controller.editing()}
      dirty={props.controller.dirty()}
      saving={props.controller.saving()}
      saveError={props.controller.saveError()}
      canEdit={props.controller.canEdit()}
      message={props.controller.message()}
      objectUrl={props.controller.objectUrl()}
      bytes={props.controller.bytes()}
      truncated={props.controller.truncated()}
      loading={props.controller.loading()}
      error={props.controller.error()}
      xlsxSheetName={props.controller.xlsxSheetName()}
      xlsxRows={props.controller.xlsxRows()}
      onCopyPath={props.onCopyPath}
      contentRef={props.contentRef}
      onStartEdit={props.controller.beginEditing}
      onDraftChange={props.controller.updateDraft}
      onSelectionChange={props.controller.updateSelection}
      onSave={() => void props.controller.saveCurrent()}
      onDiscard={props.controller.revertCurrent}
    />
  );
}

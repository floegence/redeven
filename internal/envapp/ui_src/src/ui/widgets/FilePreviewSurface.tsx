import { createMemo, createSignal } from 'solid-js';
import { useLayout } from '@floegence/floe-webapp-core';
import type { FilePreviewPanelProps } from './FilePreviewPanel';
import { FilePreviewPanel } from './FilePreviewPanel';
import { PREVIEW_WINDOW_Z_INDEX, PreviewWindow } from './PreviewWindow';
import { useI18n } from '../i18n';

export interface FilePreviewSurfaceProps extends FilePreviewPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function FilePreviewSurface(props: FilePreviewSurfaceProps) {
  const layout = useLayout();
  const i18n = useI18n();
  const isMobile = createMemo(() => layout.isMobile());
  const [floatingSurfaceEl, setFloatingSurfaceEl] = createSignal<HTMLElement | null>(null);
  const title = () => props.item?.name ?? i18n.t('filePreview.previewWindowTitle');

  return (
    <PreviewWindow
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={title()}
      persistenceKey="file-preview"
      zIndex={PREVIEW_WINDOW_Z_INDEX}
      surfaceRef={setFloatingSurfaceEl}
    >
      <FilePreviewPanel
        {...props}
        closeConfirmVariant={isMobile() ? 'dialog' : 'floating'}
        closeConfirmHost={floatingSurfaceEl()}
      />
    </PreviewWindow>
  );
}

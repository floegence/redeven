import { Show, createMemo, createSignal } from 'solid-js';
import { useLayout } from '@floegence/floe-webapp-core';
import type { FilePreviewPanelProps } from './FilePreviewPanel';
import { FilePreviewPanel } from './FilePreviewPanel';
import { FilePreviewActions } from './FilePreviewActions';
import { PreviewWindow } from './PreviewWindow';
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
  const [contentElement, setContentElement] = createSignal<HTMLDivElement>();
  const title = () => props.item?.name ?? i18n.t('filePreview.previewWindowTitle');

  return (
    <PreviewWindow
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={title()}
      headerActions={(
        <Show when={!isMobile()}>
          <FilePreviewActions {...props} compact contentElement={contentElement()} />
        </Show>
      )}
      stackId="file-preview"
      persistenceKey="file-preview"
      surfaceRef={setFloatingSurfaceEl}
    >
      <FilePreviewPanel
        {...props}
        surface={isMobile() ? 'main' : 'window'}
        showHeader={isMobile()}
        contentRef={(element) => {
          setContentElement(element);
          props.contentRef?.(element);
        }}
        closeConfirmVariant={isMobile() ? 'dialog' : 'floating'}
        closeConfirmHost={floatingSurfaceEl()}
      />
    </PreviewWindow>
  );
}

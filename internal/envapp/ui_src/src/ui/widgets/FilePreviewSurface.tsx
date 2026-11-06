import { FilePreviewSearchScope } from './FilePreviewSearch';
import { FlowerContextSource } from '../flower/FlowerContextSource';
import { Show, createMemo, createSignal, createUniqueId, onCleanup } from 'solid-js';
import { useLayout } from '@floegence/floe-webapp-core';
import type { FilePreviewPanelProps } from './FilePreviewPanel';
import { FilePreviewPanel } from './FilePreviewPanel';
import { FilePreviewActions } from './FilePreviewActions';
import { PreviewWindow } from './PreviewWindow';
import { useI18n } from '../i18n';

export interface FilePreviewSurfaceProps extends FilePreviewPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  retainContent?: () => () => void;
}

function RetainedFilePreviewPanel(props: FilePreviewPanelProps & Pick<FilePreviewSurfaceProps, 'retainContent'>) {
  const release = props.retainContent?.();
  if (release) onCleanup(release);
  return <FilePreviewPanel {...props} />;
}

export function FilePreviewSurface(props: FilePreviewSurfaceProps) {
  const sourceID = `preview:${createUniqueId()}`;
  const layout = useLayout();
  const i18n = useI18n();
  const isMobile = createMemo(() => layout.isMobile());
  const [floatingSurfaceEl, setFloatingSurfaceEl] = createSignal<HTMLElement | null>(null);
  const [contentElement, setContentElement] = createSignal<HTMLDivElement>();
  const title = () => props.item?.name ?? i18n.t('filePreview.previewWindowTitle');

  return (
    <FilePreviewSearchScope>
    <PreviewWindow
      open={props.open}
      onOpenChange={props.onOpenChange}
      title={title()}
      headerActions={(
        <Show when={!isMobile()}>
          <FilePreviewActions {...props} compact presentation="header" contentElement={contentElement()} />
        </Show>
      )}
      stackId="file-preview"
      persistenceKey="file-preview"
      surfaceRef={setFloatingSurfaceEl}
    >
      <FlowerContextSource id={sourceID} pageID="preview:file" pageName={title()} mode="overlay"
        state={{ path: props.item?.path, mode: props.descriptor.mode, unsaved: props.dirty, selection: props.selectedText }} selected={props.open}>
      <RetainedFilePreviewPanel
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
      </FlowerContextSource>
    </PreviewWindow>
    </FilePreviewSearchScope>
  );
}

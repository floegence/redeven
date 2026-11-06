import { FilePreviewSearchScope } from './FilePreviewSearch';
import { FlowerContextSource } from '../flower/FlowerContextSource';
import { Dynamic, Portal } from 'solid-js/web';
import { For, Show, createEffect, createMemo, createSignal, createUniqueId, onCleanup, type Component } from 'solid-js';
import { useLayout } from '@floegence/floe-webapp-core';
import { Button, RetainedPanel, WindowTabs } from '@floegence/floe-webapp-core/ui';
import { FileItemIcon } from '@floegence/floe-webapp-core/file-browser';
import { FilePreviewPanel } from './FilePreviewPanel';
import { FilePreviewActions } from './FilePreviewActions';
import { PreviewWindow } from './PreviewWindow';
import { WindowModal } from './WindowModal';
import { ConfirmDialog } from '../primitives/EnvAppModal';
import type { FilePreviewController } from './createFilePreviewController';
import type { FilePreviewEntry, FilePreviewWorkspace } from './createFilePreviewWorkspace';
import type { FilePreviewSurfaceProps } from './FilePreviewSurface';
import { dirnameAbsolute } from '../utils/askFlowerPath';
import { useNotification } from '@floegence/floe-webapp-core';
import { useEnvContext } from '../pages/EnvContext';
import { useDownloadManager } from '../downloads/DownloadContext';
import { buildFilePreviewDownloadCommand } from '../downloads/downloadCommands';
import { writeTextToClipboard } from '../utils/clipboard';
import { buildFilePreviewFlowerTurnLauncherIntent } from '../utils/filePreviewAskFlower';
import { useFilePreviewContext } from './FilePreviewContext';
import { FilePreviewSurface } from './FilePreviewSurface';
import { useI18n } from '../i18n';

function FilePreviewDocument(props: { controller: FilePreviewController; surface?: Component<FilePreviewSurfaceProps> }) {
  const notification = useNotification();
  const i18n = useI18n();
  const env = useEnvContext();
  const filePreview = { get controller() { return props.controller; } };
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

  const handleAskFlower = (selectionText: string, anchor?: { x: number; y: number }) => {
    const result = buildFilePreviewFlowerTurnLauncherIntent({
      item: filePreview.controller.item(),
      selectionText,
    });
    if (result.error) {
      notification.error(i18n.t('shell.notifications.askFlowerUnavailableTitle'), result.error);
      return;
    }
    if (!result.intent) return;
    env.openFlowerTurnLauncher(result.intent, anchor);
  };

  const handleDownload = async () => {
    const item = filePreview.controller.item();
    let pdfDraftBytes: Uint8Array<ArrayBuffer> | undefined;
    if (filePreview.controller.descriptor().mode === 'pdf' && filePreview.controller.dirty()) {
      try { pdfDraftBytes = await filePreview.controller.exportPdfDraft(); }
      catch (error) {
        notification.error(i18n.t('shell.notifications.downloadUnavailableTitle'), String(error));
        return;
      }
      if (filePreview.controller.item() !== item) return;
    }
    const command = buildFilePreviewDownloadCommand({
      item: filePreview.controller.item(),
      descriptor: filePreview.controller.descriptor(),
      dirty: filePreview.controller.dirty(),
      draftText: filePreview.controller.draftText(),
      pdfDraftBytes,
      origin: 'file_preview',
    });
    if (!command) {
      notification.error(i18n.t('shell.notifications.downloadUnavailableTitle'), i18n.t('shell.notifications.onlyFilesDownloaded'));
      return;
    }
    downloads.enqueue(command);
  };

  return (
    <Dynamic component={props.surface ?? FilePreviewSurface}
      open={filePreview.controller.open()}
      retainContent={filePreview.controller.retainContent}
      onOpenChange={filePreview.controller.handleOpenChange}
      item={filePreview.controller.item()}
      descriptor={filePreview.controller.descriptor()}
      text={filePreview.controller.text()}
      draftText={filePreview.controller.draftText()}
      editing={filePreview.controller.editing()}
      bindPdfEditor={filePreview.controller.bindPdfEditor}
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
      errorType={filePreview.controller.errorType()}
      onRetry={() => void filePreview.controller.retry()}
      onRenderError={filePreview.controller.reportRenderError}
      onResourceError={(path,source) => void filePreview.controller.reportResourceError(path,source)}
      onOpenParent={() => env.openFileBrowserAtPath(dirnameAbsolute(filePreview.controller.item()?.path ?? ''),{openStrategy:'focus_latest_or_create'})}
      onCopyPath={handleCopyPath}
      onDownload={handleDownload}
      onAskFlower={handleAskFlower}
    />
  );
}


export function FilePreviewHost() {
  const context = useFilePreviewContext();
  return <Show when={context.workspace} fallback={<FilePreviewDocument controller={context.controller} />}>
    {workspace => <FilePreviewWorkspaceWindow workspace={workspace()} />}
  </Show>;
}

function FilePreviewWorkspaceWindow(props: { workspace: FilePreviewWorkspace }) {
  const i18n = useI18n();
  const layout = useLayout();
  const [actionsHost, setActionsHost] = createSignal<HTMLDivElement>();
  const [surface, setSurface] = createSignal<HTMLElement | null>(null);
  const workspace = props.workspace;
  const tabPrefix = createUniqueId();
  const tabId = (id: string) => tabPrefix + '-tab-' + encodeURIComponent(id);
  const panelId = (id: string) => tabPrefix + '-panel-' + encodeURIComponent(id);
  const multiple = createMemo(() => workspace.entries().length > 1);
  // Moving a retained iframe DOM node reloads it. Tab order must not move panels.
  const panels = createMemo<FilePreviewEntry[]>(previous => {
    const current = workspace.entries();
    return [...previous.filter(entry => current.includes(entry)), ...current.filter(entry => !previous.includes(entry))];
  }, []);
  const title = () => workspace.active()?.item.name ?? i18n.t('filePreview.previewWindowTitle');
  const closeTab = (id: string) => {
    const focusedTab = document.activeElement?.closest('[role="tab"]');
    workspace.requestClose(id);
    if (focusedTab && !workspace.pendingClose() && workspace.entries().length === 1) {
      queueMicrotask(() => {
        if (document.activeElement === document.body) surface()?.focus({ preventScroll: true });
      });
    }
  };
  const confirmClose = () => {
    workspace.confirmClose();
    queueMicrotask(() => {
      if (workspace.open() && !workspace.pendingClose() && document.activeElement === document.body) {
        (document.getElementById(tabId(workspace.activeId())) ?? surface())?.focus({ preventScroll: true });
      }
    });
  };
  const closeLabel = (name: string) => i18n.t('filePreview.closeTab', { name });
  const confirmation = () => i18n.t('filePreview.discardUnsavedDescription');
  const tabItems = createMemo(() => workspace.entries().map(entry => ({ id: entry.id, label: entry.item.name + (entry.controller.dirty() ? ' •' : ''),
      domId: tabId(entry.id), panelId: panelId(entry.id), title: entry.item.path, closeLabel: closeLabel(entry.item.name), closable: true,
      icon: <FileItemIcon item={entry.item} size={14} class="size-3.5 shrink-0" />,
    })));
  const tabs = createMemo(() => multiple() ? <WindowTabs
    ariaLabel={i18n.t('filePreview.previewWindowTitle')}
    labels={{ scrollLeft: i18n.t('filePreview.previousTab'), scrollRight: i18n.t('filePreview.nextTab') }}
    items={tabItems()}
    activeId={workspace.activeId()} onChange={workspace.select} onReorder={workspace.reorder} onClose={closeTab}
  /> : undefined);
  return <PreviewWindow open={workspace.open()} onOpenChange={open => { if (!open) workspace.requestClose(); }}
    title={title()} titleContent={tabs()} stackId="file-preview" persistenceKey="file-preview" surfaceRef={setSurface}
    headerActions={<div ref={setActionsHost} class="flex items-center" />}>
    <div class="relative h-full min-h-0 flex-1">
    <For each={panels()}>{entry => {
      const SessionSurface: Component<FilePreviewSurfaceProps> = panel => {
        const [content, setContent] = createSignal<HTMLDivElement>();
        const release = workspace.retainEntry(entry); onCleanup(release);
        createEffect(() => {
          if (workspace.activeId() === entry.id && workspace.open()) return;
          content()?.querySelectorAll<HTMLMediaElement>('video, audio').forEach(media => media.pause());
        });
        return <FilePreviewSearchScope>
          <Show when={actionsHost()}>{host => <Portal mount={host()}><div style={{ display: workspace.activeId() === entry.id && !layout.isMobile() ? undefined : 'none' }}>
            <FilePreviewActions {...panel} active={workspace.activeId() === entry.id && workspace.open()} compact presentation="header" contentElement={content()} />
          </div></Portal>}</Show>
          <RetainedPanel active={workspace.activeId() === entry.id} data-preview-document={entry.id} role={multiple() ? 'tabpanel' : undefined} id={panelId(entry.id)} aria-labelledby={multiple() ? tabId(entry.id) : undefined} aria-label={entry.item.name}
            class="h-full min-h-0">
            <FlowerContextSource id={`preview:${entry.id}`} pageID={`preview:${entry.id}`} pageName={entry.item.name} mode="overlay"
              state={{ path: entry.controller.item()?.path, mode: entry.controller.descriptor().mode, unsaved: entry.controller.dirty(), selection: entry.controller.selectedText() }}
              selected={workspace.activeId() === entry.id && workspace.open()}>
            <FilePreviewPanel {...panel} active={workspace.activeId() === entry.id && workspace.open()} surface={layout.isMobile() ? 'main' : 'window'} showHeader={layout.isMobile()}
              contentRef={setContent} closeConfirmVariant="none" />
            </FlowerContextSource>
          </RetainedPanel>
        </FilePreviewSearchScope>;
      };
      return <FilePreviewDocument controller={entry.controller} surface={SessionSurface} />;
    }}</For>
    </div>
    <Show when={!layout.isMobile()} fallback={<ConfirmDialog open={!!workspace.pendingClose()} onOpenChange={open => { if (!open) workspace.cancelClose(); }}
      title={i18n.t('filePreview.discardUnsavedTitle')} bodyDescription={confirmation()}
      confirmText={i18n.t('filePreview.discardChanges')} loading={workspace.pendingSaving()} variant="destructive" onConfirm={confirmClose}>
      <ul class="max-h-40 overflow-auto px-4 text-xs break-all"><For each={workspace.pendingDirty()}>{entry => <li>{entry.item.path}</li>}</For></ul>
    </ConfirmDialog>}>
      <WindowModal open={!!workspace.pendingClose()} host={surface()} title={i18n.t('filePreview.discardUnsavedTitle')}
        bodyDescription={confirmation()} onOpenChange={open => { if (!open) workspace.cancelClose(); }}
        footer={<div class="flex justify-end gap-2 border-t border-border p-3">
          <Button size="sm" variant="outline" onClick={workspace.cancelClose}>{i18n.t('common.actions.cancel')}</Button>
          <Button size="sm" variant="destructive" disabled={workspace.pendingSaving()} onClick={confirmClose}>{i18n.t('filePreview.discardChanges')}</Button>
        </div>}>
        <ul class="max-h-40 overflow-auto px-4 pb-4 text-xs break-all"><For each={workspace.pendingDirty()}>{entry => <li>{entry.item.path}</li>}</For></ul>
      </WindowModal>
    </Show>
  </PreviewWindow>;
}

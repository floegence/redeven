import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function read(relPath: string): string {
  const here = fileURLToPath(import.meta.url);
  const dir = path.dirname(here);
  return fs.readFileSync(path.resolve(dir, relPath), 'utf8');
}

describe('file preview wiring', () => {
  it('keeps shared preview content and switches between dialog and floating window by layout', () => {
    const contentSrc = read('./FilePreviewContent.tsx');
    const panelSrc = read('./FilePreviewPanel.tsx');
    const docxPaneSrc = read('./DocxPreviewPane.tsx');
    const pdfPaneSrc = read('./PdfPreviewPane.tsx');
    const textPaneSrc = read('./TextFilePreviewPane.tsx');
    const rendererRegistrySrc = read('../file-preview/rendererRegistry.tsx');
    const surfaceSrc = read('./FilePreviewSurface.tsx');
    const envAppLayersSrc = read('../utils/envAppLayers.ts');
    const previewWindowSrc = read('./PreviewWindow.tsx');
    const askFlowerComposerSrc = read('./AskFlowerComposerWindow.tsx');
    const codePreviewPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), './CodePreviewPane.tsx');

    expect(contentSrc).toContain("import { renderRedevenFilePreviewBody } from '../file-preview/rendererRegistry';");
    expect(contentSrc).toContain('renderRedevenFilePreviewBody(props)');
    expect(contentSrc).not.toContain("import { DocxPreviewPane } from './DocxPreviewPane';");
    expect(contentSrc).not.toContain("import { PdfPreviewPane } from './PdfPreviewPane';");
    expect(contentSrc).not.toContain("import { TextFilePreviewPane } from './TextFilePreviewPane';");
    expect(rendererRegistrySrc).toContain("import { DocxPreviewPane } from '../widgets/DocxPreviewPane';");
    expect(rendererRegistrySrc).toContain("import { PdfPreviewPane } from '../widgets/PdfPreviewPane';");
    expect(rendererRegistrySrc).toContain("import { TextFilePreviewPane } from '../widgets/TextFilePreviewPane';");
    expect(rendererRegistrySrc).toContain('export const REDEVEN_FILE_PREVIEW_RENDERERS');
    expect(rendererRegistrySrc).toContain('<DocxPreviewPane bytes={props.bytes} />');
    expect(rendererRegistrySrc).toContain('<PdfPreviewPane bytes={props.bytes} />');
    expect(rendererRegistrySrc).toContain('<TextFilePreviewPane');
    expect(contentSrc).not.toContain('<iframe src={props.objectUrl}');
    expect(docxPaneSrc).toContain("import('docx-preview')");
    expect(docxPaneSrc).toContain('ResizeObserver');
    expect(docxPaneSrc).toContain('inWrapper: true');
    expect(docxPaneSrc).toContain('Fit');
    expect(docxPaneSrc).toContain('Zoom in docx preview');
    expect(pdfPaneSrc).toContain("import { LoadingOverlay } from '@floegence/floe-webapp-core/loading';");
    expect(pdfPaneSrc).toContain('loadPDFDocument');
    expect(pdfPaneSrc).toContain('Zoom in PDF preview');
    expect(pdfPaneSrc).toContain('Fit PDF preview to width');
    expect(pdfPaneSrc).toContain('Loading PDF...');
    expect(pdfPaneSrc).toContain('Rendering page...');
    expect(pdfPaneSrc).not.toContain('Rendering PDF...');
    expect(textPaneSrc).toContain("from '@floegence/floe-webapp-core/editor';");
    expect(textPaneSrc).toContain('ErrorBoundary');
    expect(textPaneSrc).toContain('CodeEditorApi, CodeEditorProps');
    expect(textPaneSrc).toContain('PREVIEW_MONACO_RUNTIME_OPTIONS');
    expect(textPaneSrc).toContain('EDITING_MONACO_RUNTIME_OPTIONS');
    expect(textPaneSrc).toContain('editorRuntimeOptions');
    expect(textPaneSrc).toContain('StaticTextPreviewPane');
    expect(textPaneSrc).toContain('!props.truncated && !monacoFailed()');
    expect(textPaneSrc).toContain("return props.descriptor.language;");
    expect(textPaneSrc).not.toContain("props.descriptor.language || 'plaintext'");
    expect(textPaneSrc).not.toContain('resolveCodeEditorLanguageSpec');
    expect(textPaneSrc).not.toContain('CodePreviewPane');
    expect(textPaneSrc).not.toContain('shouldUseCodePreviewFallback');
    expect(textPaneSrc).toContain('Monaco must remount when switching between read-only preview and edit mode');
    expect(textPaneSrc).toContain('Cannot edit in read-only editor');
    expect(textPaneSrc).toContain('renderReadonlyMonaco');
    expect(textPaneSrc).toContain('renderEditingMonaco');
    expect(textPaneSrc).toContain('Editor unavailable');
    expect(textPaneSrc).toContain('Showing a plain-text fallback for this preview.');
    expect(textPaneSrc).toContain('data-testid="text-preview-fallback"');
    expect(textPaneSrc).toContain('Discard this edit session or try again later.');
    expect(textPaneSrc).toContain('queueMicrotask');
    expect(textPaneSrc).toContain('Loading editor...');
    expect(textPaneSrc).toContain("profile: 'preview_basic'");
    expect(textPaneSrc).toContain("profile: 'editor_full'");
    expect(textPaneSrc).toContain('runtimeOptions={editorRuntimeOptions()}');
    expect(contentSrc).toContain('Copy path');
    expect(contentSrc).toContain('Edit');
    expect(contentSrc).toContain('Save');
    expect(contentSrc).toContain('Discard');
    expect(rendererRegistrySrc).toContain('truncated={props.truncated}');
    expect(contentSrc).not.toContain('dirty={props.dirty}');
    expect(contentSrc).not.toContain('saving={props.saving}');
    expect(contentSrc).not.toContain('canEdit={props.canEdit}');
    expect(contentSrc).not.toContain('onStartEdit={props.onStartEdit}');
    expect(contentSrc).not.toContain('onSave={props.onSave}');
    expect(contentSrc).not.toContain('onDiscard={props.onDiscard}');
    expect(fs.existsSync(codePreviewPath)).toBe(false);
    expect(contentSrc).toContain('Loading file...');
    expect(contentSrc).toContain('Failed to load file');

    expect(panelSrc).toContain("import { Button, ConfirmDialog } from '@floegence/floe-webapp-core/ui';");
    expect(panelSrc).toContain("import { FilePreviewContent } from './FilePreviewContent';");
    expect(panelSrc).toContain("import { WindowModal } from './WindowModal';");
    expect(panelSrc).toContain('Ask Flower');
    expect(panelSrc).toContain('Download');
    expect(panelSrc).toContain('Unsaved changes');
    expect(panelSrc).toContain('Truncated preview');
    expect(panelSrc).toContain('grid w-full grid-cols-2');
    expect(panelSrc).toContain('<ConfirmDialog');
    expect(panelSrc).toContain('<WindowModal');

    expect(surfaceSrc).toContain("import type { FilePreviewPanelProps } from './FilePreviewPanel';");
    expect(surfaceSrc).toContain("import { FilePreviewPanel } from './FilePreviewPanel';");
    expect(surfaceSrc).toContain("import { PREVIEW_WINDOW_Z_INDEX, PreviewWindow } from './PreviewWindow';");
    expect(surfaceSrc).toContain('layout.isMobile()');
    expect(surfaceSrc).toContain('<PreviewWindow');
    expect(surfaceSrc).toContain('surfaceRef={setFloatingSurfaceEl}');
    expect(surfaceSrc).toContain('<FilePreviewPanel');
    expect(surfaceSrc).toContain("closeConfirmVariant={isMobile() ? 'dialog' : 'floating'}");
    expect(surfaceSrc).toContain('closeConfirmHost={floatingSurfaceEl()}');
    expect(surfaceSrc).not.toContain('rounded-xl border px-3 py-2.5 shadow-sm');
    expect(surfaceSrc).not.toContain('[&>div:last-child]:!w-full');
    expect(surfaceSrc).not.toContain('[&>div>div:last-child]:!w-full');

    expect(envAppLayersSrc).toContain('fileBrowserSurface: 144');
    expect(envAppLayersSrc).toContain('previewWindow: 150');
    expect(envAppLayersSrc).toContain('askFlowerComposer: 160');
    expect(envAppLayersSrc).toContain("previewWindow: 'z-[150]'");

    expect(previewWindowSrc).toContain("import { Dialog } from '@floegence/floe-webapp-core/ui';");
    expect(previewWindowSrc).toContain("from './PersistentFloatingWindow';");
    expect(previewWindowSrc).toContain("from '../utils/envAppLayers';");
    expect(previewWindowSrc).toContain('layout.isMobile()');
    expect(previewWindowSrc).toContain('<Dialog');
    expect(previewWindowSrc).toContain('<PersistentFloatingWindow');
    expect(previewWindowSrc).toContain('surfaceRef={props.surfaceRef}');
    expect(previewWindowSrc).toContain("h-[calc(100dvh-0.5rem)] w-[calc(100vw-0.5rem)] max-h-none");
    expect(previewWindowSrc).toContain('file-preview-floating-window');
    expect(previewWindowSrc).toContain('PREVIEW_WINDOW_Z_INDEX = ENV_APP_FLOATING_LAYER.previewWindow');
    expect(askFlowerComposerSrc).toContain('const ASK_FLOWER_COMPOSER_Z_INDEX = ENV_APP_FLOATING_LAYER.askFlowerComposer;');
    expect(askFlowerComposerSrc).toContain('const ASK_FLOWER_CONTEXT_BROWSER_Z_INDEX = ENV_APP_FLOATING_LAYER.askFlowerContextBrowser;');
    expect(askFlowerComposerSrc).toContain('const ASK_FLOWER_CONTEXT_PREVIEW_Z_INDEX = ENV_APP_FLOATING_LAYER.askFlowerContextPreview;');
    expect(askFlowerComposerSrc).toContain('zIndex={ASK_FLOWER_COMPOSER_Z_INDEX}');
    expect(askFlowerComposerSrc).toContain('zIndex={ASK_FLOWER_CONTEXT_BROWSER_Z_INDEX}');
    expect(askFlowerComposerSrc).toContain('zIndex={ASK_FLOWER_CONTEXT_PREVIEW_Z_INDEX}');
  });

  it('routes remote previews through the shared controller and browser entry points through the app-level browser host', () => {
    const controllerSrc = read('./createFilePreviewController.ts');
    const contextSrc = read('./FilePreviewContext.ts');
    const hostSrc = read('./FilePreviewHost.tsx');
    const remoteSrc = read('./RemoteFileBrowser.tsx');
    const chatSrc = read('./ChatFileBrowserFAB.tsx');
    const shellSrc = read('../EnvAppShell.tsx');

    expect(controllerSrc).toContain("export function createFilePreviewController");
    expect(controllerSrc).toContain("openReadFileStreamChannel");
    expect(controllerSrc).toContain("describeFilePreview");
    expect(controllerSrc).toContain("getRedevenFilePreviewReadPlan");
    expect(controllerSrc).toContain("readPlan.rejectOversizedBeforeRead");
    expect(controllerSrc).toContain("descriptor: previewDescriptor");
    expect(controllerSrc).toContain("rpc: Accessor<RedevenV1Rpc | null | undefined>;");
    expect(controllerSrc).toContain("const [previewDraftText, setPreviewDraftText] = createSignal('');");
    expect(controllerSrc).toContain('Discard unsaved changes in ${currentName} and open ${pendingAction.item.name}?');
    expect(controllerSrc).toContain('await rpc.fs.writeFile({');
    expect(controllerSrc).toContain("workbook.xlsx.load");

    expect(contextSrc).toContain("export function useFilePreviewContext()");
    expect(hostSrc).toContain('<FilePreviewSurface');
    expect(hostSrc).toContain('descriptor={filePreview.controller.descriptor()}');
    expect(hostSrc).toContain('draftText={filePreview.controller.draftText()}');
    expect(hostSrc).toContain('closeConfirmOpen={filePreview.controller.closeConfirmOpen()}');
    expect(hostSrc).toContain('buildFilePreviewAskFlowerIntent');
    expect(hostSrc).toContain('writeTextToClipboard');

    expect(shellSrc).toContain("import { createFilePreviewController } from './widgets/createFilePreviewController';");
    expect(shellSrc).toContain("import { createFileBrowserSurfaceController } from './widgets/createFileBrowserSurfaceController';");
    expect(shellSrc).toContain("import { FileBrowserSurfaceContext } from './widgets/FileBrowserSurfaceContext';");
    expect(shellSrc).toContain("import { FileBrowserSurfaceHost } from './widgets/FileBrowserSurfaceHost';");
    expect(shellSrc).toContain("import { openFileBrowserSurface } from './widgets/openFileBrowserSurface';");
    expect(shellSrc).toContain('const filePreviewController = createFilePreviewController');
    expect(shellSrc).toContain('const fileBrowserSurfaceController = createFileBrowserSurfaceController();');
    expect(shellSrc).toContain('const openFilePreview = async (');
    expect(shellSrc).toContain("setWorkbenchFilePreviewActivation({");
    expect(shellSrc).toContain('<FilePreviewHost />');
    expect(shellSrc).toContain('<FileBrowserSurfaceHost />');
    expect(shellSrc).toContain('<FileBrowserSurfaceContext.Provider value={fileBrowserSurfaceContextValue}>');

    expect(remoteSrc).toContain("import { useFilePreviewContext } from './FilePreviewContext';");
    expect(remoteSrc).not.toContain("import { createFilePreviewController } from './createFilePreviewController';");
    expect(remoteSrc).not.toContain("import { FilePreviewDialog } from './FilePreviewDialog';");
    expect(remoteSrc).not.toContain('<FilePreviewDialog');

    expect(chatSrc).toContain("from './createFileBrowserFABModel';");
    expect(chatSrc).toContain('createFileBrowserFABModel,');
    expect(chatSrc).not.toContain("import { useFileBrowserSurfaceContext } from './FileBrowserSurfaceContext';");
    expect(chatSrc).not.toContain('await fileBrowserSurface.openBrowser(browser);');
    expect(chatSrc).not.toContain("import { RemoteFileBrowser } from './RemoteFileBrowser';");
    expect(chatSrc).not.toContain("import { PersistentFloatingWindow } from './PersistentFloatingWindow';");
  });

  it('routes the chat FAB through the shared browser surface controller', () => {
    const chatSrc = read('./ChatFileBrowserFAB.tsx');
    const codexShellSrc = read('../codex/CodexPageShell.tsx');
    const codexFabSrc = read('../codex/CodexFileBrowserFAB.tsx');

    expect(chatSrc).toContain("from './createFileBrowserFABModel';");
    expect(chatSrc).toContain('createFileBrowserFABModel,');
    expect(chatSrc).toContain('const fab = createFileBrowserFABModel({');
    expect(chatSrc).toContain('<Show when={(props.enabled ?? true) && !fab.fileBrowserSurface.controller.open()}>');
    expect(chatSrc).not.toContain('title="Browser"');
    expect(chatSrc).not.toContain('persistenceKey="chat-browser"');
    expect(chatSrc).not.toContain('stateScope="chat-fab"');
    expect(chatSrc).not.toContain('<RemoteFileBrowser');

    expect(codexShellSrc).toContain("import { CodexFileBrowserFAB } from './CodexFileBrowserFAB';");
    expect(codexShellSrc).not.toContain("import { ChatFileBrowserFAB } from '../widgets/ChatFileBrowserFAB';");
    expect(codexFabSrc).toContain("from '../widgets/createFileBrowserFABModel';");
    expect(codexFabSrc).toContain('createFileBrowserFABModel,');
    expect(codexFabSrc).toContain('const fab = createFileBrowserFABModel({');
    expect(codexFabSrc).toContain('allowHomeFallback: true,');
    expect(codexFabSrc).toContain('class="redeven-fab-file-browser codex-page-file-browser-fab"');
    expect(codexFabSrc).not.toContain("import { Show } from 'solid-js';");
    expect(codexFabSrc).not.toContain('fab.fileBrowserSurface.controller.open()');
    expect(codexFabSrc).not.toContain('<Show when=');
  });
});

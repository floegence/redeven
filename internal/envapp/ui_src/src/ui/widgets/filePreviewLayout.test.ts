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
    const docxPaneSrc = read('./DocxPreviewPane.tsx');
    const textPaneSrc = read('./TextFilePreviewPane.tsx');
    const codePreviewSrc = read('./CodePreviewPane.tsx');
    const surfaceSrc = read('./FilePreviewSurface.tsx');
    const previewWindowSrc = read('./PreviewWindow.tsx');

    expect(contentSrc).toContain("import { DocxPreviewPane } from './DocxPreviewPane';");
    expect(contentSrc).toContain("import { TextFilePreviewPane } from './TextFilePreviewPane';");
    expect(contentSrc).toContain('<DocxPreviewPane bytes={props.bytes} />');
    expect(contentSrc).toContain('<TextFilePreviewPane');
    expect(docxPaneSrc).toContain("import('docx-preview')");
    expect(docxPaneSrc).toContain('ResizeObserver');
    expect(docxPaneSrc).toContain('inWrapper: true');
    expect(docxPaneSrc).toContain('Fit');
    expect(docxPaneSrc).toContain('Zoom in docx preview');
    expect(textPaneSrc).toContain("from '@floegence/floe-webapp-core/editor';");
    expect(textPaneSrc).toContain('resolveCodeEditorLanguageSpec');
    expect(textPaneSrc).toContain('type CodeEditorApi');
    expect(textPaneSrc).toContain('type CodeEditorProps');
    expect(textPaneSrc).toContain('supportsRichMonacoCodePreview');
    expect(textPaneSrc).toContain('Loading editor...');
    expect(contentSrc).toContain('Copy path');
    expect(contentSrc).toContain('Edit');
    expect(contentSrc).toContain('Save');
    expect(contentSrc).toContain('Discard');
    expect(codePreviewSrc).toContain('Syntax highlighting disabled for large files.');
    expect(codePreviewSrc).toContain('resolveCodeHighlightTheme');
    expect(contentSrc).toContain('Loading file...');
    expect(contentSrc).toContain('Failed to load file');

    expect(surfaceSrc).toContain("import { Button, ConfirmDialog } from '@floegence/floe-webapp-core/ui';");
    expect(surfaceSrc).toContain("import { PREVIEW_WINDOW_Z_INDEX, PreviewWindow } from './PreviewWindow';");
    expect(surfaceSrc).toContain('layout.isMobile()');
    expect(surfaceSrc).toContain('<PreviewWindow');
    expect(surfaceSrc).toContain('<ConfirmDialog');
    expect(surfaceSrc).toContain('Ask Flower');
    expect(surfaceSrc).toContain('Download');
    expect(surfaceSrc).toContain('Unsaved changes');
    expect(surfaceSrc).toContain('Truncated preview');
    expect(surfaceSrc).toContain('grid w-full grid-cols-2');
    expect(surfaceSrc).not.toContain('rounded-xl border px-3 py-2.5 shadow-sm');
    expect(surfaceSrc).not.toContain('[&>div:last-child]:!w-full');
    expect(surfaceSrc).not.toContain('[&>div>div:last-child]:!w-full');

    expect(previewWindowSrc).toContain("import { Dialog } from '@floegence/floe-webapp-core/ui';");
    expect(previewWindowSrc).toContain("import { PersistentFloatingWindow } from './PersistentFloatingWindow';");
    expect(previewWindowSrc).toContain('layout.isMobile()');
    expect(previewWindowSrc).toContain('<Dialog');
    expect(previewWindowSrc).toContain('<PersistentFloatingWindow');
    expect(previewWindowSrc).toContain("h-[calc(100dvh-0.5rem)] w-[calc(100vw-0.5rem)] max-h-none");
    expect(previewWindowSrc).toContain('file-preview-floating-window');
    expect(previewWindowSrc).toContain('PREVIEW_WINDOW_Z_INDEX = 150');
  });

  it('routes remote and chat previews through the shared controller and app-level host', () => {
    const controllerSrc = read('./createFilePreviewController.ts');
    const contextSrc = read('./FilePreviewContext.ts');
    const hostSrc = read('./FilePreviewHost.tsx');
    const remoteSrc = read('./RemoteFileBrowser.tsx');
    const chatSrc = read('./ChatFileBrowserFAB.tsx');
    const shellSrc = read('../EnvAppShell.tsx');

    expect(controllerSrc).toContain("export function createFilePreviewController");
    expect(controllerSrc).toContain("openReadFileStreamChannel");
    expect(controllerSrc).toContain("describeFilePreview");
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
    expect(shellSrc).toContain('const filePreviewController = createFilePreviewController');
    expect(shellSrc).toContain('<FilePreviewHost />');

    expect(remoteSrc).toContain("import { useFilePreviewContext } from './FilePreviewContext';");
    expect(remoteSrc).not.toContain("import { createFilePreviewController } from './createFilePreviewController';");
    expect(remoteSrc).not.toContain("import { FilePreviewDialog } from './FilePreviewDialog';");
    expect(remoteSrc).not.toContain('<FilePreviewDialog');

    expect(chatSrc).toContain("import { useFilePreviewContext } from './FilePreviewContext';");
    expect(chatSrc).not.toContain("import { createFilePreviewController } from './createFilePreviewController';");
    expect(chatSrc).not.toContain("import { FilePreviewDialog } from './FilePreviewDialog';");
    expect(chatSrc).not.toContain('<FilePreviewDialog');
  });

  it('keeps the chat FAB file browser sidebar persistence scoped to its own surface', () => {
    const chatSrc = read('./ChatFileBrowserFAB.tsx');

    expect(chatSrc).toContain("const CHAT_FAB_SIDEBAR_WIDTH_STORAGE_KEY = 'chat-fab-files:sidebar-width';");
    expect(chatSrc).toContain('sidebarWidthStorageKey={CHAT_FAB_SIDEBAR_WIDTH_STORAGE_KEY}');
    expect(chatSrc).toContain('persistenceKey="chat-fab-files"');
  });
});

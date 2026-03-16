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
    const surfaceSrc = read('./FilePreviewSurface.tsx');

    expect(contentSrc).toContain("import { DocxPreviewPane } from './DocxPreviewPane';");
    expect(contentSrc).toContain('<DocxPreviewPane bytes={props.bytes} />');
    expect(docxPaneSrc).toContain("import('docx-preview')");
    expect(docxPaneSrc).toContain('ResizeObserver');
    expect(docxPaneSrc).toContain('inWrapper: true');
    expect(docxPaneSrc).toContain('Fit');
    expect(docxPaneSrc).toContain('Zoom in docx preview');
    expect(contentSrc).toContain('Loading file...');
    expect(contentSrc).toContain('Failed to load file');

    expect(surfaceSrc).toContain("import { Button, Dialog, FloatingWindow } from '@floegence/floe-webapp-core/ui';");
    expect(surfaceSrc).toContain('layout.isMobile()');
    expect(surfaceSrc).toContain('<Dialog');
    expect(surfaceSrc).toContain('<FloatingWindow');
    expect(surfaceSrc).toContain('Ask Flower');
    expect(surfaceSrc).toContain('Download');
    expect(surfaceSrc).toContain("h-[calc(100dvh-0.5rem)] w-[calc(100vw-0.5rem)] max-h-none");
    expect(surfaceSrc).toContain('file-preview-floating-window');
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
    expect(controllerSrc).toContain("workbook.xlsx.load");

    expect(contextSrc).toContain("export function useFilePreviewContext()");
    expect(hostSrc).toContain('<FilePreviewSurface');
    expect(hostSrc).toContain('buildFilePreviewAskFlowerIntent');

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
});

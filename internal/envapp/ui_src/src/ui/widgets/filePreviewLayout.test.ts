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
  it('keeps file preview on a responsive dialog surface', () => {
    const dialogSrc = read('./FilePreviewDialog.tsx');

    expect(dialogSrc).toContain("import { Button, Dialog } from '@floegence/floe-webapp-core/ui';");
    expect(dialogSrc).toContain("h-[calc(100dvh-0.5rem)] w-[calc(100vw-0.5rem)] max-h-none");
    expect(dialogSrc).toContain('Ask Flower');
    expect(dialogSrc).toContain('Download');
    expect(dialogSrc).not.toContain('FloatingWindow');
  });

  it('routes remote and chat previews through the shared controller and dialog', () => {
    const controllerSrc = read('./createFilePreviewController.ts');
    const remoteSrc = read('./RemoteFileBrowser.tsx');
    const chatSrc = read('./ChatFileBrowserFAB.tsx');

    expect(controllerSrc).toContain("export function createFilePreviewController");
    expect(controllerSrc).toContain("openReadFileStreamChannel");
    expect(controllerSrc).toContain("workbook.xlsx.load");

    expect(remoteSrc).toContain("import { createFilePreviewController } from './createFilePreviewController';");
    expect(remoteSrc).toContain("import { FilePreviewDialog } from './FilePreviewDialog';");
    expect(remoteSrc).toContain("const filePreview = createFilePreviewController");
    expect(remoteSrc).toContain("<FilePreviewDialog");
    expect(remoteSrc).not.toContain('previewAskMenu');
    expect(remoteSrc).not.toContain('FloatingWindow');

    expect(chatSrc).toContain("import { createFilePreviewController } from './createFilePreviewController';");
    expect(chatSrc).toContain("import { FilePreviewDialog } from './FilePreviewDialog';");
    expect(chatSrc).toContain("<FilePreviewDialog");
  });
});

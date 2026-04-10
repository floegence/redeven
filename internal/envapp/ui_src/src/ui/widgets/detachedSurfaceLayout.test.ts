import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function read(relPath: string): string {
  const here = fileURLToPath(import.meta.url);
  const dir = path.dirname(here);
  return fs.readFileSync(path.resolve(dir, relPath), 'utf8');
}

describe('detached surface desktop wiring', () => {
  it('keeps detached preview routing in EnvAppShell and isolated browser state in the detached scene', () => {
    const shellSrc = read('../EnvAppShell.tsx');
    const sceneSrc = read('./DetachedSurfaceScene.tsx');
    const browserSrc = read('./RemoteFileBrowser.tsx');
    const frameSrc = read('./DesktopDetachedWindowFrame.tsx');
    const detachedSurfaceSrc = read('../services/detachedSurface.ts');

    expect(shellSrc).toContain("parseDetachedSurfaceFromURL(window.location)");
    expect(shellSrc).toContain("shouldOpenDetachedSurface({ runtime, kind: 'file_preview' })");
    expect(shellSrc).toContain("const surface = buildDetachedFilePreviewSurface(item);");
    expect(shellSrc).toContain('openDetachedSurfaceWindow(surface);');
    expect(shellSrc).toContain("buildDetachedDebugConsoleSurface()");
    expect(shellSrc).toContain('<DetachedSurfaceScene');

    expect(detachedSurfaceSrc).toContain("file_preview: 'detached'");
    expect(detachedSurfaceSrc).toContain("file_browser: 'floating'");
    expect(detachedSurfaceSrc).toContain("debug_console: 'detached'");
    expect(detachedSurfaceSrc).toContain("resolveDesktopSurfacePresentation(kind: DetachedSurfaceKind)");
    expect(detachedSurfaceSrc).toContain("shouldOpenDetachedSurface(args: Readonly<{");

    expect(frameSrc).toContain("data-redeven-desktop-window-titlebar=\"true\"");
    expect(frameSrc).toContain("data-redeven-desktop-window-titlebar-content=\"true\"");
    expect(frameSrc).toContain("data-redeven-desktop-titlebar-drag-region=\"true\"");
    expect(sceneSrc).toContain('stateScope="detached-surface"');
    expect(sceneSrc).toContain("import { DesktopDetachedWindowFrame } from './DesktopDetachedWindowFrame';");
    expect(sceneSrc).toContain('<DesktopDetachedWindowFrame');
    expect(sceneSrc).toContain('showHeader={false}');
    expect(sceneSrc).toContain('<RemoteFileBrowser');
    expect(sceneSrc).toContain("<DebugConsolePanel");
    expect(sceneSrc).toContain("<DebugConsoleFooter");
    expect(sceneSrc).toContain('document.title = detachedSceneTitle(props.surface);');
    expect(sceneSrc).toContain('<FilePreviewControllerContent');
    expect(sceneSrc).toContain('const sceneModel = createMemo<DetachedSurfaceFrameModel>');
    expect(sceneSrc).toContain('headerActions: props.accessGateVisible ? undefined : previewHeaderActions()');
    expect(sceneSrc).toContain("await writeTextToClipboard(path)");
    expect(sceneSrc).toContain("filePreview.controller.selectedText() ?? '').trim() || readSelectionTextFromPreview(previewContentEl)");

    expect(browserSrc).toContain('stateScope?: string;');
    expect(browserSrc).toContain('initialPathOverride?: string;');
    expect(browserSrc).toContain('homePathOverride?: string;');
    expect(browserSrc).toContain("browserStateScope() === 'page' ? key : `${key}:${browserStateScope()}`");
  });
});

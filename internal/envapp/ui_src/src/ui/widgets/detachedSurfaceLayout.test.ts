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

    expect(shellSrc).toContain("parseDetachedSurfaceFromURL(window.location)");
    expect(shellSrc).toContain("const surface = buildDetachedFilePreviewSurface(item);");
    expect(shellSrc).toContain('openDetachedSurfaceWindow(surface);');
    expect(shellSrc).toContain('<DetachedSurfaceScene');

    expect(sceneSrc).toContain('stateScope="detached-surface"');
    expect(sceneSrc).toContain('<RemoteFileBrowser');
    expect(sceneSrc).toContain('document.title = detachedSceneTitle(props.surface);');

    expect(browserSrc).toContain('stateScope?: string;');
    expect(browserSrc).toContain('initialPathOverride?: string;');
    expect(browserSrc).toContain('homePathOverride?: string;');
    expect(browserSrc).toContain("browserStateScope() === 'page' ? key : `${key}:${browserStateScope()}`");
  });
});

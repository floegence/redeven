import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function read(relPath: string): string {
  const here = fileURLToPath(import.meta.url);
  const dir = path.dirname(here);
  return fs.readFileSync(path.resolve(dir, relPath), 'utf8');
}

describe('git history layout wiring', () => {
  it('shares the explorer width storage key between files mode and git mode', () => {
    const src = read('./RemoteFileBrowser.tsx');

    expect(src).toContain("const PAGE_SIDEBAR_WIDTH_STORAGE_KEY = 'redeven:remote-file-browser:page-sidebar-width';");
    expect(src).toContain('sidebarWidthStorageKey={PAGE_SIDEBAR_WIDTH_STORAGE_KEY}');
    expect(src).toContain('width={gitHistorySidebarWidth()}');
    expect(src).toContain('resizable');
  });

  it('uses the git sidebar as the single navigation surface for mode and view switching', () => {
    const src = read('./GitWorkbenchSidebar.tsx');

    expect(src).toContain("import { GitHistoryModeSwitch, type GitHistoryMode } from './GitHistoryModeSwitch';");
    expect(src).toContain("import { GitSubviewSwitch } from './GitSubviewSwitch';");
    expect(src).toContain('title="Git"');
    expect(src).toContain('headerActions={<span class="text-[10px] uppercase tracking-[0.18em] text-muted-foreground/70">Navigator</span>}');
    expect(src).toContain('props.onClose?.();');
  });

  it('keeps the git sidebar mounted for overview so navigation stays in one place', () => {
    const src = read('./RemoteFileBrowser.tsx');
    const start = src.indexOf('const handleGitSubviewChange = (view: GitWorkbenchSubview) => {');
    expect(start).toBeGreaterThanOrEqual(0);
    const end = src.indexOf("const showPageSidebar = () => pageMode() === 'git';", start);
    expect(end).toBeGreaterThan(start);
    const handler = src.slice(start, end);

    expect(handler).toContain('setGitSubview(view);');
    expect(handler).not.toContain('refreshGitWorkbench');
    expect(handler).not.toContain('await ');
    expect(src).toContain("const showPageSidebar = () => pageMode() === 'git';");
  });

  it('keeps the global git header focused on context and refresh only', () => {
    const src = read('./GitWorkbench.tsx');

    expect(src).toContain('Refresh');
    expect(src).toContain('subviewLabel(props.subview)');
    expect(src).not.toContain('GitHistoryModeSwitch');
    expect(src).not.toContain('GitSubviewSwitch');
  });
});

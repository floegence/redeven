import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function read(relPath: string): string {
  const here = fileURLToPath(import.meta.url);
  const dir = path.dirname(here);
  return fs.readFileSync(path.resolve(dir, relPath), 'utf8');
}

describe('browser workspace layout wiring', () => {
  it('shares one sidebar width state across files mode and git mode', () => {
    const src = read('./RemoteFileBrowser.tsx');

    expect(src).toContain("const PAGE_SIDEBAR_WIDTH_STORAGE_KEY = 'redeven:remote-file-browser:page-sidebar-width';");
    expect(src).toContain('width={browserSidebarWidth()}');
    expect(src).toContain('setBrowserSidebarWidth((width) => normalizePageSidebarWidth(width + delta))');
  });

  it('routes files mode and git mode through dedicated unified workspace shells', () => {
    const src = read('./RemoteFileBrowser.tsx');

    expect(src).toContain("import { FileBrowserWorkspace } from './FileBrowserWorkspace';");
    expect(src).toContain("import { GitWorkspace } from './GitWorkspace';");
    expect(src).toContain('<FileBrowserWorkspace');
    expect(src).toContain('<GitWorkspace');
    expect(src).not.toContain('sidebarHeaderActions={');
  });

  it('keeps mode and git subview navigation out of selector-only sidebar content', () => {
    const src = read('./GitWorkbenchSidebar.tsx');

    expect(src).not.toContain('SidebarPane');
    expect(src).not.toContain('GitHistoryModeSwitch');
    expect(src).not.toContain('GitSubviewSwitch');
  });

  it('pins the mode switch area in the shared browser shell', () => {
    const src = read('./BrowserWorkspaceShell.tsx');

    expect(src).toContain('Mode');
    expect(src).toContain('props.modeSwitcher');
  });

  it('keeps semantic sidebar controls and mobile-first grids in the new git chrome', () => {
    const modeSrc = read('./GitHistoryModeSwitch.tsx');
    const navSrc = read('./GitViewNav.tsx');
    const sidebarSrc = read('./GitWorkbenchSidebar.tsx');
    const overviewSrc = read('./GitOverviewPanel.tsx');
    const branchesSrc = read('./GitBranchesPanel.tsx');

    expect(modeSrc).toContain('role="radiogroup"');
    expect(modeSrc).toContain('aria-label="Browser mode"');
    expect(modeSrc).toContain('grid grid-cols-2');
    expect(modeSrc).toContain('sm:inline-flex');

    expect(navSrc).toContain('role="tablist"');
    expect(navSrc).toContain('aria-label="Git views"');
    expect(navSrc).toContain('gitToneSelectableCardClass');

    expect(sidebarSrc).toContain('grid grid-cols-1 gap-2 text-[11px] sm:grid-cols-2');
    expect(overviewSrc).toContain('mt-4 grid grid-cols-1 gap-2 text-[11px] sm:grid-cols-2 xl:grid-cols-4');
    expect(overviewSrc).toContain('mt-4 grid grid-cols-1 gap-2 text-[11px] sm:grid-cols-2');
    expect(branchesSrc).toContain('mt-4 grid grid-cols-1 gap-2 text-[11px] sm:grid-cols-2');
  });

  it('uses the dedicated git view navigation inside the git workspace shell', () => {
    const src = read('./GitWorkspace.tsx');

    expect(src).toContain("import { GitViewNav } from './GitViewNav';");
    expect(src).toContain('navigationLabel="View"');
    expect(src).toContain('<GitViewNav');
  });

  it('keeps the git content header focused on context and refresh only', () => {
    const src = read('./GitWorkbench.tsx');

    expect(src).toContain('Refresh');
    expect(src).toContain('subviewLabel(props.subview)');
    expect(src).not.toContain('GitHistoryModeSwitch');
    expect(src).not.toContain('GitSubviewSwitch');
  });
});

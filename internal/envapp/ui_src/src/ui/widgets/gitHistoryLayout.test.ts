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

  it('uses a compact mode switch and a rail-free shared browser shell', () => {
    const modeSrc = read('./GitHistoryModeSwitch.tsx');
    const shellSrc = read('./BrowserWorkspaceShell.tsx');
    const navSrc = read('./GitViewNav.tsx');

    expect(modeSrc).toContain('role="radiogroup"');
    expect(modeSrc).toContain('aria-label="Browser mode"');
    expect(modeSrc).toContain('inline-flex w-full items-center gap-0.5 rounded-lg border border-border bg-muted/40 p-0.5');
    expect(modeSrc).not.toContain('>Browse<');
    expect(modeSrc).not.toContain('>Inspect<');

    expect(shellSrc).not.toContain('ActivityBar');
    expect(shellSrc).not.toContain('showSidebarToggle');
    expect(shellSrc).not.toContain('sidebarToggleLabel');
    expect(shellSrc).not.toContain('sidebarToggleIcon');
    expect(shellSrc).not.toContain('mobileSidebarToggleMode');

    expect(navSrc).toContain('role="tablist"');
    expect(navSrc).toContain('aria-label="Git views"');
    expect(navSrc).toContain('rounded-lg border px-2.5 py-2');
    expect(navSrc).toContain('border-border bg-background text-foreground shadow-sm');
    expect(navSrc).toContain('border-transparent bg-transparent text-muted-foreground hover:border-transparent hover:bg-muted/50 hover:text-muted-foreground');
    expect(navSrc).toContain('border-border bg-muted/70 text-foreground');
    expect(navSrc).not.toContain('gitSubviewTone');
    expect(navSrc).not.toContain('gitToneBadgeClass');
    expect(navSrc).not.toContain('gitToneSelectableCardClass');
  });

  it('uses floating diff dialogs instead of inline patch sections', () => {
    const changesSrc = read('./GitChangesPanel.tsx');
    const branchesSrc = read('./GitBranchesPanel.tsx');
    const historySrc = read('./GitHistoryBrowser.tsx');

    expect(changesSrc).toContain("import { GitDiffDialog } from './GitDiffDialog';");
    expect(branchesSrc).toContain("import { GitDiffDialog } from './GitDiffDialog';");
    expect(historySrc).toContain("import { GitDiffDialog } from './GitDiffDialog';");
    expect(branchesSrc).not.toContain('The selected file patch stays in the main detail surface');
    expect(historySrc).not.toContain('The selected file patch stays in the main detail surface');
  });


  it('stacks commit message details above changed files and clamps the preview', () => {
    const historySrc = read('./GitHistoryBrowser.tsx');

    expect(historySrc).toContain('const COMMIT_BODY_PREVIEW_LINES = 2;');
    expect(historySrc).toContain('const COMMIT_BODY_PREVIEW_CHARS = 160;');
    expect(historySrc).toContain('body.split(/\\r?\\n/)');
    expect(historySrc).toContain("lines.slice(1).join('\\n').trim()");
    expect(historySrc).toContain('space-y-1.5 sm:space-y-2');
    expect(historySrc).toContain('aria-expanded={commitBodyExpanded()}');
    expect(historySrc).not.toContain('xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]');
  });

  it('stacks branch compare details into compact vertical sections', () => {
    const branchesSrc = read('./GitBranchesPanel.tsx');

    expect(branchesSrc).toContain('space-y-1.5 sm:space-y-2');
    expect(branchesSrc).toContain('Compare Snapshot');
    expect(branchesSrc).toContain('Reference');
    expect(branchesSrc).toContain('Latest commit');
    expect(branchesSrc).toContain('Linked worktree');
    expect(branchesSrc).not.toContain('Branch State');
    expect(branchesSrc).not.toContain('xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]');
  });


  it('keeps overview and changes panels on the same compact vertical rhythm', () => {
    const overviewSrc = read('./GitOverviewPanel.tsx');
    const changesSrc = read('./GitChangesPanel.tsx');

    expect(overviewSrc).toContain('Workspace Summary');
    expect(overviewSrc).toContain('Selected Branch');
    expect(overviewSrc).toContain('Repository Signals');
    expect(overviewSrc).toContain('grid grid-cols-1 gap-1.5 text-[11px] sm:grid-cols-2 xl:grid-cols-3');
    expect(overviewSrc).not.toContain('xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]');
    expect(overviewSrc).not.toContain('text-[24px] font-semibold tracking-tight');

    expect(changesSrc).toContain('Workspace Summary');
    expect(changesSrc).toContain('Focused File');
    expect(changesSrc).not.toContain('border-b border-border/70 px-3 py-2');
    expect(changesSrc).not.toContain('xl:grid-cols-[minmax(0,1.12fr)_minmax(320px,0.88fr)]');
    expect(changesSrc).not.toContain('min-h-[148px]');
    expect(changesSrc).not.toContain('text-[24px] font-semibold tracking-tight');
  });

  it('uses the dedicated git view navigation inside the git workspace shell', () => {
    const src = read('./GitWorkspace.tsx');

    expect(src).toContain("import { GitViewNav } from './GitViewNav';");
    expect(src).toContain('navigationLabel="View"');
    expect(src).toContain('<GitViewNav');
  });

  it('lets the files activity control page-level mobile sidebars while widget views use header buttons', () => {
    const envSrc = read('../EnvAppShell.tsx');
    const browserSrc = read('./RemoteFileBrowser.tsx');

    expect(envSrc).toContain('filesSidebarOpen: filesMobileSidebarOpen');
    expect(envSrc).toContain('toggleFilesSidebar: toggleFilesMobileSidebar');
    expect(envSrc).toContain("layout.setSidebarActiveTab('files', { openSidebar: false });");
    expect(browserSrc).toContain('ctx.filesSidebarOpen()');
    expect(browserSrc).toContain('ctx.setFilesSidebarOpen(open);');
    expect(browserSrc).toContain('const togglePageSidebar = () => setMobileSidebarOpen(!mobileSidebarOpen());');
    expect(browserSrc).toContain('showMobileSidebarButton={layout.isMobile() && Boolean(props.widgetId)}');
    expect(browserSrc).toContain('onToggleSidebar={togglePageSidebar}');
    expect(browserSrc).not.toContain("mobileSidebarToggleMode={props.widgetId ? 'internal' : 'external'}");
    expect(browserSrc).not.toContain('showSidebarToggle={layout.isMobile() && Boolean(props.widgetId)}');
  });

  it('keeps the git content header focused on context, refresh, and an optional mobile sidebar button', () => {
    const src = read('./GitWorkbench.tsx');

    expect(src).toContain('Refresh');
    expect(src).toContain('showMobileSidebarButton');
    expect(src).toContain('onToggleSidebar');
    expect(src).toContain('Toggle browser sidebar');
    expect(src).toContain('subviewLabel(props.subview)');
    expect(src).not.toContain('GitHistoryModeSwitch');
    expect(src).not.toContain('GitSubviewSwitch');
  });
});

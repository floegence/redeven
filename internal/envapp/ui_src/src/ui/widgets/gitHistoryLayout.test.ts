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


  it('keeps the file tree on its own sidebar scroll container inside the shared shell', () => {
    const shellSrc = read('./BrowserWorkspaceShell.tsx');
    const workspaceSrc = read('./FileBrowserWorkspace.tsx');
    const treeSrc = read('./FileBrowserSidebarTree.tsx');

    expect(shellSrc).toContain('sidebarBodyClass?: string;');
    expect(shellSrc).toContain("bodyClass={cn('py-0', props.sidebarBodyClass)}");
    expect(shellSrc).not.toContain('rounded-2xl border border-border/60 bg-gradient-to-b');
    expect(shellSrc).not.toContain('rounded-xl border border-border/60 bg-muted/[0.05]');
    expect(workspaceSrc).toContain('sidebarBodyClass="overflow-hidden"');
    expect(workspaceSrc).toContain('data-testid="file-tree-scroll-region"');
    expect(workspaceSrc).toContain('getSidebarScrollContainer: () => treeScrollEl');
    expect(workspaceSrc).toContain('overflow-auto overflow-x-hidden overscroll-contain');
    expect(workspaceSrc).toContain('[-webkit-overflow-scrolling:touch]');
    expect(workspaceSrc).toContain('[touch-action:pan-y_pinch-zoom]');
    expect(workspaceSrc).not.toContain('FileBrowserCurrentFolderCard');
    expect(workspaceSrc).toContain('<FileBrowserSidebarTree');
    expect(workspaceSrc).not.toContain('DirectoryTree');
    expect(workspaceSrc).not.toContain("from './GitChrome'");
    expect(workspaceSrc).not.toContain('gitToneBadgeClass');
    expect(workspaceSrc).not.toContain('gitToneInsetClass');
    expect(workspaceSrc).not.toContain('Files</span>');
    expect(treeSrc).not.toContain('Current Folder');
    expect(treeSrc).not.toContain('FileBrowserCurrentFolderCard');
    expect(treeSrc).not.toContain("from './GitChrome'");
    expect(treeSrc).not.toContain('gitToneBadgeClass');
    expect(treeSrc).not.toContain('gitToneInsetClass');
    expect(treeSrc).toContain('MAX_VISIBLE_DEPTH = 5');
    expect(treeSrc).toContain('data-tree-row-path={props.item.path}');
    expect(treeSrc).toContain("scrollIntoView({ block: 'nearest', inline: 'nearest' })");
    expect(workspaceSrc).not.toContain('getSidebarScrollContainer: () => sidebarScrollEl');
  });

  it('uses a compact mode switch and a rail-free shared browser shell', () => {
    const modeSrc = read('./GitHistoryModeSwitch.tsx');
    const shellSrc = read('./BrowserWorkspaceShell.tsx');
    const navSrc = read('./GitViewNav.tsx');

    expect(modeSrc).toContain('role="radiogroup"');
    expect(modeSrc).toContain('aria-label="Browser mode"');
    expect(modeSrc).toContain('inline-flex w-full items-center gap-0.5 rounded-md border border-border bg-muted/40 p-0.5 shadow-[0_1px_0_rgba(0,0,0,0.03)_inset]');
    expect(modeSrc).not.toContain('>Browse<');
    expect(modeSrc).not.toContain('>Inspect<');

    expect(shellSrc).not.toContain('ActivityBar');
    expect(shellSrc).not.toContain('showSidebarToggle');
    expect(shellSrc).not.toContain('sidebarToggleLabel');
    expect(shellSrc).not.toContain('sidebarToggleIcon');
    expect(shellSrc).not.toContain('mobileSidebarToggleMode');

    // Mobile sidebar must use absolute overlay (not SidebarPane's built-in)
    expect(shellSrc).toContain('mobileOverlay={false}');
    expect(shellSrc).toContain('mobileBackdrop={false}');
    expect(shellSrc).toContain("isMobile() && 'absolute inset-y-0 left-0 z-30 shadow-xl max-w-[80vw]'");
    expect(shellSrc).toContain('isMobile() ? MOBILE_SIDEBAR_WIDTH : props.width');
    expect(shellSrc).toContain('bg-black/30');
    expect(shellSrc).toContain('Close sidebar');

    expect(navSrc).toContain('role="tablist"');
    expect(navSrc).toContain('aria-label="Git views"');
    expect(navSrc).toContain('space-y-0.5 rounded-md bg-muted/[0.14] p-0.5');
    expect(navSrc).toContain('rounded px-2.5 py-2.5');
    expect(navSrc).toContain('sm:py-1.5');
    expect(navSrc).toContain('border-l-[2px] border-primary bg-background text-foreground shadow-sm');
    expect(navSrc).toContain('bg-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground');
    expect(navSrc).toContain('bg-muted/70 text-foreground');
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
    expect(overviewSrc).toContain('GitStatStrip');
    expect(overviewSrc).toContain('columnsClass="grid-cols-2 xl:grid-cols-4"');
    expect(overviewSrc).toContain('space-y-0.5 rounded-md bg-muted/[0.12] p-0.5');
    expect(overviewSrc).toContain('rounded bg-background/70 px-2 py-1.5 text-[11px] transition-shadow duration-150 hover:shadow-sm');
    expect(overviewSrc).not.toContain('xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]');
    expect(overviewSrc).not.toContain('text-[24px] font-semibold tracking-tight');

    expect(changesSrc).toContain('Workspace Summary');
    expect(changesSrc).toContain('Focused File');
    expect(changesSrc).toContain('GitSubtleNote');
    expect(changesSrc).toContain('columnsClass="grid-cols-2 lg:grid-cols-4"');
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

  it('keeps the git sidebar labels and density aligned with the compact workspace language', () => {
    const src = read('./GitWorkbenchSidebar.tsx');

    expect(src).toContain('Overview Summary');
    expect(src).toContain('Workspace Summary');
    expect(src).toContain('Branch Scope');
    expect(src).toContain('Commit History');
    expect(src).toContain('Local Branches');
    expect(src).toContain('Remote Branches');
    expect(src).toContain('Quick counts and repository context.');
    expect(src).toContain('Choose a file to open its floating diff.');
    expect(src).toContain('space-y-1.5 sm:space-y-2');
    expect(src).not.toContain('Workspace Files');
    expect(src).not.toContain('History loaded');
    expect(src).not.toContain('No files in this group.');
    expect(src).not.toContain('text-lg font-semibold tracking-tight');
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

  it('keeps the git content header compact and aligned with the latest workspace language', () => {
    const src = read('./GitWorkbench.tsx');

    expect(src).toContain('Refresh');
    expect(src).toContain('showMobileSidebarButton');
    expect(src).toContain('onToggleSidebar');
    expect(src).toContain('Toggle browser sidebar');
    expect(src).toContain('Repository Context');
    expect(src).not.toContain('Compact repo signals and actions for the current view.');
    expect(src).toContain('Workspace Summary');
    expect(src).toContain('Sync Status');
    expect(src).toContain('Focused View');
    expect(src).toContain('gitToneActionButtonClass()');
    expect(src).toContain('variant="ghost"');
    expect(src).toContain('bg-gradient-to-b from-background to-background/95');
    expect(src).not.toContain('bg-card');
    expect(src).not.toContain("gitToneSurfaceClass(subviewTone())");
    expect(src).not.toContain('variant="outline"');
    expect(src).not.toContain('rounded-lg border border-border/50 bg-muted/[0.18]');
    expect(src).not.toContain('GitHistoryModeSwitch');
    expect(src).not.toContain('GitSubviewSwitch');
  });

  it('keeps git diff surfaces aligned with floe-webapp dialog style', () => {
    const dialogSrc = read('./GitDiffDialog.tsx');
    const patchSrc = read('./GitPatchViewer.tsx');
    const patchUtilSrc = read('../utils/gitPatch.ts');

    expect(dialogSrc).toContain('rounded-md p-0');
    expect(dialogSrc).not.toContain('border-0');
    expect(dialogSrc).not.toContain('rounded-[20px]');
    expect(dialogSrc).not.toContain('rounded-xl');
    expect(patchSrc).toContain('rounded-md bg-muted/[0.16]');
    expect(patchSrc).toContain('max-h-[60vh]');
    expect(patchSrc).toContain('sm:max-h-[28rem]');
    expect(patchSrc).toContain('overflow-auto rounded-md bg-background/78 p-0.5');
    expect(patchSrc).not.toContain('chat-tool-apply-patch');
    expect(patchUtilSrc).toContain("return 'border-l-[2px] border-l-success/60 bg-success/10';");
    expect(patchUtilSrc).toContain("return 'text-success';");
    expect(patchUtilSrc).not.toContain('chat-tool-apply-patch');
  });

  it('keeps git empty-state copy aligned with the compact review language', () => {
    const overviewSrc = read('./GitOverviewPanel.tsx');
    const changesSrc = read('./GitChangesPanel.tsx');
    const branchesSrc = read('./GitBranchesPanel.tsx');
    const historySrc = read('./GitHistoryBrowser.tsx');

    expect(changesSrc).toContain('Choose a workspace file');
    expect(changesSrc).toContain('Select a file from the sidebar to load its floating diff.');
    expect(changesSrc).not.toContain('No file selected');

    expect(overviewSrc).toContain('Choose a branch from the sidebar to load compare context.');
    expect(overviewSrc).toContain('Branch compare details appear here after you pick a branch from the sidebar.');

    expect(branchesSrc).toContain('Choose a branch from the sidebar to load compare context.');
    expect(branchesSrc).toContain('Compare details appear here after you choose a branch from the sidebar.');
    expect(branchesSrc).not.toContain('Select a branch from the sidebar to inspect compare details.');

    expect(historySrc).toContain('Choose a commit from the sidebar to load its details.');
    expect(historySrc).toContain('Commit details are unavailable.');
    expect(historySrc).not.toContain('Select a commit from the sidebar to inspect its details.');
  });

});

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
    expect(workspaceSrc).toContain('redeven-file-list-compact');
    expect(workspaceSrc).toContain('border-b border-border/60 bg-background/95 px-2.5 py-1.5');
    expect(workspaceSrc).toContain('text-[9px] font-medium uppercase tracking-[0.14em] text-muted-foreground/60');
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
    expect(treeSrc).toContain('group flex items-center rounded-md py-0.5 text-xs');
    expect(treeSrc).toContain('h-3.5 w-3.5 shrink-0');
    expect(treeSrc).toContain('gap-1 rounded py-0.5 pl-1 pr-1.5 text-left text-xs');
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

  it('keeps changes and branch compare on dialog-based diff flows while history stays patch-driven', () => {
    const changesSrc = read('./GitChangesPanel.tsx');
    const branchesSrc = read('./GitBranchesPanel.tsx');
    const historySrc = read('./GitHistoryBrowser.tsx');
    const commitDialogSrc = read('./GitCommitDialog.tsx');

    expect(changesSrc).toContain("import { GitDiffDialog } from './GitDiffDialog';");
    expect(branchesSrc).toContain("import { GitDiffDialog } from './GitDiffDialog';");
    expect(historySrc).toContain("import { GitDiffDialog } from './GitDiffDialog';");
    expect(historySrc).not.toContain("import { GitPatchViewer } from './GitPatchViewer';");
    expect(changesSrc).toContain('gitChangePathClass(item.changeType)');
    expect(branchesSrc).toContain('gitChangePathClass(item.changeType)');
    expect(historySrc).toContain('gitChangePathClass(file.changeType)');
    expect(commitDialogSrc).toContain('gitChangePathClass(item.changeType)');
    expect(changesSrc).toContain('GitChangeStatusPill');
    expect(branchesSrc).toContain('GitChangeStatusPill');
    expect(historySrc).toContain('GitChangeStatusPill');
    expect(commitDialogSrc).toContain('GitChangeStatusPill');
  });


  it('stacks commit message details above changed files and clamps the preview', () => {
    const historySrc = read('./GitHistoryBrowser.tsx');

    expect(historySrc).toContain('const COMMIT_BODY_PREVIEW_LINES = 2;');
    expect(historySrc).toContain('const COMMIT_BODY_PREVIEW_CHARS = 160;');
    expect(historySrc).toContain('body.split(/\\r?\\n/)');
    expect(historySrc).toContain("lines.slice(1).join('\\n').trim()");
    expect(historySrc).toContain('Commit Overview');
    expect(historySrc).toContain('Files in Commit');
    expect(historySrc).not.toContain('Patch Preview');
    expect(historySrc).toContain('Click a file to inspect its diff in a dialog.');
    expect(historySrc).toContain('Commit Diff');
    expect(historySrc).toContain('aria-expanded={commitBodyExpanded()}');
  });

  it('routes branch review through status and history views with compare in a dialog', () => {
    const branchesSrc = read('./GitBranchesPanel.tsx');

    expect(branchesSrc).toContain("selectedBranchSubview?: GitBranchSubview;");
    expect(branchesSrc).toContain('compactBranchContext');
    expect(branchesSrc).toContain('Using the current workspace status.');
    expect(branchesSrc).toContain('getCommitDetail');
    expect(branchesSrc).toContain('ChevronRight');
    expect(branchesSrc).toContain('Files in Commit');
    expect(branchesSrc).toContain('Compare branches');
    expect(branchesSrc).toContain('Changed Files');
    expect(branchesSrc).toContain('Load More');
    expect(branchesSrc).toContain('View Diff');
    expect(branchesSrc).toContain('Checkout');
    expect(branchesSrc).toContain('flex min-h-0 flex-1 flex-col overflow-hidden px-4 pt-2 pb-4');
    expect(branchesSrc).toContain('flex min-h-0 flex-1 flex-col gap-3');
    expect(branchesSrc).toContain('min-h-0 flex-1 overflow-auto');
    expect(branchesSrc).toContain('[&>div:last-child]:flex');
    expect(branchesSrc).toContain('[&>div:last-child]:!overflow-hidden');
    expect(branchesSrc).toContain('[&>div:last-child]:!p-0');
    expect(branchesSrc).toContain('flex min-h-0 flex-1 flex-col');
    expect(branchesSrc).toContain('flex min-h-0 flex-1 overflow-hidden');
    expect(branchesSrc).not.toContain('Subject');
  });


  it('keeps overview and changes panels on the same compact vertical rhythm', () => {
    const overviewSrc = read('./GitOverviewPanel.tsx');
    const changesSrc = read('./GitChangesPanel.tsx');
    const primitivesSrc = read('./GitWorkbenchPrimitives.tsx');

    expect(overviewSrc).toContain('Workspace Summary');
    expect(overviewSrc).toContain('Selected Branch');
    expect(overviewSrc).toContain('Repository Signals');
    expect(overviewSrc).toContain('GitStatStrip');
    expect(overviewSrc).toContain('columnsClass="grid-cols-2 xl:grid-cols-4"');
    expect(overviewSrc).toContain('space-y-0.5 rounded-md bg-muted/[0.12] p-0.5');
    expect(overviewSrc).toContain('rounded bg-background/70 px-2 py-1.5 text-[11px] transition-shadow duration-150 hover:shadow-sm');
    expect(overviewSrc).not.toContain('xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]');
    expect(overviewSrc).not.toContain('text-[24px] font-semibold tracking-tight');

    expect(changesSrc).toContain('Commit...');
    expect(changesSrc).toContain('Path');
    expect(changesSrc).toContain('Status');
    expect(changesSrc).toContain('GitCommitDialog');
    expect(changesSrc).toContain('GitDiffDialog');
    expect(changesSrc).toContain('GIT_CHANGED_FILES_TABLE_CLASS');
    expect(primitivesSrc).toContain("export const GIT_CHANGED_FILES_HEAD_CLASS = 'sticky top-0 z-10 bg-muted/30 backdrop-blur';");
    expect(primitivesSrc).toContain("export const GIT_CHANGED_FILES_HEADER_CELL_CLASS = 'px-2.5 py-1.5 font-medium';");
    expect(primitivesSrc).toContain("export const GIT_CHANGED_FILES_CELL_CLASS = 'px-2.5 py-1.5 align-top';");
    expect(primitivesSrc).toContain("export const GIT_CHANGED_FILES_ACTION_BUTTON_CLASS = 'h-6 min-w-[5rem] justify-center rounded-sm px-2 text-[10px]';");
    expect(changesSrc).toContain('variant={item.section === \'staged\' ? \'outline\' : \'default\'}');
    expect(primitivesSrc).toContain('sticky right-0 z-10 border-l border-border/45');
    expect(changesSrc).not.toContain('border-b border-border/70 px-3 py-2');
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

    expect(src).toContain('Changes');
    expect(src).toContain('Branches');
    expect(src).toContain('Commit Graph');
    expect(src).toContain('Local');
    expect(src).toContain('Remote');
    expect(src).toContain('Pick a branch to inspect its status or history in the main pane.');
    expect(src).not.toContain('Recent history with merge structure.');
    expect(src).toContain('space-y-1.5 sm:space-y-2');
    expect(src).toContain('WORKSPACE_VIEW_SECTIONS');
    expect(src).toContain('No files in this section.');
    expect(src).toContain('gitToneSelectableCardClass(tone(), active())');
    expect(src).toContain('text-sidebar-accent-foreground/75');
    expect(src).not.toContain('text-lg font-semibold tracking-tight');
  });

  it('keeps the commit graph rails above row selection backgrounds', () => {
    const src = read('./GitCommitGraph.tsx');

    expect(src).toContain('absolute inset-y-0 left-0 z-10 border-r border-border/40 bg-muted/[0.14]');
    expect(src).not.toContain('absolute inset-0 z-0 transition-colors duration-150');
    expect(src).toContain('relative z-20 min-w-0 px-3 py-1.5 transition-colors duration-150');
    expect(src).toContain("selected() ? 'bg-sidebar-accent' : 'bg-transparent group-hover:bg-muted/[0.28]'");
    expect(src).toContain('group relative grid w-full cursor-pointer appearance-none items-stretch overflow-hidden');
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
    expect(src).not.toContain('Compact repo signals and actions for the current view.');
    expect(src).not.toContain('Clean workspace');
    expect(src).toContain('GitMetaPill');
    expect(src).toContain('GitLabelBlock');
    expect(src).toContain('gitToneActionButtonClass()');
    expect(src).toContain('variant="ghost"');
    expect(src).toContain('bg-background/92');
    expect(src).not.toContain("gitToneSurfaceClass(subviewTone())");
    expect(src).not.toContain('variant="outline"');
    expect(src).not.toContain('GitHistoryModeSwitch');
    expect(src).not.toContain('GitSubviewSwitch');
  });

  it('keeps git diff surfaces aligned with floe-webapp dialog style', () => {
    const dialogSrc = read('./GitDiffDialog.tsx');
    const patchSrc = read('./GitPatchViewer.tsx');
    const patchUtilSrc = read('../utils/gitPatch.ts');

    expect(dialogSrc).toContain('flex max-w-none flex-col overflow-hidden rounded-md p-0');
    expect(dialogSrc).toContain('rounded-md p-0');
    expect(dialogSrc).toContain('[&>div:last-child]:min-h-0');
    expect(dialogSrc).toContain("h-[calc(100dvh-0.5rem)] w-[calc(100vw-0.5rem)] max-h-none");
    expect(dialogSrc).not.toContain('border-0');
    expect(dialogSrc).not.toContain('rounded-[20px]');
    expect(dialogSrc).not.toContain('rounded-xl');
    expect(patchSrc).toContain('flex h-full min-h-0 flex-col gap-3 rounded-md border border-border/55 bg-card p-3');
    expect(patchSrc).toContain("layout.isMobile() ? 'flex-1 max-h-none' : 'max-h-[28rem]'");
    expect(patchSrc).toContain('min-h-0 overflow-auto rounded-md border border-border/55 bg-background p-1');
    expect(patchSrc).toContain('Swipe horizontally to inspect long diff lines.');
    expect(patchSrc).toContain('[touch-action:pan-x_pan-y_pinch-zoom]');
    expect(patchSrc).toContain('inline-block min-w-full bg-muted/[0.20] p-px align-top');
    expect(patchSrc).toContain('grid w-max min-w-full');
    expect(patchSrc).toContain('minmax(max-content,1fr)');
    expect(patchSrc).toContain('grid-cols-[2.25rem_2.25rem_minmax(max-content,1fr)]');
    expect(patchSrc).not.toContain('chat-tool-apply-patch');
    expect(patchUtilSrc).toContain("return 'border-l-[2px] border-l-emerald-600/45 bg-emerald-500/12 dark:border-l-success/60 dark:bg-success/10';");
    expect(patchUtilSrc).toContain("return 'border-l-[2px] border-l-red-600/45 bg-red-500/12 dark:border-l-error/60 dark:bg-error/10';");
    expect(patchUtilSrc).toContain("return 'text-emerald-700 dark:text-emerald-300';");
    expect(patchUtilSrc).toContain("return 'text-red-700 dark:text-red-300';");
    expect(patchUtilSrc).not.toContain('chat-tool-apply-patch');
  });

  it('keeps git empty-state copy aligned with the compact review language', () => {
    const overviewSrc = read('./GitOverviewPanel.tsx');
    const changesSrc = read('./GitChangesPanel.tsx');
    const branchesSrc = read('./GitBranchesPanel.tsx');
    const historySrc = read('./GitHistoryBrowser.tsx');

    expect(changesSrc).toContain('No staged files yet. Stage files from the pending sections, then open the commit dialog.');
    expect(changesSrc).toContain('No pending files in this repository.');
    expect(changesSrc).not.toContain('Choose a file from the staged or pending lists to inspect its patch.');

    expect(overviewSrc).toContain('Choose a branch from the sidebar to load compare context.');
    expect(overviewSrc).toContain('Branch compare details appear here after you pick a branch from the sidebar.');

    expect(branchesSrc).toContain('Choose a branch from the sidebar to inspect its status or history.');
    expect(branchesSrc).toContain('Choose two branches to inspect file changes.');
    expect(branchesSrc).toContain('Remote branch is not checked out');
    expect(branchesSrc).toContain('Status unavailable');

    expect(historySrc).toContain('Choose a commit from the left rail to load its details.');
    expect(historySrc).toContain('Commit details are unavailable.');
    expect(historySrc).not.toContain('Select a commit from the sidebar to inspect its details.');
  });

  it('keeps changes tables stretched to the content pane height instead of a fixed card height', () => {
    const changesSrc = read('./GitChangesPanel.tsx');

    expect(changesSrc).toContain('flex min-h-0 flex-1 flex-col gap-3');
    expect(changesSrc).toContain('min-h-0 flex-1 overflow-auto');
    expect(changesSrc).not.toContain('max-h-[32rem]');
  });

  it('keeps commit dialogs focused on staged counts and line totals', () => {
    const commitSrc = read('./GitCommitDialog.tsx');

    expect(commitSrc).toContain('GitStatStrip');
    expect(commitSrc).toContain("label: 'Files Ready'");
    expect(commitSrc).toContain("label: 'Added Lines'");
    expect(commitSrc).toContain("label: 'Removed Lines'");
    expect(commitSrc).toContain('props.stagedItems.reduce');
    expect(commitSrc).toContain('Status');
  });

});

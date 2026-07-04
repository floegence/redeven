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
    expect(src).toContain('const scopedStorageKey = (key: string): string => (');
    expect(src).toContain('width={browserSidebarWidth()}');
    expect(src).toContain('const commitBrowserSidebarWidth = (value: number) => {');
    expect(src).toContain('writePersistedSidebarWidth(next);');
    expect(src).toContain('commitBrowserSidebarWidth(browserSidebarWidth() + delta)');
  });

  it('routes files mode and git mode through dedicated unified workspace shells', () => {
    const src = read('./RemoteFileBrowser.tsx');

    expect(src).toContain("import { KeepAliveStack } from '@floegence/floe-webapp-core/layout';");
    expect(src).toContain("import { FileBrowserWorkspace, type FileBrowserPathSubmitResult } from './FileBrowserWorkspace';");
    expect(src).toContain("import { GitWorkspace } from './GitWorkspace';");
    expect(src).toContain('<KeepAliveStack');
    expect(src).toContain('activeId={pageMode()}');
    expect(src).toContain('keepMounted');
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
    expect(src).not.toContain('headerActions?: JSX.Element;');
    expect(src).not.toContain('{props.headerActions}');
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
    expect(workspaceSrc).toContain("import { redevenDividerRoleClass, redevenSurfaceRoleClass } from '../utils/redevenSurfaceRoles';");
    expect(workspaceSrc).toContain("redevenSurfaceRoleClass('controlMuted')");
    expect(workspaceSrc).toContain("redevenSurfaceRoleClass('segmented')");
    expect(workspaceSrc).toContain("class={cn('shrink-0 border-b px-2.5 py-1.5', redevenDividerRoleClass(), redevenSurfaceRoleClass('inset'))}");
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
    expect(treeSrc).toContain('data-file-browser-touch-target="true"');
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
    expect(modeSrc).toContain("import { redevenSegmentedItemClass, redevenSurfaceRoleClass } from '../utils/redevenSurfaceRoles';");
    expect(modeSrc).toContain("class={cn('inline-flex w-full items-center gap-0.5 rounded-md border bg-muted/40 p-0.5 shadow-[0_1px_0_rgba(0,0,0,0.03)_inset]', redevenSurfaceRoleClass('segmented'), props.class)}");
    expect(modeSrc).toContain("redevenSegmentedItemClass(true)");
    expect(modeSrc).toContain("redevenSegmentedItemClass(false)");
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
    expect(navSrc).toContain('border-l-[2px] git-browser-selection-surface git-browser-selection-nav font-medium');
    expect(navSrc).toContain('bg-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground');
    expect(navSrc).toContain('gitSelectedChipClass(true)');
    expect(navSrc).not.toContain('gitSubviewTone');
    expect(navSrc).not.toContain('gitToneBadgeClass');
    expect(navSrc).not.toContain('gitToneSelectableCardClass');
  });

  it('keeps changes and branch compare on dialog-based diff flows while history stays patch-driven', () => {
    const changesSrc = read('./GitChangesPanel.tsx');
    const branchesSrc = read('./GitBranchesPanel.tsx');
    const historySrc = read('./GitHistoryBrowser.tsx');
    const commitDialogSrc = read('./GitCommitDialog.tsx');

    expect(changesSrc).toMatch(/import\s+\{\s*GitDiffDialog\s*\}\s+from\s+["']\.\/GitDiffDialog["'];/);
    expect(branchesSrc).toMatch(/import\s+\{\s*GitDiffDialog\s*\}\s+from\s+["']\.\/GitDiffDialog["'];/);
    expect(historySrc).toMatch(/import\s+\{\s*GitDiffDialog\s*\}\s+from\s+["']\.\/GitDiffDialog["'];/);
    expect(historySrc).not.toMatch(/import\s+\{\s*GitPatchViewer\s*\}\s+from\s+["']\.\/GitPatchViewer["'];/);
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
    expect(historySrc).toMatch(/lines\.slice\(1\)\.join\(["']\\n["']\)\.trim\(\)/);
    expect(historySrc).toContain('Commit Overview');
    expect(historySrc).toContain('Files in Commit');
    expect(historySrc).not.toContain('Patch Preview');
    expect(historySrc).toContain('Click a file to inspect its diff in a dialog.');
    expect(historySrc).toContain('Commit Diff');
    expect(historySrc).toContain('aria-expanded={commitBodyExpanded()}');
    expect(historySrc).toContain('class="space-y-2"');
    expect(historySrc).toContain('resolveGitBranchHeaderLayout');
    expect(historySrc).toContain('const [commitOverviewWidth, setCommitOverviewWidth] = createSignal(0);');
    expect(historySrc).toContain('new ResizeObserver(syncCommitOverviewWidth)');
    expect(historySrc).toContain('data-git-commit-overview-layout={commitOverviewLayout()}');
    expect(historySrc).toContain('data-git-commit-overview-actions={commitOverviewLayout()}');
    expect(historySrc).toContain('data-git-commit-body-group');
    expect(historySrc).toContain('data-git-commit-body');
    expect(historySrc).toContain('data-git-commit-body-toggle');
    expect(historySrc).toContain('commitOverviewLayout() === "inline" ? "pl-4" : "pl-0"');
    expect(historySrc).toContain('flex justify-start');
    expect(historySrc).toContain('commitOverviewLayout() === "inline"');
    expect(historySrc).toContain('const commitOverviewActionButtonClass = () =>');
    expect(historySrc).toContain('"rounded-md";');
    expect(historySrc).toContain('data-git-commit-files-list-layout="compact"');
    expect(historySrc).not.toContain('flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between');
    expect(historySrc).not.toContain('flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end lg:w-auto');
    expect(historySrc).toContain('min-w-[34rem] sm:min-w-[42rem] md:min-w-0');
  });

  it('routes branch review through status and history views with compare in a dialog', () => {
    const branchesSrc = read('./GitBranchesPanel.tsx');
    const branchHeaderLayoutSrc = read('./gitBranchHeaderLayout.ts');

    expect(branchesSrc).toContain("selectedBranchSubview?: GitBranchSubview;");
    expect(branchesSrc).toContain('branchContextSummary');
    expect(branchesSrc).toContain('getCommitDetail');
    expect(branchesSrc).toContain('ChevronRight');
    expect(branchesSrc).toContain('Files in Commit');
    expect(branchesSrc).toContain('BranchHistoryCommitDetailsReveal');
    expect(branchesSrc).toContain('BranchHistoryCommitDetails');
    expect(branchesSrc).toContain('data-git-branch-history-details');
    expect(branchesSrc).toContain('data-git-branch-history-details-row');
    expect(branchesSrc).toContain('data-git-branch-commit-files-surface="inline"');
    expect(branchesSrc).toContain('surface="inline"');
    expect(branchesSrc).toContain('BRANCH_HISTORY_REVEAL_CLOSE_MS');
    expect(branchesSrc).toContain('Compare branches');
    expect(branchesSrc).toContain('Changed Files');
    expect(branchesSrc).toContain('Load More');
    expect(branchesSrc).toContain('View Diff');
    expect(branchesSrc).not.toContain('"ml-7 mt-2 space-y-2 rounded-md bg-background/88 p-2.5"');
    expect(branchesSrc).not.toContain('surface\\n                                                  class="min-h-[5rem] px-1 py-2"');
    expect(branchesSrc).toContain('Checkout');
    expect(branchesSrc).toContain('Merge');
    expect(branchesSrc).toContain('Delete');
    expect(branchesSrc).toContain('flex min-h-0 flex-1 flex-col overflow-hidden px-4 pt-2 pb-4');
    expect(branchesSrc).toContain('flex min-h-0 flex-1 flex-col gap-3');
    expect(branchesSrc).toContain('min-h-0 flex-1 overflow-auto');
    expect(branchesSrc).toContain('[&>div:last-child]:flex');
    expect(branchesSrc).toContain('[&>div:last-child]:!overflow-hidden');
    expect(branchesSrc).toContain('[&>div:last-child]:!p-0');
    expect(branchesSrc).toContain('flex min-h-0 flex-1 flex-col');
    expect(branchesSrc).toContain('flex min-h-0 flex-1 overflow-hidden');
    expect(branchesSrc).toContain('flex min-h-5 items-center gap-2');
    expect(branchesSrc).toContain('resolveGitBranchHeaderLayout');
    expect(branchesSrc).toContain("const [branchHeaderWidth, setBranchHeaderWidth] = createSignal(0);");
    expect(branchesSrc).toContain('new ResizeObserver');
    expect(branchesSrc).toContain('const branchHeaderSurfaceClass = () =>');
    expect(branchesSrc).toContain('"border-b px-3 py-2 sm:px-4"');
    expect(branchesSrc).toContain('const branchHeaderSummaryBandClass = "grid gap-2";');
    expect(branchesSrc).toContain('const branchHeaderTopRowClass = () =>');
    expect(branchesSrc).toContain('branchHeaderLayout() === "inline"');
    expect(branchesSrc).toContain('branchHeaderLayout() === "stacked"');
    expect(branchesSrc).toContain('branchHeaderLayout() === "stacked" &&');
    expect(branchesSrc).toContain('"grid-cols-1 items-start"');
    expect(branchesSrc).toContain('branchHeaderLayout() === "compact" && "grid-cols-1"');
    expect(branchesSrc).toContain('min-w-0');
    expect(branchesSrc).toContain('const branchHeaderTabRailClass = () =>');
    expect(branchesSrc).toContain('branchHeaderLayout() === "inline"');
    expect(branchesSrc).toContain('? "w-auto justify-end"');
    expect(branchesSrc).toContain('branchHeaderLayout() === "stacked" && "order-3"');
    expect(branchesSrc).toContain('branchHeaderLayout() === "compact" && "order-3"');
    expect(branchesSrc).toContain('const branchHeaderCommandRailClass = () =>');
    expect(branchesSrc).toContain('"flex min-w-0 items-center justify-end gap-2"');
    expect(branchesSrc).toContain('"flex min-w-0 flex-wrap items-center gap-1.5"');
    expect(branchesSrc).toContain('branchHeaderLayout() === "stacked" && "order-2 justify-start"');
    expect(branchesSrc).toContain('branchHeaderLayout() === "compact" && "order-2 justify-start"');
    expect(branchesSrc).toContain('branchHeaderUsesOverflow');
    expect(branchesSrc).toContain('branchHeaderMainAction');
    expect(branchesSrc).toContain('branchHeaderOverflowItems');
    expect(branchesSrc).toContain('data-git-branch-header-actions');
    expect(branchesSrc).toContain('const branchHeaderShortcutGroupClass = () =>');
    expect(branchesSrc).toContain('"flex shrink-0 flex-wrap items-center gap-1.5"');
    expect(branchesSrc).toContain('const branchHeaderActionsGroupClass =');
    expect(branchesSrc).toContain('"flex min-w-0 flex-wrap items-center gap-1.5"');
    expect(branchesSrc).toContain('type BranchHeaderControlGroups = {');
    expect(branchesSrc).toContain('type BranchStatusSectionPresentation = {');
    expect(branchesSrc).toContain('EMPTY_BRANCH_CONTEXT_SUMMARY');
    expect(branchesSrc).toContain('const secondaryActionButtonClass = cn(');
    expect(branchesSrc).toContain('"cursor-pointer rounded-md bg-background/70 px-3 hover:bg-background"');
    expect(branchesSrc).toContain('const primaryActionButtonClass =');
    expect(branchesSrc).toContain('"cursor-pointer rounded-md px-3"');
    expect(branchesSrc).toContain('const dangerActionButtonClass =');
    expect(branchesSrc).toContain('"cursor-pointer rounded-md border border-destructive/20 bg-destructive/[0.06] px-3 text-destructive hover:bg-destructive/[0.12] hover:text-destructive"');
    expect(branchesSrc).not.toMatch(/>\s*Workspace\s*</);
    expect(branchesSrc).not.toMatch(/>\s*Actions\s*</);
    expect(branchesSrc).toContain('const branchHeaderTabListClass = () =>');
    expect(branchesSrc).toContain('branchHeaderLayout() === "inline" ? "w-[12rem]" : "w-full"');
    expect(branchesSrc).toContain('"cursor-pointer rounded-md px-3 py-1.5 text-center text-xs font-medium transition-colors duration-150"');
    expect(branchesSrc).toContain('<GitShortcutOrbDock>');
    expect(branchesSrc).toContain('statusToolbarActions');
    expect(branchesSrc).toContain('statusSectionCards');
    expect(branchesSrc).toContain('function branchStatusSummaryLabel(section: GitWorkspaceViewSection): string');
    expect(branchesSrc).toContain('if (section === "conflicted") return "Conflicts";');
    expect(branchesSrc).toContain('compactLabel: branchStatusSummaryLabel(section)');
    expect(branchesSrc).toContain('shortLabel:');
    expect(branchesSrc).toContain('? "Conf."');
    expect(branchesSrc).toContain('? item.shortLabel');
    expect(branchesSrc).toContain(': item.compactLabel');
    expect(branchesSrc).toContain('text-[9px] font-semibold uppercase tracking-[0.08em] sm:text-[10px] sm:tracking-[0.14em]');
    expect(branchesSrc).toContain('const branchStatusToolbarClass = cn(');
    expect(branchesSrc).toContain('const branchStatusStripClass = cn(');
    expect(branchesSrc).toContain('<section class={branchStatusToolbarClass}>');
    expect(branchesSrc).toContain('data-git-branch-status-toolbar-layout={branchHeaderLayout()}');
    expect(branchesSrc).toContain('data-git-branch-status-summary-layout={branchHeaderLayout()}');
    expect(branchesSrc).toContain('data-git-branch-status-list-layout="compact"');
    expect(branchesSrc).toContain('data-git-branch-commit-files-list-layout="compact"');
    expect(branchesSrc).toContain('"grid-cols-[minmax(0,1fr)_auto] items-center"');
    expect(branchesSrc).toContain('"grid-cols-[auto_minmax(0,1fr)] items-center"');
    expect(branchesSrc).toContain('"flex min-w-0 flex-wrap items-center justify-start gap-1.5"');
    expect(branchesSrc).toContain('"grid w-full min-w-0 grid-cols-3 gap-0.5 rounded-md bg-muted/[0.08] p-0.5 text-[11px]"');
    expect(branchesSrc).not.toContain('min-w-[20rem]');
    expect(branchesSrc).toContain('redevenSurfaceRoleClass("segmented")');
    expect(branchesSrc).not.toContain('git-browser-selection-surface text-foreground');
    expect(branchesSrc).not.toContain('lg:flex-row lg:items-start lg:justify-between');
    expect(branchesSrc).not.toContain('sm:w-[15rem]');
    expect(branchesSrc).not.toContain('w-full text-[11px] leading-relaxed text-muted-foreground sm:max-w-[24rem] sm:text-right');
    expect(branchesSrc).not.toContain('Subject');

    expect(branchHeaderLayoutSrc).toContain("export type GitBranchHeaderLayout = 'compact' | 'stacked' | 'inline';");
    expect(branchHeaderLayoutSrc).toContain('GIT_BRANCH_HEADER_STACKED_MIN_WIDTH = 620');
    expect(branchHeaderLayoutSrc).toContain('GIT_BRANCH_HEADER_INLINE_MIN_WIDTH = 960');
    expect(branchHeaderLayoutSrc).toContain("if (width >= GIT_BRANCH_HEADER_INLINE_MIN_WIDTH) return 'inline';");
    expect(branchHeaderLayoutSrc).toContain("if (width >= GIT_BRANCH_HEADER_STACKED_MIN_WIDTH) return 'stacked';");
    expect(branchHeaderLayoutSrc).toContain("return 'compact';");
  });


  it('keeps overview and changes panels on the same compact vertical rhythm', () => {
    const overviewSrc = read('./GitOverviewPanel.tsx');
    const changesSrc = read('./GitChangesPanel.tsx');
    const changesHeaderLayoutSrc = read('./gitChangesHeaderLayout.ts');
    const primitivesSrc = read('./GitWorkbenchPrimitives.tsx');

    expect(overviewSrc).toContain("i18n.t('git.overview.workspaceSummary')");
    expect(overviewSrc).toContain("i18n.t('git.overview.selectedBranch')");
    expect(overviewSrc).toContain("i18n.t('git.overview.repositorySignals')");
    expect(overviewSrc).toContain('useI18n');
    expect(overviewSrc).toContain('GitStatStrip');
    expect(overviewSrc).toContain('h-full min-h-0 overflow-auto px-3 py-3 sm:px-4 sm:py-4');
    expect(overviewSrc).toContain('columnsClass="grid-cols-2 xl:grid-cols-4"');
    expect(overviewSrc).toContain('space-y-0.5 rounded-md bg-muted/[0.12] p-0.5');
    expect(overviewSrc).toContain('flex flex-col gap-1.5 rounded px-2 py-1.5 text-[11px] transition-colors duration-150 hover:bg-muted/[0.14] sm:flex-row sm:items-start sm:justify-between');
    expect(overviewSrc).not.toContain('xl:grid-cols-[minmax(0,1.1fr)_minmax(320px,0.9fr)]');
    expect(overviewSrc).not.toContain('text-[24px] font-semibold tracking-tight');

    expect(changesSrc).toContain("i18n.t('git.changes.commitAction')");
    expect(changesSrc).toContain("i18n.t('git.common.path')");
    expect(changesSrc).toContain("i18n.t('git.common.status')");
    expect(changesSrc).toContain('useI18n');
    expect(changesSrc).toContain('GitCommitDialog');
    expect(changesSrc).toContain('GitDiffDialog');
    expect(changesSrc).toContain('GitChangesBreadcrumb');
    expect(changesSrc).toContain('resolveGitChangesHeaderDensity');
    expect(changesSrc).toContain('buildGitChangesHeaderPresentation');
    expect(changesSrc).toContain('Dropdown');
    expect(changesSrc).toContain('MoreHorizontal');
    expect(changesSrc).toContain('data-git-changes-header-density');
    expect(changesSrc).toContain('data-git-changes-header-actions');
    expect(changesSrc).toContain('line-clamp-1');
    expect(changesSrc).toContain('GIT_CHANGED_FILES_TABLE_CLASS');
    expect(changesSrc).toContain('GitChangedFilesActionButton');
    expect(changesSrc).toContain("'grid gap-2.5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center'");
    expect(changesSrc).toContain("'grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2'");
    expect(changesSrc).toContain('flex min-w-0 flex-wrap items-center justify-start gap-1.5 md:justify-end');
    expect(changesSrc).toContain("'flex min-w-0 flex-wrap items-center gap-1.5'");
    expect(changesSrc).toContain("'flex min-w-0 flex-wrap items-center gap-1.5'");
    expect(changesSrc).toContain('min-w-[34rem] sm:min-w-[42rem] md:min-w-0');
    expect(changesHeaderLayoutSrc).toContain("export type GitChangesHeaderDensity = 'comfortable' | 'compact' | 'collapsed'");
    expect(changesHeaderLayoutSrc).toContain("export type GitChangesHeaderLayoutMode = 'default' | 'quiet_inline'");
    expect(changesHeaderLayoutSrc).toContain('GIT_CHANGES_HEADER_COMPACT_MIN_WIDTH = 620');
    expect(changesHeaderLayoutSrc).toContain('GIT_CHANGES_HEADER_COMFORTABLE_MIN_WIDTH = 860');
    expect(changesHeaderLayoutSrc).toContain('resolveGitChangesBreadcrumbLayout');
    expect(changesHeaderLayoutSrc).toContain('buildGitChangesHeaderPresentation');
    expect(changesHeaderLayoutSrc).toContain("layoutMode: isCleanState ? 'quiet_inline' : 'default'");
    expect(primitivesSrc).toContain("export const GIT_CHANGED_FILES_HEAD_CLASS = cn('sticky top-0 z-10', redevenSurfaceRoleClass('panel'));");
    expect(primitivesSrc).toContain("export const GIT_CHANGED_FILES_HEADER_CELL_CLASS = 'px-2.5 py-1 font-medium';");
    expect(primitivesSrc).toContain("export const GIT_CHANGED_FILES_CELL_CLASS = 'px-2.5 py-1 align-top';");
    expect(primitivesSrc).toContain("export const GIT_CHANGED_FILES_ACTION_BUTTON_CLASS = 'inline-flex cursor-pointer items-center whitespace-nowrap text-[11px] font-medium text-primary underline-offset-2 transition-colors duration-150 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 disabled:cursor-not-allowed disabled:opacity-45';");
    expect(primitivesSrc).toContain("grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start sm:gap-x-3 sm:gap-y-1.5");
    expect(primitivesSrc).toContain("'grid grid-cols-1 gap-2 border-t px-3 py-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center sm:gap-x-2 sm:gap-y-2'");
    expect(primitivesSrc).toContain("redevenDividerRoleClass()");
    expect(primitivesSrc).toContain("redevenSurfaceRoleClass('inset')");
    expect(primitivesSrc).toContain("class={cn('inline-flex max-w-full flex-wrap items-center gap-1.5', props.class)}");
    expect(primitivesSrc).toContain("return <div class={cn('break-words text-[13px] font-bold leading-5 tracking-tight text-foreground', props.class)}>{props.children}</div>;");
    expect(primitivesSrc).toContain('sticky right-0 z-10 border-l px-2.5 py-1 text-right align-top git-browser-selection-surface');
    expect(changesSrc).not.toContain('border-b border-border/70 px-3 py-2');
    expect(changesSrc).not.toContain('flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between');
    expect(changesSrc).not.toContain('grid w-full grid-cols-1 gap-2 sm:flex sm:w-auto sm:flex-wrap sm:justify-end');
    expect(changesSrc).not.toContain('text-[24px] font-semibold tracking-tight');
  });

  it('routes git content shells through quiet git frame primitives', () => {
    const primitivesSrc = read('./GitWorkbenchPrimitives.tsx');
    const changesSrc = read('./GitChangesPanel.tsx');
    const branchesSrc = read('./GitBranchesPanel.tsx');
    const historySrc = read('./GitHistoryBrowser.tsx');

    expect(primitivesSrc).toContain('export interface GitPanelFrameProps');
    expect(primitivesSrc).toContain('export interface GitTableFrameProps');
    expect(primitivesSrc).toContain('export function GitPanelFrame');
    expect(primitivesSrc).toContain('export function GitTableFrame');
    expect(primitivesSrc).toContain("'rounded-md border border-transparent bg-muted/[0.08] px-3 py-2.5'");
    expect(primitivesSrc).toContain("'overflow-hidden rounded-md border'");
    expect(primitivesSrc).toContain("redevenSurfaceRoleClass('panel')");
    expect(primitivesSrc).not.toContain("redevenSurfaceRoleClass('panelStrong')");
    expect(primitivesSrc).toContain("<Dynamic component={props.as ?? 'div'}");

    expect(changesSrc).toContain('GitPanelFrame');
    expect(changesSrc).toContain('GitTableFrame');
    expect(changesSrc).toContain('<GitPanelFrame class="shrink-0">');
    expect(changesSrc).toContain('<GitTableFrame class="flex h-full min-h-0 flex-col">');

    expect(historySrc).toContain('GitPanelFrame');
    expect(historySrc).toContain('GitTableFrame');
    expect(historySrc).toContain('<GitPanelFrame as="section">');
    expect(historySrc).toContain('<GitTableFrame class="mt-2.5">');

    expect(branchesSrc).toContain('GitTableFrame');
    expect(branchesSrc).toContain('<GitTableFrame class="flex min-h-0 flex-1 flex-col">');
    expect(branchesSrc).toContain('branchHeaderSurfaceClass');
    expect(branchesSrc).toContain('<section class={branchStatusToolbarClass}>');
    expect(branchesSrc).not.toContain('GitPanelFrame');
    expect(branchesSrc).not.toContain('<GitPanelFrame>');
  });

  it('uses the dedicated git view navigation inside the git workspace shell', () => {
    const src = read('./GitWorkspace.tsx');
    const filesSrc = read('./FileBrowserWorkspace.tsx');

    expect(src).toContain("import { GitViewNav } from './GitViewNav';");
    expect(src).toContain('navigationLabel="View"');
    expect(src).toContain('sidebarBodyClass="overflow-hidden"');
    expect(src).toContain("class={['redeven-git-browser', props.class].filter(Boolean).join(' ')}");
    expect(src).toContain('<GitViewNav');
    expect(src).not.toContain('headerActions=');
    expect(src).not.toContain("from './GitChrome'");
    expect(filesSrc).not.toContain('redeven-git-browser');
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
    expect(src).toContain('space-y-2');
    expect(src).toContain('WORKSPACE_VIEW_SECTIONS');
    expect(src).toContain('No files in this section.');
    expect(src).toContain('data-testid="git-sidebar-scroll-region"');
    expect(src).toContain('overflow-auto overscroll-contain');
    expect(src).toContain('grid min-h-5 grid-cols-[minmax(0,1fr)_auto] items-center gap-2');
    expect(src).toContain('min-h-4 truncate text-[10px]');
    expect(src).toContain('gitToneSelectableCardClass(tone(), active())');
    expect(src).toContain('gitSelectedSecondaryTextClass(active())');
    expect(src).toContain('gitSelectedChipClass(true)');
    expect(src).not.toContain('text-lg font-semibold tracking-tight');
  });

  it('keeps the commit graph rails above row selection backgrounds', () => {
    const src = read('./GitCommitGraph.tsx');

    expect(src).toContain("import { redevenDividerRoleClass, redevenSurfaceRoleClass } from '../utils/redevenSurfaceRoles';");
    expect(src).toContain("class={cn('pointer-events-none absolute top-0 left-0 z-10 border-r', redevenSurfaceRoleClass('inset'), redevenDividerRoleClass())}");
    expect(src).toContain("rowIndex() === rowCount() - 1 ? '' : cn('border-b', redevenDividerRoleClass())");
    expect(src).toContain('data-commit-graph-rails');
    expect(src).toContain('data-commit-graph-segment={row.commit.hash}');
    expect(src).toContain('data-commit-graph-node={props.row.commit.hash}');
    expect(src).toContain('pointer-events-none absolute inset-0 overflow-visible');
    expect(src).toContain('const SUBJECT_ROW_HEIGHT = 14;');
    expect(src).toContain('const META_ROW_HEIGHT = 10;');
    expect(src).toContain('const NODE_CENTER_Y = ROW_TOP_PADDING + SUBJECT_ROW_HEIGHT / 2;');
    expect(src).toContain('const CONNECTOR_OVERSCAN = 0.75;');
    expect(src).toContain('relative z-20 grid min-w-0 px-3 transition-colors duration-150');
    expect(src).toContain("selected() ? 'bg-sidebar-accent' : 'bg-transparent group-hover:bg-muted/[0.28]'");
    expect(src).toContain('group relative grid w-full cursor-pointer appearance-none items-stretch overflow-hidden');
  });


  it('lets the files activity control page-level mobile sidebars while widget views use header buttons', () => {
    const envSrc = read('../EnvAppShell.tsx');
    const browserSrc = read('./RemoteFileBrowser.tsx');

    expect(envSrc).toContain('filesSidebarOpen: filesMobileSidebarOpen');
    expect(envSrc).toContain('toggleFilesSidebar: toggleFilesMobileSidebar');
    expect(envSrc).toContain("setEnvSidebarActiveTab('files', { openSidebar: false });");
    expect(browserSrc).toContain('ctx.filesSidebarOpen()');
    expect(browserSrc).toContain('ctx.setFilesSidebarOpen(open);');
    expect(browserSrc).toContain('const togglePageSidebar = () => setMobileSidebarOpen(!mobileSidebarOpen());');
    expect(browserSrc).toContain('showMobileSidebarButton={layout.isMobile() && hasEmbeddedWidget()}');
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
    expect(src).toContain('gitToneHeaderActionButtonClass()');
    expect(src).toContain('variant="ghost"');
    expect(src).toContain("redevenDividerRoleClass()");
    expect(src).toContain("redevenSurfaceRoleClass('inset')");
    expect(src).not.toContain("gitToneSurfaceClass(subviewTone())");
    expect(src).not.toContain('variant="outline"');
    expect(src).not.toContain('GitHistoryModeSwitch');
    expect(src).not.toContain('GitSubviewSwitch');
  });

  it('routes git browser loading states through one centered shared pane', () => {
    const primitivesSrc = read('./GitWorkbenchPrimitives.tsx');
    const workspaceSrc = read('./GitWorkspace.tsx');
    const changesSrc = read('./GitChangesPanel.tsx');
    const branchesSrc = read('./GitBranchesPanel.tsx');
    const historySrc = read('./GitHistoryBrowser.tsx');
    const sidebarSrc = read('./GitWorkbenchSidebar.tsx');

    expect(primitivesSrc).toContain('export interface GitStatePaneProps');
    expect(primitivesSrc).toContain('flex w-full min-h-0 flex-1 items-center justify-center');
    expect(primitivesSrc).toContain('export function GitLoadingIndicator');
    expect(primitivesSrc).toContain('export function GitInlineLoadingStatus');
    expect(primitivesSrc).toContain('<GitLoadingIndicator tone={tone()} />');
    expect(primitivesSrc).toContain('<GitInlineLoadingStatus>{status()}</GitInlineLoadingStatus>');
    expect(primitivesSrc).not.toContain("import { SnakeLoader } from '@floegence/floe-webapp-core/loading';");
    expect(primitivesSrc).not.toContain('<SnakeLoader');
    expect(workspaceSrc).toContain('shellLoadingMessage?: string;');
    expect(workspaceSrc).toContain("i18n.t('git.workspace.preparingActiveView')");
    expect(workspaceSrc).toContain('<GitStatePane loading message={shellLoadingMessage()}');

    expect(changesSrc).toContain('GitStatePane');
    expect(changesSrc).toContain("i18n.t('git.changes.loadingWorkspaceChanges')");

    expect(branchesSrc).toContain('GitStatePane');
    expect(branchesSrc).toContain('Loading commit history...');
    expect(branchesSrc).toContain('Loading branch compare...');
    expect(branchesSrc).toContain('data-git-branch-status-summary-state');
    expect(branchesSrc).toContain('data-git-branch-status-content-frame="true"');
    expect(branchesSrc).not.toContain("import { SnakeLoader } from '@floegence/floe-webapp-core/loading';");

    expect(historySrc).toContain('GitStatePane');
    expect(historySrc).toContain('Loading commit details...');
    expect(historySrc).not.toContain("import { SnakeLoader } from '@floegence/floe-webapp-core/loading';");

    expect(sidebarSrc).toContain('GitStatePane');
    expect(sidebarSrc).toContain('Checking repository...');
    expect(sidebarSrc).toContain('Loading commits...');
    expect(sidebarSrc).not.toContain("import { SnakeLoader } from '@floegence/floe-webapp-core/loading';");
  });

  it('keeps branch verification pending inside the branch detail shell', () => {
    const branchesSrc = read('./GitBranchesPanel.tsx');

    expect(branchesSrc).toContain('const selectedBranch = () => branchDetailState().branch ?? null;');
    expect(branchesSrc).toContain('const branchIsVerifying = () => branchDetailState().kind === "verifying";');
    expect(branchesSrc).toContain('const interactiveBranch = () => {');
    expect(branchesSrc).toContain('if (mergeAvailable() && selectedBranch())');
    expect(branchesSrc).toContain('if (props.onCheckoutBranch && selectedBranch())');
    expect(branchesSrc).toContain('if (deleteAvailable() && selectedBranch())');
    expect(branchesSrc).toContain('const shouldRenderBranchHeaderActions = () =>');
    expect(branchesSrc).toContain('git-branch-header-verification-slot');
    expect(branchesSrc).toContain('GitInlineLoadingStatus class="git-branch-header-inline-status"');
    expect(branchesSrc).toContain('data-git-branch-status-summary-state');
    expect(branchesSrc).toContain('data-git-branch-status-content-frame="true"');
    expect(branchesSrc).toContain('data-git-branch-stable-placeholder={view}');
    expect(branchesSrc).toContain('data-git-branch-stable-placeholder-state');
    expect(branchesSrc).not.toContain('Checking branch selection');
    expect(branchesSrc).toContain('const statusTabActive = () => branchSubview() === "status";');
    expect(branchesSrc).toContain('const historyTabActive = () => branchSubview() === "history";');
    expect(branchesSrc).toContain('const renderHistory = () =>');
    expect(branchesSrc).toContain('active={active()}');
    expect(branchesSrc).toContain('when={branchIsReady()}');
    expect(branchesSrc).not.toContain('renderBranchDetailStatePane');
    expect(branchesSrc).not.toContain('fallback={renderBranchDetailStatePane');
  });

  it('keeps git diff surfaces aligned with floe-webapp dialog style', () => {
    const dialogSrc = read('./GitDiffDialog.tsx');
    const patchSrc = read('./GitPatchViewer.tsx');
    const patchUtilSrc = read('../utils/gitPatch.ts');

    expect(dialogSrc).toContain('flex max-w-none flex-col overflow-hidden rounded-md p-0');
    expect(dialogSrc).toContain('rounded-md p-0');
    expect(dialogSrc).toContain('[&>div:last-child]:min-h-0');
    expect(dialogSrc).toContain("h-[calc(100dvh-0.5rem)] w-[calc(100vw-0.5rem)] max-h-none");
    expect(dialogSrc).toContain('Full Context');
    expect(dialogSrc).toContain('Loading full-context diff...');
    expect(dialogSrc).toContain('Loads a single-file patch on demand.');
    expect(dialogSrc).toContain('Includes unchanged lines for broader review context.');
    expect(dialogSrc).not.toContain('border-0');
    expect(dialogSrc).not.toContain('rounded-[20px]');
    expect(dialogSrc).not.toContain('rounded-xl');
    expect(patchSrc).toContain("import { redevenDividerRoleClass, redevenSurfaceRoleClass } from '../utils/redevenSurfaceRoles';");
    expect(patchSrc).toContain("fallback={<div class={cn('rounded-md border px-3 py-2 text-xs leading-5 text-muted-foreground', redevenSurfaceRoleClass('inset'))}>{props.emptyMessage}</div>}");
    expect(patchSrc).toContain('class="flex h-full min-h-0 flex-col gap-3 rounded-md bg-muted/[0.08] p-3"');
    expect(patchSrc).toContain("const desktopPatchViewportClass = createMemo(() => props.desktopPatchViewportClass ?? 'max-h-[28rem]');");
    expect(patchSrc).toContain("const mobilePatchViewportClass = createMemo(() => props.mobilePatchViewportClass ?? 'flex-1 max-h-none');");
    expect(patchSrc).toContain('layout.isMobile() ? mobilePatchViewportClass() : desktopPatchViewportClass()');
    expect(patchSrc).toContain("class={cn(");
    expect(patchSrc).toContain("'min-h-0 overflow-auto rounded-md border bg-background p-1 [-webkit-overflow-scrolling:touch] [touch-action:pan-x_pan-y_pinch-zoom]'");
    expect(patchSrc).toContain("redevenSurfaceRoleClass('control')");
    expect(patchSrc).toContain("i18n.t('git.patchViewer.mobileHorizontalHint')");
    expect(patchSrc).toContain('[touch-action:pan-x_pan-y_pinch-zoom]');
    expect(patchSrc).toContain('inline-block min-w-full bg-muted/[0.20] p-px align-top');
    expect(patchSrc).toContain('grid w-max min-w-full');
    expect(patchSrc).toContain('minmax(max-content,1fr)');
    expect(patchSrc).toContain('grid-cols-[2.25rem_2.25rem_minmax(max-content,1fr)]');
    expect(patchSrc).toContain("class={cn('border-r px-1.5 text-right font-mono text-[10.5px] leading-[1.6] text-muted-foreground/60', redevenDividerRoleClass())}");
    expect(patchSrc).toContain("class={cn('cursor-pointer rounded-md border px-2.5 py-2 text-[11px] font-medium text-muted-foreground transition-colors duration-150 hover:bg-muted/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-offset-1 sm:py-1', redevenSurfaceRoleClass('controlMuted'))}");
    expect(patchSrc).not.toContain('chat-tool-apply-patch');
    expect(patchUtilSrc).toContain("export * from '../../../../../flower_ui/src/gitPatch';");
    expect(patchUtilSrc).not.toContain('chat-tool-apply-patch');
  });

  it('keeps git empty-state copy aligned with the compact review language', () => {
    const overviewSrc = read('./GitOverviewPanel.tsx');
    const changesSrc = read('./GitChangesPanel.tsx');
    const changesHeaderLayoutSrc = read('./gitChangesHeaderLayout.ts');
    const branchesSrc = read('./GitBranchesPanel.tsx');
    const historySrc = read('./GitHistoryBrowser.tsx');

    expect(changesSrc).toContain("i18n.t('git.changes.noStagedFiles')");
    expect(changesSrc).toContain("i18n.t('git.changes.noPendingFiles')");
    expect(changesSrc).toContain("i18n.t('git.changes.noPendingChanges')");
    expect(changesSrc).not.toContain('Choose a file from the staged or pending lists to inspect its patch.');
    expect(changesHeaderLayoutSrc).toContain('Review the staged snapshot before commit.');
    expect(changesHeaderLayoutSrc).toContain('Pending changes are clear. Review the staged snapshot and commit when ready.');
    expect(changesHeaderLayoutSrc).toContain('Stage what you want to keep, then commit.');

    expect(overviewSrc).toContain("i18n.t('git.overview.chooseBranchToLoadCompare')");
    expect(overviewSrc).toContain("i18n.t('git.overview.branchCompareAppears')");

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
    expect(changesSrc).toContain('min-h-0 flex-1');
    expect(changesSrc).not.toContain('max-h-[32rem]');
  });

  it('keeps commit dialogs focused on staged counts and line totals', () => {
    const commitSrc = read('./GitCommitDialog.tsx');

    expect(commitSrc).toContain('GitStatStrip');
    expect(commitSrc).toContain("label: i18n.t('git.commitDialog.filesReady')");
    expect(commitSrc).toContain("label: i18n.t('git.commitDialog.addedLines')");
    expect(commitSrc).toContain("label: i18n.t('git.commitDialog.removedLines')");
    expect(commitSrc).toContain('props.stagedItems.reduce');
    expect(commitSrc).toContain("i18n.t('git.common.status')");
  });

});

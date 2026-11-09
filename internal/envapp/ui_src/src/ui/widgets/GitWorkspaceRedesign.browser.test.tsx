import '../../index.css';
import { FloeConfigProvider, LayoutProvider, NotificationProvider } from '@floegence/floe-webapp-core';
import { builtInShellThemePresets } from '@floegence/floe-webapp-core/themes';
import { ProtocolProvider } from '@floegence/floe-webapp-protocol';
import { createSignal } from 'solid-js';
import { Portal, render } from 'solid-js/web';
import { commands, page, userEvent } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';
import { redevenV1Contract } from '../protocol/redeven_v1';
import type { GitSeededWorkspaceChange, GitWorkbenchSubview } from '../utils/gitWorkbench';
import { I18nProvider } from '../i18n';
import { GitStashWindow } from './GitStashWindow';
import { FileBrowserWorkspace } from './FileBrowserWorkspace';
import { GitHistoryModeSwitch } from './GitHistoryModeSwitch';
import { GitWorkspace } from './GitWorkspace';

let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); document.documentElement.removeAttribute('style'); document.documentElement.removeAttribute('data-floe-shell-theme'); localStorage.removeItem('redeven_ui_language_preference'); });
const longPath = `src/components/workspace/review/retained/scrolling/${'LongComponentName'.repeat(9)}.tsx`;
const files: GitSeededWorkspaceChange[] = [
  { section: 'unstaged', path: 'src/components/git/GitWorkspace.tsx', changeType: 'modified', additions: 8, deletions: 3, patchText: '@@ -21,8 +21,13 @@\n export function GitWorkspace() {\n   const repository = useRepository();\n-  const sidebar = useSidebar();\n+  const [selection, setSelection] = createSignal();\n+  const [draft, setDraft] = createSignal(\'\');\n \n   return (\n-    <Sidebar>\n+    <GitWorkspaceFrame>\n+      <RepositoryToolbar repository={repository()} />\n+      <GitViewNavigation />\n+      <ReviewSplit selection={selection()}>\n+        <ChangesTree onSelect={setSelection} />\n+        <CommitDraft value={draft()} onChange={setDraft} />\n+      </ReviewSplit>\n-    </Sidebar>\n+    </GitWorkspaceFrame>\n   );\n }' },
  { section: 'unstaged', path: longPath, changeType: 'modified', patchText: '@@ -1 +1 @@\n-before\n+after' },
  { section: 'unstaged', path: 'src/removed.ts', changeType: 'deleted', patchText: '@@ -1 +0,0 @@\n-removed' },
  { section: 'untracked', path: 'src/added.ts', changeType: 'added', patchText: '@@ -0,0 +1 @@\n+added' },
  { section: 'unstaged', path: 'README.md', changeType: 'modified', patchText: '@@ -1 +1 @@\n-before\n+after' },
];
function mount(width: number, all = false, localized = false) {
  if (localized) localStorage.setItem('redeven_ui_language_preference', 'zh-CN');
  const host = document.createElement('div'); Object.assign(host.style, { width: `${width}px`, height: '720px' }); document.body.append(host);
  const [subview, setSubview] = createSignal<GitWorkbenchSubview>('changes');
  const [message, setMessage] = createSignal('');
  const [allSections, setAllSections] = createSignal(all);
  const [section, setSection] = createSignal<'changes' | 'staged' | 'conflicted'>('changes');
  const [stashActive, setStashActive] = createSignal(false);
  const stage: string[] = [], unstage: string[] = [];
  const [open, setOpen] = createSignal(true);
  dispose = render(() => <I18nProvider><LayoutProvider><NotificationProvider><ProtocolProvider contract={redevenV1Contract}>
    <GitWorkspace mode="git" onModeChange={() => {}} subview={subview()} onSubviewChange={view => { setStashActive(false); setSubview(view); }} width={300} open={open()} onClose={() => setOpen(false)}
      showAllWorkspaceSections={allSections()} onShowAllWorkspaceSections={() => setAllSections(true)} selectedWorkspaceSection={section()} onSelectWorkspaceSection={value => { setAllSections(false); setSection(value); }}
      stashActive={stashActive()} onShowStashes={() => setStashActive(true)} stashContent={<GitStashWindow embedded open={stashActive()} onOpenChange={setStashActive} tab="stashes" onTabChange={() => {}} repoRootPath="/workspace/redeven" stashes={[{ id: 'stash-demo', ref: 'stash@{0}', message: 'Review workspace layout', createdAtUnixMs: 1 }]} selectedStashId="stash-demo" stashDetail={{ id: 'stash-demo', message: 'Review workspace layout', files: [{ path: 'src/review.ts', changeType: 'modified' }] }} />}
      showMobileSidebarButton onToggleSidebar={() => setOpen(value => !value)} currentPath="/workspace/redeven" repoInfo={{ available: true, repoRootPath: '/workspace/redeven' }}
      repoSummary={{ repoRootPath: '/workspace/redeven', headRef: 'codex/git-browser-redesign', aheadCount: 2, behindCount: 1, workspaceSummary: { unstagedCount: 4, untrackedCount: 1, stagedCount: 1 } }}
      workspace={{ repoRootPath: '/workspace/redeven', summary: { unstagedCount: 4, untrackedCount: 1, stagedCount: 1 }, unstaged: files.filter(file => file.section === 'unstaged'), untracked: files.filter(file => file.section === 'untracked'), staged: [{ section: 'staged', path: 'README.md', changeType: 'modified' }], conflicted: [] }}
      commitMessage={message()} onCommitMessageChange={setMessage} onStageWorkspaceItem={item => stage.push(item.path ?? '')} onUnstageWorkspaceItem={item => unstage.push(item.path ?? '')} onDiscardWorkspaceItem={() => {}}
      onFetch={() => {}} onPull={() => {}} onPush={() => {}} onRefresh={() => {}} onOpenStash={() => {}} onAskFlower={() => {}}
    />
  </ProtocolProvider></NotificationProvider></LayoutProvider></I18nProvider>, host);
  return { host, setSubview, message, stage, unstage };
}
function expandTree(host: HTMLElement) {
  for (let i = 0; i < 12; i++) {
    const rows = [...host.querySelectorAll<HTMLElement>('[role="treeitem"][aria-expanded="false"]')];
    if (!rows.length) break;
    rows.forEach(row => row.querySelector<HTMLButtonElement>('[data-git-tree-select]')?.click());
  }
}
describe('Git workspace redesign acceptance', () => {
  it.each([680, 1180])('uses compact mouse tree rows and grouping at %i px', async width => {
    await page.viewport(width + 20, 820);
    const { host } = mount(width, true);
    const worktree = host.querySelector<HTMLElement>('[data-git-all-section="changes"]')!;
    expandTree(worktree);
    const rows = [...worktree.querySelectorAll<HTMLElement>('.git-workspace-tree__row')];
    expect(rows.length).toBeGreaterThan(10);
    for (const row of rows) expect(row.getBoundingClientRect().height).toBe(24);
    const heading = worktree.querySelector<HTMLElement>('.git-workspace-all__heading')!;
    expect(heading.getBoundingClientRect().height).toBe(28);
    const first = rows[0].getBoundingClientRect();
    const last = rows.at(-1)!.getBoundingClientRect();
    expect(last.bottom - first.top).toBe(rows.length * 24);
    const child = worktree.querySelector<HTMLElement>('[data-git-tree-path="src/components"] > .git-workspace-tree__row')!;
    expect(parseFloat(getComputedStyle(child).paddingLeft) - parseFloat(getComputedStyle(rows[0]).paddingLeft)).toBe(12);
    const actions = worktree.querySelectorAll<HTMLElement>('.git-workspace-tree__actions button');
    for (const action of actions) expect(action.getBoundingClientRect().height).toBe(24);
  });
  it('keeps tree controls easy to tap with coarse input', async () => {
    const touch = commands as unknown as { emulateTouchInput: (enabled: boolean) => Promise<void> };
    await touch.emulateTouchInput(true);
    try {
      await page.viewport(375, 820);
      const { host } = mount(375, true);
      await expect.poll(() => matchMedia('(pointer: coarse)').matches).toBe(true);
      const worktree = host.querySelector<HTMLElement>('[data-git-all-section="changes"]')!;
      expandTree(worktree);
      for (const control of worktree.querySelectorAll<HTMLElement>('.git-workspace-tree__identity, .git-workspace-tree__actions button, .git-workspace-all__heading button')) {
        expect(control.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
      }
    } finally { await touch.emulateTouchInput(false); }
  });
  it.each([375, 680, 900, 1180])('keeps the native Files/Git switch in the same geometry at %i px', async width => {
    await page.viewport(width + 20, 820);
    const host = document.createElement('div'); Object.assign(host.style, { width: `${width}px`, height: '720px', position: 'relative' }); document.body.append(host);
    const [mode, setMode] = createSignal<'files' | 'git'>('files');
    const [filesMount, setFilesMount] = createSignal<HTMLDivElement>();
    const [gitMount, setGitMount] = createSignal<HTMLDivElement>();
    dispose = render(() => <FloeConfigProvider config={{}}><LayoutProvider><NotificationProvider><ProtocolProvider contract={redevenV1Contract}>
      <Portal mount={mode() === 'files' ? filesMount() : gitMount()}><GitHistoryModeSwitch mode={mode()} onChange={setMode} /></Portal>
      <div style={{ position: 'absolute', inset: '0', visibility: mode() === 'files' ? 'visible' : 'hidden' }}>
        <FileBrowserWorkspace modeSwitcherMount={setFilesMount} mode={mode()} onModeChange={setMode} files={[]} currentPath="/workspace" initialPath="/workspace" instanceId="switch-geometry" resetKey={0} width={300} open={width >= 768} />
      </div>
      <div style={{ position: 'absolute', inset: '0', visibility: mode() === 'git' ? 'visible' : 'hidden' }}>
        <GitWorkspace modeSwitcherMount={setGitMount} mode={mode()} onModeChange={setMode} subview="changes" onSubviewChange={() => {}} currentPath="/workspace" width={300} />
      </div>
    </ProtocolProvider></NotificationProvider></LayoutProvider></FloeConfigProvider>, host);
    await expect.poll(() => host.querySelector('[data-browser-mode-switch]')?.getBoundingClientRect().width ?? 0).toBeGreaterThan(200);
    const control = host.querySelector<HTMLElement>('[data-browser-mode-switch]')!;
    const bounds = control.getBoundingClientRect();
    await userEvent.click(control.querySelectorAll<HTMLButtonElement>('button')[1]);
    await expect.poll(() => host.querySelector('[data-browser-mode-switch]')).toBe(control);
    await expect.poll(() => control.getBoundingClientRect().x).toBeCloseTo(bounds.x, 0);
    expect(control.getBoundingClientRect().y).toBeCloseTo(bounds.y, 0);
    expect(control.getBoundingClientRect().width).toBeCloseTo(bounds.width, 0);
    expect(control.getBoundingClientRect().height).toBe(bounds.height);
  });
  it('shows all section trees with exact stage targets, inline stashes and split diffs', async () => {
    await page.viewport(1280, 820);
    const { host, stage, unstage } = mount(1180, true);
    await expect.poll(() => host.querySelectorAll('[data-git-all-section]').length).toBe(2);
    expect(host.querySelector('[data-git-tree-path="src"]')?.getAttribute('aria-expanded')).toBe('false');
    const worktree = host.querySelector<HTMLElement>('[data-git-all-section="changes"]')!;
    expandTree(worktree);
    const expandedTree = worktree.querySelector('[data-git-tree-scroll]');
    const groupToggle = worktree.querySelector<HTMLButtonElement>('.git-workspace-all__heading button')!;
    groupToggle.click(); expect(groupToggle.getAttribute('aria-expanded')).toBe('false');
    groupToggle.click(); expect(worktree.querySelector('[data-git-tree-scroll]')).toBe(expandedTree);
    worktree.querySelector<HTMLButtonElement>('[data-git-tree-select="README.md"]')!.click();
    await userEvent.click(host.querySelector<HTMLButtonElement>('.git-diff-panel__actions button')!);
    expect(stage).toEqual(['README.md']);
    const staged = host.querySelector<HTMLElement>('[data-git-all-section="staged"]')!;
    staged.querySelector<HTMLButtonElement>('[aria-label="Unstage"]')!.click();
    expect(unstage).toEqual(['README.md']);
    const scroll = host.querySelector<HTMLElement>('[data-git-all-scroll]')!;
    expect(scroll.scrollWidth).toBeGreaterThan(scroll.clientWidth);
    scroll.scrollLeft = 300;
    expect(host.scrollWidth).toBe(host.clientWidth);
    await userEvent.click([...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Side by Side')!);
    expect(host.querySelector('[data-git-patch-layout="split"]')).not.toBeNull();
    expect(host.querySelector('[data-diff-side="left"]')?.textContent).toContain('@@');
    await userEvent.click(host.querySelector<HTMLButtonElement>('.git-workspace-stashes')!);
    expect(host.querySelector('[data-git-stash-embedded]')?.textContent).toContain('Review workspace layout');
    expect(host.querySelector('[data-git-workspace-navigation]')!.getBoundingClientRect().width).toBe(1180);
    await userEvent.click(host.querySelector<HTMLButtonElement>('[role="tab"][aria-label="Changes"]')!);
    expect(host.querySelector('[data-git-all-scroll]')).toBe(scroll);
    expect(scroll.scrollLeft).toBe(300);
  });
  it.each(['classic-dark', 'classic-light'])('captures the integrated approved composition in %s', async theme => {
    await page.viewport(1280, 820);
    const preset = builtInShellThemePresets.find(item => item.name === theme)!;
    document.documentElement.classList.toggle('dark', preset.mode === 'dark');
    document.documentElement.dataset.floeShellTheme = preset.name;
    Object.entries(preset.semanticTokens ?? {}).forEach(([key, value]) => { if (value) document.documentElement.style.setProperty(key, value); });
    const { host } = mount(1180, true, true);
    await expect.poll(() => host.querySelector('[data-git-all-scroll]')).not.toBeNull();
    expect(host.scrollWidth).toBe(host.clientWidth);
    const output = import.meta.env.VITE_GIT_REDESIGN_CAPTURE_DIR;
    if (output) await page.screenshot({ path: `${output}/approved-${theme}-collapsed.png` });
    for (const path of ['src', 'src/components', 'src/components/git']) host.querySelector<HTMLButtonElement>(`[data-git-all-section="changes"] [data-git-tree-select="${path}"]`)!.click();
    host.querySelector<HTMLButtonElement>('[data-git-tree-select="src/components/git/GitWorkspace.tsx"]')!.click();
    if (output) await page.screenshot({ path: `${output}/approved-${theme}.png` });
  });
  it('places full-width Git navigation above both review panes without a separate sidebar', async () => {
    await page.viewport(1280, 820);
    const { host } = mount(1180);
    await expect.poll(() => host.querySelector('[data-git-tree-scroll]')?.clientHeight ?? 0).toBeGreaterThan(100);
    const navigation = host.querySelector<HTMLElement>('[data-git-workspace-navigation]')!;
    expect(navigation).not.toBeNull();
    const bounds = navigation.getBoundingClientRect();
    expect(bounds.width).toBe(host.clientWidth);
    const tree = host.querySelector<HTMLElement>('[data-git-tree-scroll]')!.getBoundingClientRect();
    const detail = host.querySelector<HTMLElement>('.git-diff-split__detail')!.getBoundingClientRect();
    expect(bounds.bottom).toBeLessThanOrEqual(tree.top);
    expect(bounds.bottom).toBeLessThanOrEqual(detail.top);
    expect(host.querySelector('[aria-label="Toggle browser sidebar"]')).toBeNull();
    expect(host.querySelector('[data-browser-sidebar-presentation]')).toBeNull();
    expect(host.querySelectorAll('[role="tablist"][aria-label="Git views"]')).toHaveLength(1);
  });
  it.each(['classic-dark', 'classic-light'])('contains deep paths inside the file rail and retains review state in %s', async theme => {
    await page.viewport(1280, 820);
    const preset = builtInShellThemePresets.find(item => item.name === theme)!;
    document.documentElement.classList.toggle('dark', preset.mode === 'dark');
    document.documentElement.dataset.floeShellTheme = preset.name;
    Object.entries(preset.semanticTokens ?? {}).forEach(([key, value]) => { if (value) document.documentElement.style.setProperty(key, value); });
    const { host, setSubview, message } = mount(1180);
    await expect.poll(() => host.querySelector('[data-git-tree-scroll]')?.clientHeight ?? 0).toBeGreaterThan(250);
    const mode = host.querySelector<HTMLElement>('[data-browser-mode-switch]')!;
    const modeBounds = mode.getBoundingClientRect();
    expect(host.querySelector('[data-git-tree-path="src"]')?.getAttribute('aria-expanded')).toBe('false');
    expandTree(host);
    const scroll = host.querySelector<HTMLElement>('[data-git-tree-scroll]')!;
    const detail = host.querySelector<HTMLElement>('.git-diff-split__detail')!;
    const detailBounds = detail.getBoundingClientRect();
    const draft = host.querySelector<HTMLTextAreaElement>('[data-git-commit-draft] textarea')!;
    await userEvent.fill(draft, 'Review the workspace redesign');
    const file = host.querySelector<HTMLButtonElement>(`[data-git-tree-select="${longPath}"]`)!;
    file.click();
    await expect.poll(() => detail.textContent).toContain('after');
    expect(scroll.scrollWidth).toBeGreaterThan(scroll.clientWidth);
    scroll.scrollLeft = 350;
    await expect.poll(() => scroll.scrollLeft).toBeGreaterThan(0);
    await expect.poll(() => scroll.parentElement!.querySelector('[data-floe-horizontal-scrollbar]')?.getAttribute('aria-valuenow')).toBe('350');
    expect(mode.getBoundingClientRect().x).toBe(modeBounds.x);
    expect(mode.getBoundingClientRect().width).toBe(modeBounds.width);
    expect(detail.getBoundingClientRect().x).toBe(detailBounds.x);
    expect(host.scrollWidth).toBe(host.clientWidth);
    setSubview('branches'); setSubview('changes');
    expect(host.querySelector('[data-git-tree-scroll]')).toBe(scroll);
    expect(host.querySelector('[data-git-commit-draft] textarea')).toBe(draft);
    expect(message()).toBe('Review the workspace redesign');
    expect(scroll.scrollLeft).toBe(350);
    const colors = ['src/removed.ts', 'src/added.ts', longPath].map(path => getComputedStyle(host.querySelector(`[data-git-tree-select="${path}"] > span:last-child`)!).color);
    expect(new Set(colors).size).toBe(3);
    const output = import.meta.env.VITE_GIT_REDESIGN_CAPTURE_DIR;
    if (output) await page.screenshot({ path: `${output}/${theme}-long-path.png` });
    scroll.scrollLeft = 0;
    if (output) await page.screenshot({ path: `${output}/${theme}.png` });
  });

  it.each([320, 375, 680, 900])('retains the tree and draft through inline review navigation at %i px', async width => {
    await page.viewport(width, 820);
    const { host } = mount(width);
    await expect.poll(() => host.querySelector<HTMLElement>('[data-git-tree-scroll]')?.getBoundingClientRect().width ?? 0).toBeGreaterThan(100);
    const tree = host.querySelector('[data-git-tree-scroll]');
    const draft = host.querySelector('[data-git-commit-draft] textarea');
    expect(host.querySelector('[aria-label="Toggle browser sidebar"]')).toBeNull();
    expandTree(host);
    host.querySelector<HTMLButtonElement>('[data-git-tree-select="README.md"]')!.click();
    await expect.poll(() => host.querySelector('[data-git-diff-panel]')?.textContent).toContain('after');
    expect(host.scrollWidth).toBe(host.clientWidth);
    if (width < 768) {
      await userEvent.click(host.querySelector<HTMLButtonElement>('[data-git-diff-back]')!);
      expect(host.querySelector('[data-git-tree-scroll]')).toBe(tree);
      expect(host.querySelector('[data-git-commit-draft] textarea')).toBe(draft);
    }
    expect(host.querySelectorAll('[data-browser-mode-switch]')).toHaveLength(1);
    const output = import.meta.env.VITE_GIT_REDESIGN_CAPTURE_DIR;
    if (output) await page.screenshot({ path: `${output}/responsive-${width}.png` });
  });
});

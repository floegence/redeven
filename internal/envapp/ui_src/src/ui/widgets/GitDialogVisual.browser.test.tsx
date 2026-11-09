import '../../index.css';
import { FloeProvider } from '@floegence/floe-webapp-core';
import { builtInShellThemePresets } from '@floegence/floe-webapp-core/themes';
import { render } from 'solid-js/web';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { GitDeleteBranchConfirmDialog } from './GitDeleteBranchConfirmDialog';
import { GitSection, GitSubtleNote } from './GitWorkbenchPrimitives';
import { GitMergeBranchDialog } from './GitMergeBranchDialog';
import { GitCommitDialog } from './GitCommitDialog';
import { GitStashDeleteConfirmDialog } from './GitStashDeleteConfirmDialog';
import { I18nProvider } from '../i18n';
import { writeStoredLanguagePreference } from '../i18n/storage';
import type { GitDeleteBranchDialogState } from './GitDeleteBranchReviewModel';

let dispose: (() => void) | undefined;
const reason = 'Branch is not fully merged into origin/main.';

afterEach(async () => {
  dispose?.();
  document.body.replaceChildren();
  document.documentElement.removeAttribute('style');
  document.documentElement.removeAttribute('data-floe-shell-theme');
  document.documentElement.removeAttribute('data-floe-surface-style');
  document.documentElement.classList.remove('light', 'dark');
  writeStoredLanguagePreference('en-US');
  await (commands as unknown as { emulateMediaPreferences: (options: { reducedMotion: string; forcedColors: string }) => Promise<void> }).emulateMediaPreferences({ reducedMotion: 'no-preference', forcedColors: 'none' });
  await (commands as unknown as { emulateTouchInput: (enabled: boolean) => Promise<void> }).emulateTouchInput(false);
});

function applyTheme(name: string) {
  const preset = builtInShellThemePresets.find(theme => theme.name === name)!;
  document.documentElement.classList.toggle('dark', preset.mode === 'dark');
  document.documentElement.classList.toggle('light', preset.mode !== 'dark');
  document.documentElement.dataset.floeShellTheme = preset.name;
  document.documentElement.dataset.floeSurfaceStyle = 'soft-neumorphic';
  for (const [key, value] of Object.entries(preset.semanticTokens ?? {})) {
    if (value) document.documentElement.style.setProperty(key, value);
  }
}

function contrast(element: HTMLElement) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 1;
  const context = canvas.getContext('2d')!;
  const ancestors: HTMLElement[] = [];
  for (let current: HTMLElement | null = element; current; current = current.parentElement) ancestors.unshift(current);
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, 1, 1);
  for (const ancestor of ancestors) {
    context.fillStyle = getComputedStyle(ancestor).backgroundColor;
    context.fillRect(0, 0, 1, 1);
  }
  const luminance = () => Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3)
    .map(channel => channel / 255).map(channel => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
    .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
  const background = luminance();
  context.fillStyle = getComputedStyle(element).color;
  context.fillRect(0, 0, 1, 1);
  const foreground = luminance();
  return (Math.max(background, foreground) + 0.05) / (Math.min(background, foreground) + 0.05);
}

async function mountDelete(theme = 'porcelain-light', branchName = 'codex/floret-v0290-adoption') {
  await page.viewport(1100, 850);
  const host = document.createElement('div');
  document.body.append(host);
  dispose = render(() => <FloeProvider config={{ storage: { enabled: false }, theme: { defaultSurfaceStyle: 'soft-neumorphic' } }}>
    <GitDeleteBranchConfirmDialog open branch={{ name: branchName, kind: 'local' }}
      preview={{ repoRootPath: '/Volumes/JianDisk/code/floegence/redeven', name: branchName,
        safeDeleteAllowed: false, safeDeleteReason: reason, safeDeleteBaseRef: 'origin/main',
        forceDeleteAllowed: true, forceDeleteRequiresConfirm: true, requiresWorktreeRemoval: false,
        requiresDiscardConfirmation: false, planFingerprint: 'reviewed-plan' }} onClose={() => {}} />
  </FloeProvider>, host);
  const dialog = page.getByRole('dialog', { name: 'Delete Branch', exact: true });
  await expect.element(dialog).toBeVisible();
  await expect.poll(() => new DOMMatrix(getComputedStyle(dialog.element()).transform).isIdentity).toBe(true);
  applyTheme(theme);
  return dialog.element() as HTMLElement;
}

it.each(['porcelain-light', 'classic-dark'])('keeps warning text readable in the real %s branch review', async theme => {
  const dialog = await mountDelete(theme);
  const warning = dialog.querySelector<HTMLElement>('[data-git-notice=warning]')!;
  expect(warning).toBeTruthy();
  expect(contrast(warning)).toBeGreaterThanOrEqual(4.5);
});

it('keeps every notice tone readable across all published themes', () => {
  const host = document.createElement('div');
  host.style.background = 'var(--background)';
  document.body.append(host);
  dispose = render(() => <><GitSubtleNote>Neutral</GitSubtleNote><GitSubtleNote tone="warning">Warning</GitSubtleNote><GitSubtleNote tone="danger">Danger</GitSubtleNote></>, host);
  for (const preset of builtInShellThemePresets) {
    applyTheme(preset.name);
    for (const notice of host.querySelectorAll<HTMLElement>('[data-git-notice]')) {
      expect.soft(contrast(notice), `${preset.name} ${notice.dataset.gitNotice}`).toBeGreaterThanOrEqual(4.5);
    }
  }
});

it('keeps review actions visible and long branch names inside a short narrow viewport', async () => {
  const dialog = await mountDelete('porcelain-light', `feature/${'long-branch-segment-'.repeat(6)}review`);
  for (const [width, height] of [[390, 540], [640, 430], [1100, 400]]) {
    await page.viewport(width, height);
    await expect.poll(() => dialog.getBoundingClientRect().bottom).toBeLessThanOrEqual(height);
    const body = dialog.querySelector<HTMLElement>('[data-floe-dialog-body]')!;
    expect(body.scrollWidth).toBeLessThanOrEqual(body.clientWidth + 1);
    expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth + 1);
    const footer = dialog.querySelector<HTMLElement>('[data-floe-dialog-footer]')!;
    const buttons = footer.querySelectorAll<HTMLButtonElement>('button');
    for (const button of buttons) {
      const bounds = button.getBoundingClientRect();
      expect(bounds.top).toBeGreaterThanOrEqual(0);
      expect(bounds.bottom).toBeLessThanOrEqual(height);
    }
    body.scrollTop = body.scrollHeight;
    expect(buttons[0].getBoundingClientRect().bottom).toBeLessThanOrEqual(height);
  }
  await page.viewport(1100, 850);
  await page.screenshot({ element: dialog, path: '__screenshots__/git-delete-review-light.png' });
  applyTheme('classic-dark');
  await page.screenshot({ element: dialog, path: '__screenshots__/git-delete-review-dark.png' });
});

it('keeps touch controls reachable and review content readable in forced colors', async () => {
  await (commands as unknown as { emulateTouchInput: (enabled: boolean) => Promise<void> }).emulateTouchInput(true);
  const dialog = await mountDelete();
  await page.viewport(390, 640);
  const input = dialog.querySelector<HTMLInputElement>('input')!;
  const buttons = dialog.querySelectorAll<HTMLButtonElement>('.git-dialog-actions button');
  expect(parseFloat(getComputedStyle(input).fontSize)).toBeGreaterThanOrEqual(16);
  for (const button of buttons) expect(parseFloat(getComputedStyle(button).height)).toBeGreaterThanOrEqual(44);
  await (commands as unknown as { emulateMediaPreferences: (options: { forcedColors: string }) => Promise<void> }).emulateMediaPreferences({ forcedColors: 'active' });
  const warning = dialog.querySelector<HTMLElement>('[data-git-notice=warning]')!;
  expect(contrast(warning)).toBeGreaterThanOrEqual(4.5);
});

it('preserves exact confirmation, pending operation state, and keyboard dismissal', async () => {
  await page.viewport(1100, 850);
  const host = document.createElement('div');
  document.body.append(host);
  const [open, setOpen] = createSignal(false);
  const [state, setState] = createSignal<GitDeleteBranchDialogState>('idle');
  const onConfirm = vi.fn(() => setState('deleting'));
  dispose = render(() => <FloeProvider config={{ storage: { enabled: false } }}>
    <button onClick={() => setOpen(true)}>Review branch</button>
    <GitDeleteBranchConfirmDialog open={open()} state={state()} branch={{ name: 'feature', kind: 'local' }}
      preview={{ repoRootPath: '/repo', name: 'feature', safeDeleteAllowed: false, safeDeleteReason: reason,
        forceDeleteAllowed: true, forceDeleteRequiresConfirm: true, requiresWorktreeRemoval: false,
        requiresDiscardConfirmation: false, planFingerprint: 'reviewed-plan' }}
      onClose={() => setOpen(false)} onConfirm={onConfirm} />
  </FloeProvider>, host);
  const trigger = page.getByRole('button', { name: 'Review branch' });
  await userEvent.click(trigger);
  const dialog = page.getByRole('dialog', { name: 'Delete Branch', exact: true });
  const input = dialog.getByRole('textbox');
  const confirm = dialog.getByRole('button', { name: 'Force Delete Branch', exact: true });
  await expect.element(confirm).toBeDisabled();
  const confirmElement = confirm.element();
  const inputElement = input.element();
  await userEvent.fill(input, 'Feature');
  await expect.element(confirm).toBeDisabled();
  await userEvent.fill(input, 'feature');
  await expect.element(confirm).toBeEnabled();
  expect(confirm.element()).toBe(confirmElement);
  await expect.element(input).toHaveFocus();
  await expect.poll(() => new DOMMatrix(getComputedStyle(dialog.element()).transform).isIdentity).toBe(true);
  const beforeHeight = dialog.element().getBoundingClientRect().height;
  await userEvent.click(confirm);
  expect(onConfirm).toHaveBeenCalledExactlyOnceWith(expect.anything(), { deleteMode: 'force', confirmBranchName: 'feature', removeLinkedWorktree: false, discardLinkedWorktreeChanges: false, planFingerprint: 'reviewed-plan' });
  await userEvent.keyboard('{Escape}');
  await expect.element(dialog).toBeVisible();
  await expect.element(input).toBeDisabled();
  expect(input.element()).toBe(inputElement);
  expect(Math.abs(dialog.element().getBoundingClientRect().height - beforeHeight)).toBeLessThanOrEqual(1);
  setState('idle');
  await userEvent.keyboard('{Escape}');
  await expect.element(dialog).not.toBeInTheDocument();
  await expect.element(trigger).toHaveFocus();
});

it.each(['merge', 'commit', 'stash'] as const)('keeps the %s dialog on the shared footer scale', async kind => {
  await page.viewport(1100, 700);
  const host = document.createElement('div');
  host.style.cssText = 'position:relative;height:680px';
  document.body.append(host);
  dispose = render(() => <FloeProvider config={{ storage: { enabled: false } }}>
    {kind === 'merge' ? <GitMergeBranchDialog open branch={{ name: 'feature', kind: 'local' }}
      preview={{ repoRootPath: '/repo', currentRef: 'main', sourceName: 'feature', outcome: 'blocked', blockingReason: 'Review local changes.', files: [] }} onClose={() => {}} />
      : kind === 'commit' ? <GitCommitDialog open stagedItems={[]} message="" onClose={() => {}} />
        : <GitStashDeleteConfirmDialog open host={host} onClose={() => {}} />}
  </FloeProvider>, host);
  const dialog = page.getByRole('dialog');
  await expect.element(dialog).toBeVisible();
  const footer = dialog.element().querySelector<HTMLElement>('[data-floe-dialog-footer], .git-window-dialog-footer')!;
  expect(footer).toBeTruthy();
  for (const wrapper of footer.querySelectorAll<HTMLElement>('div')) {
    expect(parseFloat(getComputedStyle(wrapper).paddingTop)).toBe(0);
    expect(getComputedStyle(wrapper).backgroundColor).toBe('rgba(0, 0, 0, 0)');
  }
  for (const button of footer.querySelectorAll('button')) expect(parseFloat(getComputedStyle(button).height)).toBeGreaterThanOrEqual(32);
});

it('respects reduced motion and keeps the localized warning free of raw diagnostics until expanded', async () => {
  await (commands as unknown as { emulateMediaPreferences: (options: { reducedMotion: string }) => Promise<void> }).emulateMediaPreferences({ reducedMotion: 'reduce' });
  writeStoredLanguagePreference('zh-CN');
  const host = document.createElement('div');
  document.body.append(host);
  dispose = render(() => <FloeProvider config={{ storage: { enabled: false } }}><I18nProvider>
    <GitDeleteBranchConfirmDialog open branch={{ name: 'feature', kind: 'local' }}
      preview={{ repoRootPath: '/repo', name: 'feature', safeDeleteAllowed: false, safeDeleteReason: reason,
        forceDeleteAllowed: true, forceDeleteRequiresConfirm: true, requiresWorktreeRemoval: false,
        requiresDiscardConfirmation: false, planFingerprint: 'reviewed-plan' }} onClose={() => {}} />
  </I18nProvider></FloeProvider>, host);
  const dialog = page.getByRole('dialog', { name: '删除分支', exact: true });
  await expect.element(dialog).toBeVisible();
  await expect.element(page.getByText(reason, { exact: true })).not.toBeVisible();
  await userEvent.click(page.getByText('技术详情', { exact: true }));
  await expect.element(page.getByText(reason, { exact: true })).toBeVisible();
  await page.screenshot({ element: dialog.element() as HTMLElement, path: '__screenshots__/git-delete-review-zh-CN.png' });
  expect(dialog.element().getAnimations({ subtree: true }).filter(animation => animation.playState === 'running' && animation.effect instanceof KeyframeEffect && animation.effect.getKeyframes().some(frame => frame.transform && frame.transform !== 'none'))).toHaveLength(0);
});

it('lets the shared dialog own a single footer surface and spacing', async () => {
  const dialog = await mountDelete();
  const footer = dialog.querySelector<HTMLElement>('[data-floe-dialog-footer]')!;
  expect(footer).toBeTruthy();
  for (const wrapper of footer.querySelectorAll<HTMLElement>('div')) {
    const style = getComputedStyle(wrapper);
    expect(style.backgroundColor).toBe('rgba(0, 0, 0, 0)');
    expect(parseFloat(style.borderTopWidth)).toBe(0);
    expect(parseFloat(style.paddingTop)).toBe(0);
    expect(parseFloat(style.paddingBottom)).toBe(0);
  }
});

it('groups Git navigation without a decorative side rail', () => {
  const host = document.createElement('div');
  document.body.append(host);
  dispose = render(() => <GitSection label="Local" tone="brand">Branches</GitSection>, host);
  const style = getComputedStyle(host.querySelector('section')!);
  expect(style.borderLeftWidth).toBe(style.borderRightWidth);
});

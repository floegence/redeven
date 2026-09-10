import '../index.css';
import '../ui/flower-feature.css';
import { builtInShellThemePresets } from '@floegence/floe-webapp-core/themes';
import { Input, NumberInput, AffixInput } from '@floegence/floe-webapp-core/ui';
import { render } from 'solid-js/web';
import { afterEach, expect, it } from 'vitest';
import { commands } from 'vitest/browser';
import { JSONEditor } from '../ui/pages/settings/SettingsPrimitives';
import { TerminalSearchOverlay } from '../ui/widgets/TerminalSearchOverlay';
import { FileBrowserPathControl } from '../ui/widgets/FileBrowserPathControl';
import { InputDialog } from '../ui/widgets/InputDialog';
import { expectSingleInputFocus } from './inputFocus.test-support';

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.(); document.body.replaceChildren();
  document.documentElement.removeAttribute('data-floe-shell-theme');
  document.documentElement.removeAttribute('data-floe-surface-style');
  document.documentElement.classList.remove('dark', 'light');
});
it('keeps product input boundaries stable across every shell theme', () => {
  const host = document.createElement('div'); document.body.appendChild(host);
  dispose = render(() => <>
    <Input aria-label="Name" value="Workspace" />
    <Input aria-label="Git form control" class="redeven-surface-control" />
    <div data-floe-input-surface class="h-7 rounded-md border px-2.5 shadow-sm redeven-surface-control redeven-surface-control--muted">
      <FileBrowserPathControl mode="edit" draft="/workspace" onDraftChange={() => undefined} onActivateEdit={() => undefined} onSubmit={() => undefined} onCancel={() => undefined} />
    </div>
    <Input aria-label="Invalid name" error="Required" />
    <Input aria-label="Readonly name" value="Readonly" readOnly />
    <Input aria-label="Disabled name" disabled />
    <NumberInput value={10} onChange={() => undefined} />
    <AffixInput prefix="https://" value="example.com" />
    <JSONEditor value="{}" onChange={() => undefined} />
    <div style={{ '--redeven-terminal-search-border': 'var(--border)', '--redeven-terminal-search-accent': 'var(--ring)', '--redeven-terminal-search-input': 'var(--background)', '--redeven-terminal-search-foreground': 'var(--foreground)' }}><TerminalSearchOverlay mobile={false} query="sample" resultCount={0} resultIndex={-1} state="idle" inputRef={() => undefined} onQueryChange={() => undefined} onPrevious={() => undefined} onNext={() => undefined} onRetry={() => undefined} onClose={() => undefined} /></div>
    <input class="flower-rename-input" aria-label="Rename conversation" />
    <input class="flower-settings-input" aria-label="Underlined setting" />
    <input class="flower-reasoning-menu-budget" aria-label="Reasoning budget" />
    <select class="flower-settings-select" aria-label="Model selection"><option>Default</option></select>
    <input class="redeven-settings-search border border-border" aria-label="Settings search" />
    <div class="flower-surface"><div class="flower-composer" data-floe-input-surface><textarea aria-label="Conversation composer" /></div></div>
  </>, host);
  for (const preset of builtInShellThemePresets) {
    document.documentElement.dataset.floeSurfaceStyle = 'soft-neumorphic';
    document.documentElement.dataset.floeShellTheme = preset.name;
    document.documentElement.classList.toggle('dark', preset.mode === 'dark');
    document.documentElement.classList.toggle('light', preset.mode === 'light');
    host.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('input,textarea,select').forEach(expectSingleInputFocus);
  }
});
it('uses the shared focus border in the real rename dialog, including forced colors', async () => {
  const host = document.createElement('div'); document.body.appendChild(host);
  dispose = render(() => <InputDialog open title="Rename" label="Name" value="draft" onConfirm={() => undefined} onCancel={() => undefined} />, host);
  await expect.poll(() => document.querySelector('input')).toBeTruthy();
  const input = document.querySelector<HTMLInputElement>('input')!;
  expectSingleInputFocus(input);
  const media = commands as unknown as { emulateMediaPreferences: (preferences: { forcedColors: 'active' | 'none' }) => Promise<void> };
  await media.emulateMediaPreferences({ forcedColors: 'active' });
  try { expectSingleInputFocus(input); } finally { await media.emulateMediaPreferences({ forcedColors: 'none' }); }
});

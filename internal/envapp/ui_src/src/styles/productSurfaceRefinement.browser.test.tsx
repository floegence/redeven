import '../index.css';
import '../ui/flower-feature.css';
import { FloeProvider, useTheme } from '@floegence/floe-webapp-core';
import { builtInShellThemePresets } from '@floegence/floe-webapp-core/themes';
import { Card, Input } from '@floegence/floe-webapp-core/ui';
import { render } from 'solid-js/web';
import { afterEach, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import axe from 'axe-core';
import { FlowerNavigationIcon } from '../ui/icons/FlowerSoftAuraIcon';
import { FlowerThreadList } from '../../../../flower_ui/src/threads/FlowerThreadList';
import { FlowerEmptyState } from '../../../../flower_ui/src/chat/FlowerEmptyState';

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  document.body.replaceChildren();
});

it.each(['standard', 'soft-neumorphic'] as const)('keeps Flower rail text and search readable in every %s theme', async (material) => {
  await page.viewport(1000, 800);
  const host = document.createElement('main');
  document.body.append(host);
  let theme!: ReturnType<typeof useTheme>;
  function Content() {
    theme = useTheme();
    return <div class="flower-component-shell" style={{ height: '600px' }}>
      <aside class="flower-component-thread-rail">
        <div class="flower-sidebar-actions"><button class="flower-new-chat-button"><span class="flower-new-chat-label">New chat</span></button></div>
        <FlowerThreadList items={[]} query="" onQueryChange={() => undefined} onSelect={() => undefined} onRefresh={() => undefined} />
      </aside>
    </div>;
  }
  dispose = render(() => <FloeProvider config={{ storage: { enabled: false }, theme: { defaultSurfaceStyle: material, shellPresets: builtInShellThemePresets } }}><Content /></FloeProvider>, host);
  for (const preset of builtInShellThemePresets) {
    const mode = preset.mode as 'light' | 'dark';
    theme.selectShellTheme(mode, preset.name);
    theme.setTheme(mode);
    await expect.poll(() => document.documentElement.dataset.floeShellTheme).toBe(preset.name);
    const result = await axe.run(host, { runOnly: ['color-contrast'] });
    expect.soft(result.violations.map((violation) => violation.nodes.map((node) => node.failureSummary)), preset.name).toEqual([]);
  }
}, 60_000);

it('keeps suggestions readable in a narrow Workbench panel at desktop viewport width', async () => {
  await page.viewport(1440, 1000);
  const host = document.createElement('main');
  host.style.width = '330px';
  document.body.append(host);
  dispose = render(() => <FloeProvider config={{ storage: { enabled: false } }}><FlowerEmptyState onSuggestionClick={() => undefined} /></FloeProvider>, host);
  const suggestions = Array.from(host.querySelectorAll('.flower-empty-suggestion'));
  expect(suggestions).toHaveLength(4);
  for (const suggestion of suggestions) {
    expect(suggestion.getBoundingClientRect().width).toBeGreaterThan(230);
    expect(suggestion.scrollWidth).toBeLessThanOrEqual(suggestion.clientWidth);
  }
});

function resolveColor(value: string): string {
  const probe = document.createElement('span');
  probe.style.color = value;
  document.body.append(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  return color;
}

it.each(['standard', 'soft-neumorphic'] as const)('keeps published palettes and quiet product boundaries in %s', async (material) => {
  await page.viewport(1000, 800);
  const host = document.createElement('main');
  document.body.append(host);
  let theme!: ReturnType<typeof useTheme>;
  function Content() {
    theme = useTheme();
    return <div class="redeven-surface-main" style={{ padding: '24px' }}>
      <Card><FlowerNavigationIcon /><Input aria-label="Workspace draft" value="Retained workspace" /></Card>
      <div class="flower-surface"><div class="flower-composer" data-floe-input-surface="" data-floe-surface="inset"><textarea aria-label="Flower draft" /></div></div>
    </div>;
  }
  dispose = render(() => <FloeProvider config={{ storage: { enabled: false }, theme: { defaultTheme: 'dark', defaultSurfaceStyle: material, shellPresets: builtInShellThemePresets } }}><Content /></FloeProvider>, host);
  const field = host.querySelector('input')!;
  field.focus();
  field.setSelectionRange(2, 8);
  field.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
  for (const preset of builtInShellThemePresets) {
    const mode = preset.mode as 'light' | 'dark';
    theme.selectShellTheme(mode, preset.name);
    theme.setTheme(mode);
    await expect.poll(() => document.documentElement.dataset.floeShellTheme).toBe(preset.name);
    expect.soft(resolveColor('var(--background)'), `${preset.name} published canvas`).toBe(resolveColor(preset.semanticTokens!['--background']!));
    expect.soft(getComputedStyle(host.firstElementChild!).backgroundColor, `${preset.name} product canvas`).toBe(resolveColor('var(--background)'));
    expect.soft(resolveColor('var(--redeven-stroke-control)'), `${preset.name} control boundary`).toBe(resolveColor('var(--input)'));
    expect.soft(getComputedStyle(host.querySelector('.flower-composer')!).borderTopColor, `${preset.name} composer control boundary`).toBe(resolveColor('var(--input)'));
    expect.soft(host.querySelector('input')).toBe(field);
    expect.soft(document.activeElement).toBe(field);
    expect.soft([field.value, field.selectionStart, field.selectionEnd]).toEqual(['Retained workspace', 2, 8]);
  }
  field.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
  const glow = host.querySelector('.redeven-flower-soft-aura-glow');
  expect(glow, 'navigation brand has no decorative glow layer').toBeNull();
  expect(host.getAnimations({ subtree: true }).filter((animation) => animation.effect?.getTiming().iterations === Infinity), 'idle surfaces have no persistent animation').toHaveLength(0);
});

import '../index.css';
import '../ui/flower-feature.css';
import { FloeProvider, useTheme } from '@floegence/floe-webapp-core';
import { CodeEditor, type CodeEditorApi } from '@floegence/floe-webapp-core/editor';
import { builtInShellThemePresets } from '@floegence/floe-webapp-core/themes';
import { Input, Checkbox, Switch, SegmentedControl } from '@floegence/floe-webapp-core/ui';
import { render } from 'solid-js/web';
import { afterEach, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { expectSingleInputFocus } from './inputFocus.test-support';
import { expectClearSelection } from './selectionContrast.test-support';
import { gitPatchPreviewLineClass } from '../ui/utils/gitPatch';

const preset = builtInShellThemePresets.find(p => p.name === 'porcelain-light')!;
const context = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
function paint(color: string, behind = [255, 255, 255], opacity = 1): number[] {
  context.clearRect(0, 0, 1, 1);
  context.fillStyle = 'rgb(' + behind.join(',') + ')'; context.fillRect(0, 0, 1, 1);
  context.globalAlpha = opacity;
  context.fillStyle = color; context.fillRect(0, 0, 1, 1);
  context.globalAlpha = 1;
  return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
}
function background(element: HTMLElement): number[] {
  const behind = element.parentElement ? background(element.parentElement) : [255, 255, 255];
  return paint(getComputedStyle(element).backgroundColor, behind);
}
function ratio(a: number[], b: number[]): number {
  const l = (c: number[]) => c.map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((s,v,i) => s + v * [.2126,.7152,.0722][i], 0);
  return (Math.max(l(a), l(b)) + .05) / (Math.min(l(a), l(b)) + .05);
}
function textContrast(element: HTMLElement, pseudo?: string): number {
  const fill = background(element);
  const style = getComputedStyle(element, pseudo);
  return ratio(paint(style.color, fill, Number(style.opacity)), fill);
}
let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.(); document.body.replaceChildren();
  document.documentElement.removeAttribute('style');
  delete document.documentElement.dataset.floeShellTheme;
  delete document.documentElement.dataset.floeSurfaceStyle;
  document.documentElement.classList.remove('light', 'dark');
});

it('keeps published Monaco brackets readable and editing state stable across theme changes', async () => {
  const host = document.createElement('main');
  document.body.append(host);
  let api: CodeEditorApi | undefined;
  let theme!: ReturnType<typeof useTheme>;
  const firstLine = 'const nested = ({ a: [({ b: [({ c: [1] })] })] });';
  const value = [firstLine, ...Array.from({ length: 80 }, (_, index) => '// Context line ' + index)].join('\n');
  function Editor() {
    theme = useTheme();
    return <CodeEditor path="porcelain-visibility.ts" language="typescript" value={value}
      options={{ readOnly: false, bracketPairColorization: { enabled: true }, minimap: { enabled: false }, fontSize: 14 }}
      style={{ height: '280px' }} onReady={ready => { api = ready; }} />;
  }
  dispose = render(() => <FloeProvider config={{ storage: { enabled: false }, theme: {
    defaultTheme: 'light', shellPresets: builtInShellThemePresets,
    defaultShellPreset: { light: 'porcelain-light', dark: 'classic-dark' },
  } }}><Editor /></FloeProvider>, host);
  await expect.poll(() => api, { timeout: 15_000 }).toBeDefined();
  const editor = api!;
  const brackets = () => [...host.querySelectorAll<HTMLElement>('[class*=bracket-highlighting-]')];
  await expect.poll(() => brackets().length, { timeout: 5_000 }).toBeGreaterThanOrEqual(12);
  // Monaco bracket colors inherit independently from syntax-token rules.
  // Measure the rendered spans so an upstream default cannot escape this check.
  for (const bracket of brackets()) {
    expect.soft(textContrast(bracket), 'rendered bracket ' + getComputedStyle(bracket).color)
      .toBeGreaterThanOrEqual(4.5);
  }
  expect.soft(new Set(brackets().map(node => getComputedStyle(node).color)).size).toBe(6);
  editor.focus();
  editor.editor.executeEdits('porcelain-visibility', [{
    range: { startLineNumber: 1, startColumn: firstLine.length + 1, endLineNumber: 1, endColumn: firstLine.length + 1 },
    text: ' // unsaved draft',
  }]);
  editor.editor.setSelection({ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 6 });
  const draft = editor.getValue();
  expect(draft).toBe(value.replace(firstLine, firstLine + ' // unsaved draft'));
  const model = editor.model;
  editor.editor.setScrollTop(180);
  const scrollTop = editor.editor.getScrollTop();
  expect(scrollTop).toBeGreaterThan(0);
  theme.setTheme('dark');
  await expect.poll(() => document.documentElement.classList.contains('dark')).toBe(true);
  theme.setTheme('light');
  await expect.poll(() => document.documentElement.dataset.floeShellTheme).toBe('porcelain-light');
  await expect.poll(() => document.documentElement.classList.contains('dark')).toBe(false);
  expect(api).toBe(editor);
  expect(editor.model).toBe(model);
  expect(editor.getValue()).toBe(draft);
  expect(editor.getSelectedText()).toBe('const');
  expect(editor.editor.hasTextFocus()).toBe(true);
  expect(editor.editor.getScrollTop()).toBe(scrollTop);
  editor.editor.setScrollTop(0);
  await expect.poll(() => brackets().length).toBeGreaterThanOrEqual(12);
  for (const bracket of brackets()) expect(textContrast(bracket)).toBeGreaterThanOrEqual(4.5);
}, 30_000);

it.each(['default', 'soft-neumorphic'])('measures published text and controls with %s material', async material => {
  const root = document.documentElement;
  root.classList.add('light'); root.dataset.floeShellTheme = preset.name;
  if (material !== 'default') root.dataset.floeSurfaceStyle = material;
  // Load the published CSS through the real app entry; inline token injection
  // would hide missing or stale packaged rules.
  const published = getComputedStyle(root);
  for (const token of ['--background', '--foreground', '--muted-foreground', '--floe-workbench-canvas'] as const) {
    expect(published.getPropertyValue(token).trim(), token + ' is present in CSS').not.toBe('');
    expect(preset.semanticTokens![token], token + ' is present in metadata').toBeTruthy();
    expect(paint(published.getPropertyValue(token)), token + ' matches the published preset')
      .toEqual(paint(preset.semanticTokens![token]!));
  }
  const host = document.createElement('main'); document.body.append(host);
  host.style.cssText = 'display:grid;grid-template-columns:repeat(4,1fr);gap:16px;padding:16px;background:var(--background)';
  dispose = render(() => <>{['background', 'card', 'sidebar', 'muted'].map(surface => <section style={{ background: 'var(--' + surface + ')', padding: '12px', display: 'grid', gap: '12px' }}>
    <span data-reading style={{ color: 'var(--foreground)' }}>Workspace overview</span>
    <span data-reading style={{ color: 'var(--muted-foreground)' }}>Secondary metadata</span>
    {[40,45,50,60,65,70,75,80,90].map(alpha => <span data-reading class={'text-muted-foreground/' + alpha}>Small label</span>)}
    <span data-reading class={gitPatchPreviewLineClass("@@ -1 +1 @@")}>@@ -1 +1 @@</span>
    <Input aria-label={surface + ' field'} placeholder="Search environments" />
    <div data-floe-input-surface class="floe-field"><input aria-label={surface + ' compound field'} class="border-0 bg-transparent placeholder:text-muted-foreground" placeholder="Filter files" /></div>
    <Checkbox label="Enable history" description="Keep readable detail" checked={false} />
    <Checkbox label="Selected history" checked={true} />
    <Switch label="Offline switch" checked={false} />
    <Switch label="Online switch" checked={true} />
    <SegmentedControl value="local" onChange={() => {}} options={[{ value: 'local', label: 'Local' }, { value: 'remote', label: 'Remote' }]} />
  </section>)}</>, host);
  for (const element of host.querySelectorAll<HTMLElement>('[data-reading]')) {
    expect(textContrast(element), material + ': ' + element.className + ' readable text').toBeGreaterThanOrEqual(4.5);
  }
  const fields = host.querySelectorAll<HTMLInputElement>('input[placeholder]');
  expect(fields.length).toBe(8);
  for (const input of fields) {
    expect(textContrast(input, '::placeholder'), input.ariaLabel + ' placeholder').toBeGreaterThanOrEqual(4.5);
    expectSingleInputFocus(input);
    const owner = input.closest<HTMLElement>('[data-floe-input-surface]') ?? input;
    const fill = background(owner), focus = getComputedStyle(owner);
    expect(ratio(paint(focus.borderTopColor, fill), fill), input.ariaLabel + ' focus').toBeGreaterThanOrEqual(3);
    input.blur();
    await page.elementLocator(input).hover();
    await Promise.all(document.getAnimations().filter(a => a.effect?.getTiming().iterations !== Infinity).map(a => a.finished.catch(() => undefined)));
    expect(textContrast(input, '::placeholder'), input.ariaLabel + ' hover placeholder').toBeGreaterThanOrEqual(4.5);
  }
  const indicators = host.querySelectorAll<HTMLElement>('[data-floe-surface-part="indicator"], [data-floe-surface-part="switch-track"]');
  expect(indicators.length).toBe(16);
  for (const indicator of indicators) {
    const style = getComputedStyle(indicator), outside = background(indicator.parentElement!);
    const fill = background(indicator);
    const border = style.borderTopWidth !== '0px' && style.borderTopStyle !== 'none'
      ? ratio(paint(style.borderTopColor, fill), outside) : 1;
    expect(Math.max(ratio(fill, outside), border), material + ' visible essential control').toBeGreaterThanOrEqual(3);
    const glyph = indicator.querySelector<SVGElement>('svg');
    if (glyph) expect(ratio(paint(getComputedStyle(glyph).color, fill), fill), material + ' selected checkmark').toBeGreaterThanOrEqual(3);
  }
  const selectedSegments = host.querySelectorAll<HTMLElement>('button[aria-checked="true"]');
  expect(selectedSegments.length).toBe(4);
  for (const selected of selectedSegments) expectClearSelection(selected, material);
});

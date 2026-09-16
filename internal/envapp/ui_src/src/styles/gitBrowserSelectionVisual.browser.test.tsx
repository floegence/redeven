import '../index.css';

import { builtInShellThemePresets } from '@floegence/floe-webapp-core/themes';
import { LayoutProvider } from '@floegence/floe-webapp-core';
import { render } from 'solid-js/web';
import { page } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';

import { GitWorkbenchSidebar } from '../ui/widgets/GitWorkbenchSidebar';
import { GitHistoryModeSwitch } from '../ui/widgets/GitHistoryModeSwitch';
import { GitMetaPill } from '../ui/widgets/GitWorkbenchPrimitives';

type Rgb = readonly [number, number, number];

function colorChannels(value: string, backdrop?: string): Rgb {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas color context is unavailable.');
  if (backdrop) {
    context.fillStyle = backdrop;
    context.fillRect(0, 0, 1, 1);
  }
  context.fillStyle = value;
  context.fillRect(0, 0, 1, 1);
  const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
  return [red / 255, green / 255, blue / 255];
}

function relativeLuminance(color: Rgb): number {
  const linear = color.map((channel) => (
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  ));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(first: string, second: string, backdrop?: string): number {
  const firstLuminance = relativeLuminance(colorChannels(first));
  const secondLuminance = relativeLuminance(colorChannels(second, backdrop));
  return (Math.max(firstLuminance, secondLuminance) + 0.05)
    / (Math.min(firstLuminance, secondLuminance) + 0.05);
}

function oklab(color: Rgb): Rgb {
  const [red, green, blue] = color.map((channel) => (
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  ));
  const l = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue);
  const m = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue);
  const s = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function deltaEOK(first: string, second: string): number {
  const firstLab = oklab(colorChannels(first));
  const secondLab = oklab(colorChannels(second));
  return Math.hypot(...firstLab.map((channel, index) => channel - secondLab[index]));
}

function applyTheme(preset: (typeof builtInShellThemePresets)[number]): void {
  const mode = preset.mode === 'dark' ? 'dark' : 'light';
  document.documentElement.classList.toggle('dark', mode === 'dark');
  document.documentElement.classList.toggle('light', mode === 'light');
  document.documentElement.dataset.floeShellTheme = preset.name;
  for (const [name, value] of Object.entries(preset.semanticTokens ?? {})) {
    if (value) document.documentElement.style.setProperty(name, value);
  }
}

function probe(parent: HTMLElement, className: string, text = 'Selection'): HTMLButtonElement {
  const element = document.createElement('button');
  element.type = 'button';
  element.className = className;
  element.textContent = text;
  Object.assign(element.style, {
    borderStyle: 'solid',
    borderWidth: '1px',
    borderLeftWidth: '2px',
    padding: '8px',
  });
  parent.appendChild(element);
  return element;
}

function mountPanel(): HTMLDivElement {
  const panel = document.createElement('div');
  panel.style.background = 'var(--redeven-surface-panel)';
  panel.style.padding = '12px';
  document.body.appendChild(panel);
  return panel;
}

function resolvedThemeColor(variable: string): string {
  const probe = document.createElement('span');
  probe.style.color = `var(${variable})`;
  document.body.appendChild(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  return color;
}

afterEach(() => {
  document.body.replaceChildren();
  document.documentElement.classList.remove('dark', 'light');
  document.documentElement.removeAttribute('data-floe-shell-theme');
  document.documentElement.removeAttribute('data-floe-surface-style');
  document.documentElement.removeAttribute('style');
});

describe('Git browser rendered selection contract', () => {
  it.each(['standard', 'soft-neumorphic'])('keeps selected, hovered, focused, and current states distinct in every built-in theme with %s', async (material) => {
    expect.soft(builtInShellThemePresets).toHaveLength(26);
    document.documentElement.dataset.floeSurfaceStyle = material;

    for (const preset of builtInShellThemePresets) {
      document.body.replaceChildren();
      document.documentElement.removeAttribute('style');
      applyTheme(preset);

      const panel = mountPanel();
      panel.className = 'redeven-git-browser';
      const sharedControls = document.createElement('div');
      panel.appendChild(sharedControls);
      const disposeControls = render(() => <>
        <GitHistoryModeSwitch mode="git" onChange={() => {}} />
        <GitMetaPill tone="neutral">main</GitMetaPill>
        <GitMetaPill tone="success">Current</GitMetaPill>
      </>, sharedControls);
      const hovered = probe(panel, 'git-browser-interactive');
      const selected = probe(panel, 'git-browser-interactive git-browser-selection-row');
      selected.setAttribute('aria-selected', 'true');
      const secondary = document.createElement('span');
      secondary.className = 'git-browser-selection-secondary';
      secondary.textContent = 'Upstream origin/main · Linked worktree';
      selected.appendChild(secondary);
      const tableHeader = probe(panel, 'git-branch-status-empty-table__header', 'Path');
      const selectedTab = probe(panel, 'git-browser-segmented-tab redeven-surface-segmented__item--active', 'Workspace');
      const focus = probe(panel, 'git-browser-interactive');
      const current = probe(panel, 'git-browser-current-chip', 'Current');
      const currentOnSelected = document.createElement('span');
      currentOnSelected.className = 'git-browser-current-chip';
      currentOnSelected.textContent = 'Current';
      selected.appendChild(currentOnSelected);

      await page.elementLocator(hovered).hover();
      focus.focus();

      const panelStyle = getComputedStyle(panel);
      const hoverStyle = getComputedStyle(hovered);
      const selectedStyle = getComputedStyle(selected);
      const focusStyle = getComputedStyle(focus);
      const currentStyle = getComputedStyle(current);
      const currentOnSelectedStyle = getComputedStyle(currentOnSelected);
      const panelBackground = panelStyle.backgroundColor;
      const selectionSource = resolvedThemeColor('--git-browser-selection-source');
      const selectionAccent = resolvedThemeColor('--git-browser-selection-accent');
      const themeRing = resolvedThemeColor('--ring');

      const modeButton = sharedControls.querySelector<HTMLElement>('[aria-checked="true"]')!;
      const modeThumb = sharedControls.querySelector<HTMLElement>('.browser-mode-switch__thumb')!;
      expect.soft(contrastRatio(getComputedStyle(modeButton).color, getComputedStyle(modeThumb).backgroundColor), `${preset.name} selected browser mode`).toBeGreaterThanOrEqual(4.5);
      for (const tag of sharedControls.querySelectorAll<HTMLElement>('.floe-tag')) {
        const style = getComputedStyle(tag);
        expect.soft(contrastRatio(style.color, style.backgroundColor, panelBackground), `${preset.name} repository fact ${tag.textContent}`).toBeGreaterThanOrEqual(4.5);
      }

      expect.soft(contrastRatio(selectedStyle.color, selectedStyle.backgroundColor), `${preset.name} selected text`).toBeGreaterThanOrEqual(4.5);
      expect.soft(contrastRatio(getComputedStyle(secondary).color, selectedStyle.backgroundColor), `${preset.name} selected branch metadata`).toBeGreaterThanOrEqual(4.5);
      expect.soft(contrastRatio(getComputedStyle(tableHeader).color, panelBackground), `${preset.name} table header`).toBeGreaterThanOrEqual(4.5);
      expect.soft(contrastRatio(getComputedStyle(selectedTab).color, getComputedStyle(selectedTab).backgroundColor), `${preset.name} selected workspace tab`).toBeGreaterThanOrEqual(4.5);
      expect.soft(contrastRatio(selectedStyle.borderLeftColor, panelBackground), `${preset.name} selection indicator`).toBeGreaterThanOrEqual(3);
      expect.soft(focusStyle.outlineStyle, `${preset.name} focus outline style`).toBe('solid');
      expect.soft(contrastRatio(focusStyle.outlineColor, panelBackground), `${preset.name} focus ring`).toBeGreaterThanOrEqual(3);
      expect.soft(deltaEOK(selectedStyle.backgroundColor, panelBackground), `${preset.name} selected/idle`).toBeGreaterThanOrEqual(0.025);
      expect.soft(deltaEOK(selectedStyle.backgroundColor, hoverStyle.backgroundColor), `${preset.name} selected/hover`).toBeGreaterThanOrEqual(0.015);
      expect.soft(contrastRatio(currentStyle.color, currentStyle.backgroundColor), `${preset.name} current chip`).toBeGreaterThanOrEqual(4.5);
      expect.soft(currentOnSelectedStyle.color, `${preset.name} current selected color`).toBe(currentStyle.color);
      expect.soft(currentOnSelectedStyle.backgroundColor, `${preset.name} current selected background`).toBe(currentStyle.backgroundColor);
      expect.soft(currentOnSelectedStyle.borderColor, `${preset.name} current selected border`).toBe(currentStyle.borderColor);
      expect.soft(deltaEOK(selectionSource, themeRing), `${preset.name} theme interaction source`).toBeLessThanOrEqual(0.004);
      expect.soft(deltaEOK(selectionAccent, themeRing), `${preset.name} native focus accent`).toBeLessThanOrEqual(0.04);
      disposeControls();
    }
  });

  it('renders real branch selection clearly across representative themes and sidebar widths', async () => {
    const themeNames = [
      'classic-dark',
      'classic-light',
      'porcelain-light',
      'porcelain-dark',
      'citrus',
      'meadow',
      'lilac',
      'ember',
      'forest',
      'dracula',
      'nord',
      'abyss',
    ] as const;
    const widths = [280, 360] as const;

    for (const themeName of themeNames) {
      const preset = builtInShellThemePresets.find((entry) => entry.name === themeName);
      if (!preset) throw new Error(`Missing built-in theme: ${themeName}`);

      for (const width of widths) {
        document.body.replaceChildren();
        document.documentElement.removeAttribute('style');
        applyTheme(preset);
        await page.viewport(width + 32, 560);

        const host = document.createElement('div');
        host.style.width = `${width}px`;
        host.style.height = '520px';
        host.style.background = 'var(--redeven-surface-panel)';
        host.style.padding = '8px';
        document.body.appendChild(host);

        const dispose = render(() => (
          <LayoutProvider>
            <GitWorkbenchSidebar
              subview="branches"
              repoAvailable
              branches={{
                repoRootPath: '/workspace/redeven',
                currentRef: 'main',
                local: [
                  { name: 'main', fullName: 'refs/heads/main', kind: 'local', current: true, subject: 'Stable product branch' },
                  { name: 'feature/git-selection', fullName: 'refs/heads/feature/git-selection', kind: 'local', subject: 'Improve Git browser selection contrast' },
                ],
                remote: [
                  { name: 'origin/main', fullName: 'refs/remotes/origin/main', kind: 'remote', subject: 'Published product branch' },
                ],
              }}
              selectedBranchKey="refs/heads/feature/git-selection"
            />
          </LayoutProvider>
        ), host);

        try {
          const current = host.querySelector<HTMLElement>('.git-browser-current-chip');
          const selected = host.querySelector<HTMLElement>('[data-git-sidebar-branch-key="refs/heads/feature/git-selection"]');
          expect(current?.textContent, `${themeName} ${width}px current`).toBe('Current');
          expect(selected?.className, `${themeName} ${width}px selected`).toContain('git-browser-selection-row');
          expect(
            (await page.elementLocator(host).screenshot({ save: false })).length,
            `${themeName} ${width}px screenshot`,
          ).toBeGreaterThan(200);
        } finally {
          dispose();
        }
      }
    }
  });
});

import '../index.css';

import { builtInShellThemePresets } from '@floegence/floe-webapp-core/themes';
import { page } from 'vitest/browser';
import { afterEach, describe, expect, it } from 'vitest';

type Rgb = readonly [number, number, number];

function paintedColor(foreground: string, background = 'rgb(0, 0, 0)'): Rgb {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas color context is unavailable.');
  context.fillStyle = background;
  context.fillRect(0, 0, 1, 1);
  context.fillStyle = foreground;
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

function contrastRatio(first: Rgb, second: Rgb): number {
  const firstLuminance = relativeLuminance(first);
  const secondLuminance = relativeLuminance(second);
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

function deltaEOK(first: Rgb, second: Rgb): number {
  const firstLab = oklab(first);
  const secondLab = oklab(second);
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

function setBorder(element: HTMLElement, edge: 'all' | 'top' = 'all'): void {
  if (edge === 'top') {
    element.style.borderTopStyle = 'solid';
    element.style.borderTopWidth = '1px';
    return;
  }
  element.style.borderStyle = 'solid';
  element.style.borderWidth = '1px';
}

function mountSettingsFixture(): Readonly<{
  host: HTMLElement;
  sidebar: HTMLElement;
  hovered: HTMLButtonElement;
  selected: HTMLButtonElement;
  content: HTMLElement;
  section: HTMLElement;
  secondSection: HTMLElement;
  table: HTMLElement;
  divider: HTMLElement;
  control: HTMLButtonElement;
}> {
  const host = document.createElement('main');
  host.className = 'redeven-settings-shell';
  Object.assign(host.style, {
    display: 'grid',
    gridTemplateColumns: '240px minmax(0, 1fr)',
    width: '920px',
    minHeight: '520px',
    fontFamily: 'system-ui, sans-serif',
  });

  const sidebar = document.createElement('aside');
  sidebar.className = 'redeven-settings-sidebar';
  Object.assign(sidebar.style, { padding: '16px', borderRightStyle: 'solid', borderRightWidth: '1px' });

  const label = document.createElement('div');
  label.className = 'redeven-settings-sidebar-note';
  label.textContent = 'Runtime environment';
  label.style.padding = '8px 12px';
  sidebar.appendChild(label);

  const idle = document.createElement('button');
  idle.type = 'button';
  idle.className = 'redeven-settings-nav-item redeven-settings-sidebar-note';
  idle.textContent = 'Overview';

  const hovered = document.createElement('button');
  hovered.type = 'button';
  hovered.className = 'redeven-settings-nav-item redeven-settings-sidebar-note';
  hovered.textContent = 'Connections';

  const selected = document.createElement('button');
  selected.type = 'button';
  selected.className = 'redeven-settings-nav-item redeven-settings-nav-item--active';
  selected.textContent = 'Codespaces and tools';
  selected.setAttribute('aria-current', 'page');

  for (const item of [idle, hovered, selected]) {
    Object.assign(item.style, {
      display: 'block',
      width: '100%',
      padding: '8px 12px',
      border: '0',
      borderRadius: '6px',
      textAlign: 'left',
    });
    sidebar.appendChild(item);
  }

  const content = document.createElement('section');
  content.className = 'redeven-settings-content';
  content.style.padding = '32px';

  const section = document.createElement('article');
  section.className = 'redeven-settings-section';

  const title = document.createElement('h2');
  title.textContent = 'Browser Editor';
  Object.assign(title.style, { margin: '0 0 16px', fontSize: '16px' });
  section.appendChild(title);

  const table = document.createElement('div');
  table.className = 'redeven-settings-table';
  table.style.borderRadius = '8px';
  setBorder(table);

  const header = document.createElement('div');
  header.className = 'redeven-settings-table__header-row';
  header.textContent = 'Setting              Value              Description';
  Object.assign(header.style, { padding: '10px 12px', fontWeight: '600' });
  header.style.borderBottomStyle = 'solid';
  header.style.borderBottomWidth = '1px';
  table.appendChild(header);

  const firstRow = document.createElement('div');
  firstRow.className = 'redeven-settings-table__row';
  firstRow.textContent = 'Selected version     4.133.0            Managed runtime';
  firstRow.style.padding = '12px';
  table.appendChild(firstRow);

  const divider = document.createElement('div');
  divider.className = 'redeven-settings-table__row';
  divider.textContent = 'Active source        Managed            Ready';
  divider.style.padding = '12px';
  setBorder(divider, 'top');
  table.appendChild(divider);
  section.appendChild(table);

  const control = document.createElement('button');
  control.type = 'button';
  control.className = 'redeven-settings-control';
  control.textContent = 'Refresh inventory';
  Object.assign(control.style, { marginTop: '16px', padding: '8px 12px', borderRadius: '6px' });
  setBorder(control);
  section.appendChild(control);

  const secondSection = document.createElement('article');
  secondSection.className = 'redeven-settings-section';

  const secondTitle = document.createElement('h2');
  secondTitle.textContent = 'Codespaces ports';
  Object.assign(secondTitle.style, { margin: '0 0 16px', fontSize: '16px' });
  secondSection.appendChild(secondTitle);

  const portsList = document.createElement('div');
  portsList.className = 'redeven-settings-list';
  Object.assign(portsList.style, { padding: '12px', borderRadius: '8px' });
  setBorder(portsList);
  portsList.textContent = 'Port range 20000–21000';
  secondSection.appendChild(portsList);

  content.append(section, secondSection);
  host.append(sidebar, content);
  document.body.appendChild(host);
  return { host, sidebar, hovered, selected, content, section, secondSection, table, divider, control };
}

afterEach(() => {
  document.body.replaceChildren();
  document.documentElement.classList.remove('dark', 'light');
  document.documentElement.removeAttribute('data-floe-shell-theme');
  document.documentElement.removeAttribute('data-floe-surface-style');
  document.documentElement.removeAttribute('style');
});

describe('Settings theme hierarchy', () => {
  it.each(['standard', 'soft-neumorphic'])('keeps structure quiet and selection clear in every built-in shell theme with %s material', async (material) => {
    document.documentElement.dataset.floeSurfaceStyle = material;
    expect(builtInShellThemePresets).toHaveLength(24);

    for (const preset of builtInShellThemePresets) {
      document.body.replaceChildren();
      document.documentElement.removeAttribute('style');
      applyTheme(preset);
      const fixture = mountSettingsFixture();
      await page.elementLocator(fixture.hovered).hover();

      const sidebarStyle = getComputedStyle(fixture.sidebar);
      const hoverStyle = getComputedStyle(fixture.hovered);
      const selectedStyle = getComputedStyle(fixture.selected);
      const indicatorStyle = getComputedStyle(fixture.selected, '::before');
      const contentStyle = getComputedStyle(fixture.content);
      const sectionStyle = getComputedStyle(fixture.section);
      const secondSectionStyle = getComputedStyle(fixture.secondSection);
      const tableStyle = getComputedStyle(fixture.table);
      const dividerStyle = getComputedStyle(fixture.divider);
      const controlStyle = getComputedStyle(fixture.control);

      const sidebarBackground = paintedColor(sidebarStyle.backgroundColor);
      const selectedBackground = paintedColor(selectedStyle.backgroundColor, sidebarStyle.backgroundColor);
      const hoverBackground = paintedColor(hoverStyle.backgroundColor, sidebarStyle.backgroundColor);
      const contentBackground = paintedColor(contentStyle.backgroundColor);
      const sectionSurface = sectionStyle.backgroundColor === 'rgba(0, 0, 0, 0)'
        ? contentStyle.backgroundColor
        : sectionStyle.backgroundColor;
      const sectionBackground = paintedColor(sectionStyle.backgroundColor, contentStyle.backgroundColor);
      const tableBackground = paintedColor(tableStyle.backgroundColor, sectionSurface);
      const controlBackground = paintedColor(controlStyle.backgroundColor, sectionSurface);
      const sectionBorder = paintedColor(sectionStyle.borderTopColor, sectionSurface);
      const tableBorder = paintedColor(tableStyle.borderTopColor, tableStyle.backgroundColor);
      const dividerBorder = paintedColor(dividerStyle.borderTopColor, tableStyle.backgroundColor);
      const controlBorder = paintedColor(controlStyle.borderTopColor, controlStyle.backgroundColor);
      const sectionBorderContrast = contrastRatio(sectionBorder, sectionBackground);
      const tableBorderContrast = contrastRatio(tableBorder, tableBackground);
      const dividerContrast = contrastRatio(dividerBorder, tableBackground);
      const controlContrast = contrastRatio(controlBorder, controlBackground);

      expect(
        contrastRatio(paintedColor(selectedStyle.color), selectedBackground),
        `${preset.name} selected text`,
      ).toBeGreaterThanOrEqual(4.5);
      expect(
        contrastRatio(paintedColor(indicatorStyle.backgroundColor), selectedBackground),
        `${preset.name} selected indicator`,
      ).toBeGreaterThanOrEqual(3);
      expect(secondSectionStyle.marginTop, `${preset.name} section spacing`).toBe('40px');

      if (preset.name === 'hc-light') {
        expect(sectionStyle.borderTopWidth, `${preset.name} section boundary`).toBe('1px');
        expect(sectionStyle.paddingTop, `${preset.name} section padding`).toBe('20px');
        expect(sectionBorderContrast, `${preset.name} section boundary`).toBeGreaterThanOrEqual(3);
        expect(tableBorderContrast, `${preset.name} table boundary`).toBeGreaterThanOrEqual(3);
        expect(dividerContrast, `${preset.name} divider`).toBeGreaterThanOrEqual(3);
      } else {
        expect(sectionStyle.borderTopWidth, `${preset.name} section boundary`).toBe('0px');
        expect(sectionStyle.paddingTop, `${preset.name} section padding`).toBe('0px');
        expect(deltaEOK(sectionBackground, contentBackground), `${preset.name} section/content surface`).toBeLessThanOrEqual(0.001);
        expect(
          dividerContrast,
          `${preset.name} divider/table ordering (${dividerStyle.borderTopColor} on ${tableStyle.backgroundColor}; ${tableStyle.borderTopColor} on ${tableStyle.backgroundColor})`,
        ).toBeLessThan(tableBorderContrast);
        expect(tableBorderContrast, `${preset.name} table/control ordering`).toBeLessThan(controlContrast);
        expect(deltaEOK(selectedBackground, sidebarBackground), `${preset.name} selected/idle`).toBeGreaterThanOrEqual(0.025);
        expect(deltaEOK(selectedBackground, hoverBackground), `${preset.name} selected/hover`).toBeGreaterThanOrEqual(0.015);
      }
    }
  });

  it('renders representative light, dark, and colored settings themes', async () => {
    const themeNames = [
      'classic-light',
      'classic-dark',
      'github-light',
      'dracula',
      'nord',
      'forest',
      'citrus',
    ] as const;

    await page.viewport(980, 600);
    for (const themeName of themeNames) {
      const preset = builtInShellThemePresets.find((candidate) => candidate.name === themeName);
      if (!preset) throw new Error(`Missing built-in theme: ${themeName}`);
      document.body.replaceChildren();
      document.documentElement.removeAttribute('style');
      applyTheme(preset);
      const fixture = mountSettingsFixture();
      expect(
        (await page.elementLocator(fixture.host).screenshot({ save: false })).length,
        `${themeName} settings screenshot`,
      ).toBeGreaterThan(400);
    }
  });
});

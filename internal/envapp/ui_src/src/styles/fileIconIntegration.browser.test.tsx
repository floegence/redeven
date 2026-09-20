import '../index.css';
import { FloeConfigProvider, LayoutProvider } from '@floegence/floe-webapp-core';
import { render } from 'solid-js/web';
import { afterEach, expect, it } from 'vitest';
import { page } from 'vitest/browser';
import { FileBrowserWorkspace } from '../ui/widgets/FileBrowserWorkspace';
import { GitFileLabel } from '../ui/widgets/GitFileLabel';
import { toFileItem } from '../ui/widgets/FileBrowserShared';

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  document.body.replaceChildren();
  document.documentElement.classList.remove('dark', 'light');
  document.documentElement.removeAttribute('data-floe-shell-theme');
  document.documentElement.removeAttribute('data-floe-surface-style');
});

const examples = [
  ['data.json', 'json'], ['config.yaml', 'yaml'], ['settings.toml', 'toml'],
  ['App.swift', 'swift'], ['design.psd', 'photoshop'], ['print.ps', 'postscript'],
  ['brief.doc', 'word'], ['report.docx', 'word'], ['slides.ppt', 'powerpoint'],
  ['pitch.pptx', 'powerpoint'], ['budget.xlsx', 'excel'], ['notes.wps', 'wps'],
  ['setup.dmg', 'dmg'], ['package.deb', 'deb'], ['screen.fig', 'figma'],
  ['tool.py', 'python'], ['unknown.redeven-unknown', 'file'],
] as const;
const files = [
  ...examples.map(([name]) => toFileItem({ name, path: `/${name}`, isDirectory: false })),
  toFileItem({ name: 'App.xcodeproj', path: '/App.xcodeproj', isDirectory: true }),
];
const productColors = {
  swift: ['rgb(240, 81, 56)'],
  photoshop: ['rgb(49, 168, 255)', 'rgb(0, 30, 54)'],
  word: ['rgb(43, 87, 154)'],
  powerpoint: ['rgb(183, 71, 42)'],
  excel: ['rgb(33, 115, 70)'],
  wps: ['rgb(30, 111, 255)'],
  deb: ['rgb(168, 29, 51)'],
  figma: ['rgb(242, 78, 30)', 'rgb(255, 114, 98)', 'rgb(162, 89, 255)', 'rgb(26, 188, 254)', 'rgb(10, 207, 131)'],
  python: ['rgb(55, 118, 171)', 'rgb(255, 212, 59)'],
};

it.each(['classic-light', 'classic-dark', 'porcelain-light', 'porcelain-dark'])(
  'uses the released format artwork in Files and Git under %s', async (preset) => {
    await page.viewport(1440, 1000);
    document.documentElement.classList.add(preset.endsWith('dark') ? 'dark' : 'light');
    document.documentElement.dataset.floeShellTheme = preset;
    document.documentElement.dataset.floeSurfaceStyle = 'soft-neumorphic';
    const host = document.createElement('main');
    document.body.append(host);
    dispose = render(() => <FloeConfigProvider><LayoutProvider>
      <div data-testid="files-surface" style={{ height: '850px' }}><FileBrowserWorkspace
        mode="files" onModeChange={() => undefined} files={files}
        currentPath="/" initialPath="/" instanceId="format-icons" resetKey={0} open width={240}
      /></div>
      <div data-testid="git-file"><GitFileLabel path="src/App.swift" /></div>
    </LayoutProvider></FloeConfigProvider>, host);

    const surface = host.querySelector('[data-testid="files-surface"]')!;
    for (const [, kind] of examples) {
      await expect.poll(() => surface.querySelector(`svg[data-file-icon-type="${kind}"][data-file-icon-size="detailed"]`), { message: `${kind} is identified in the grid` }).toBeTruthy();
      const icon = surface.querySelector<SVGSVGElement>(`svg[data-file-icon-type="${kind}"][data-file-icon-size="detailed"]`)!;
      expect(icon.getBoundingClientRect().width).toBe(40);
      expect(icon!.querySelector('text')).toBeNull();
    }
    for (const [kind, expected] of Object.entries(productColors)) {
      const icon = surface.querySelector(`svg[data-file-icon-type="${kind}"]`)!;
      const colors = new Set(Array.from(icon.querySelectorAll('*')).flatMap((node) => {
        const style = getComputedStyle(node);
        return [style.fill, style.stroke, style.stopColor];
      }));
      for (const color of expected) expect(colors.has(color), `${kind}: ${color}`).toBe(true);
    }
    const directoryIcon = surface.querySelector<SVGSVGElement>('[data-tree-row-path="/App.xcodeproj"] svg[data-file-icon-type="xcode"]')!;
    expect(directoryIcon).toBeTruthy();
    expect(directoryIcon.dataset.fileIconSize).toBe('compact');
    expect(directoryIcon.getBoundingClientRect().width).toBe(14);
    const gitIcon = host.querySelector<SVGSVGElement>('[data-testid="git-file"] svg')!;
    expect(gitIcon.dataset.fileIconType).toBe('swift');
    expect(gitIcon.dataset.fileIconSize).toBe('compact');
    expect(gitIcon.getBoundingClientRect().width).toBe(14);

    await page.getByRole('radio', { name: 'List', exact: true }).click();
    for (const [, kind] of examples) {
      const icon = surface.querySelector<SVGSVGElement>(`svg[data-file-icon-type="${kind}"]`)!;
      expect(icon.dataset.fileIconSize).toBe('compact');
      expect(icon.getBoundingClientRect().width).toBe(16);
    }
  },
);

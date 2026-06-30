import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const surfacePath = path.join(repoRoot, 'internal', 'flower_ui', 'src', 'FlowerSurface.tsx');
const stylesPath = path.join(repoRoot, 'internal', 'flower_ui', 'src', 'styles', 'flower.css');

function readFile(filePath: string): string {
  return fs.readFileSync(filePath, 'utf8');
}

function cssRule(css: string, selector: string): string {
  const start = css.indexOf(`${selector} {`);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = css.indexOf('\n}', start);
  expect(end).toBeGreaterThan(start);
  return css.slice(start, end + 2);
}

describe('Flower working directory chip', () => {
  it('keeps the selected-thread hover title tied to the full working directory path', () => {
    const source = readFile(surfacePath);

    expect(source).toContain('return `${copy().threadList.copyWorkingDirectory}: ${path}`;');
    expect(source).toContain('title={workingDirectoryChipTitle()}');
    expect(source).toContain('aria-label={workingDirectoryChipTitle()}');
  });

  it('confirms successful selected-thread copy by swapping the folder icon to a check mark', () => {
    const source = readFile(surfacePath);

    expect(source).toContain('const [workingDirectoryCopied, setWorkingDirectoryCopied] = createSignal(false)');
    expect(source).toContain('const confirmWorkingDirectoryCopied = () =>');
    expect(source).toContain('confirmWorkingDirectoryCopied();');
    expect(source).toContain('}, MESSAGE_COPY_RESET_MS);');
    expect(source).toContain("data-copied={workingDirectoryCopied() ? 'true' : 'false'}");
    expect(source).toContain('<FolderOpen class="flower-working-dir-chip-icon-idle h-3.5 w-3.5" />');
    expect(source).toContain('<Check class="flower-working-dir-chip-icon-copied h-3.5 w-3.5" />');
  });

  it('styles the copied state without resizing the chip', () => {
    const css = readFile(stylesPath);
    const iconRule = cssRule(css, '.flower-working-dir-chip-icon');
    const copiedRule = cssRule(css, ".flower-working-dir-chip[data-copied='true']");

    expect(iconRule).toContain('width: 0.875rem');
    expect(iconRule).toContain('height: 0.875rem');
    expect(iconRule).toContain('flex: 0 0 auto');
    expect(copiedRule).toContain('#16a34a');
    expect(css).toContain(".flower-working-dir-chip[data-copied='true'] .flower-working-dir-chip-icon-idle");
    expect(css).toContain(".flower-working-dir-chip[data-copied='true'] .flower-working-dir-chip-icon-copied");
  });
});

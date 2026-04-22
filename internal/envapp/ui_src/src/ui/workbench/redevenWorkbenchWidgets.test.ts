import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('./redevenWorkbenchWidgets.tsx', import.meta.url), 'utf8');

function widgetBlockOf(type: string): string {
  const match = source.match(
    new RegExp(`\\{\\s*type:\\s*'${type.replace('.', '\\.')}'[\\s\\S]*?\\n  \\},`)
  );
  expect(match?.[0]).toBeTruthy();
  return match![0];
}

function expectProjectedSurface(type: string): void {
  expect(widgetBlockOf(type)).toMatch(/renderMode:\s*'projected_surface'/);
}

describe('redevenWorkbenchWidgets source contract', () => {
  it('projects heavy workbench widgets onto the overlay surface', () => {
    expectProjectedSurface('redeven.files');
    expectProjectedSurface('redeven.terminal');
    expectProjectedSurface('redeven.preview');
    expectProjectedSurface('redeven.codespaces');
    expectProjectedSurface('redeven.ai');
    expectProjectedSurface('redeven.codex');
  });

  it('keeps lightweight widgets off the projected path by default', () => {
    expect(widgetBlockOf('redeven.monitor')).not.toMatch(/renderMode:\s*'projected_surface'/);
    expect(widgetBlockOf('redeven.ports')).not.toMatch(/renderMode:\s*'projected_surface'/);
  });
});

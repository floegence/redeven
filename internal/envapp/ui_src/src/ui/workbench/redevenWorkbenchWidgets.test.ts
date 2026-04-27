import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const source = readFileSync(path.join(process.cwd(), 'src/ui/workbench/redevenWorkbenchWidgets.tsx'), 'utf8');

function widgetBlockOf(type: string): string {
  const match = source.match(
    new RegExp(`\\{\\s*type:\\s*'${type.replace('.', '\\.')}'[\\s\\S]*?\\n  \\},`)
  );
  expect(match?.[0]).toBeTruthy();
  return match![0];
}

function expectProjectedSurface(type: string): void {
  expect(widgetBlockOf(type)).toMatch(/renderMode:\s*FRONTABLE_WORKBENCH_RENDER_MODE/);
}

function filterBarWidgetTypes(): string[] {
  const match = source.match(/redevenWorkbenchFilterBarWidgetTypes:[\s\S]*?=\s*\[([\s\S]*?)\];/);
  expect(match?.[1]).toBeTruthy();
  return [...match![1].matchAll(/'([^']+)'/g)].map((entry) => entry[1]);
}

describe('redevenWorkbenchWidgets source contract', () => {
  it('defines a shared projected render mode for frontable widgets', () => {
    expect(source).toMatch(/const\s+FRONTABLE_WORKBENCH_RENDER_MODE\s*=\s*'projected_surface'/);
  });

  it('projects every launcher-frontable widget onto the overlay surface', () => {
    const widgetTypes = filterBarWidgetTypes();
    expect(widgetTypes).toEqual([
      'redeven.files',
      'redeven.terminal',
      'redeven.monitor',
      'redeven.codespaces',
      'redeven.ports',
      'redeven.ai',
      'redeven.codex',
    ]);
    for (const type of widgetTypes) {
      expectProjectedSurface(type);
    }
  });

  it('marks overflow-only projected wrappers as non-routing wheel surfaces', () => {
    expect(source).toContain('REDEVEN_WORKBENCH_WHEEL_LAYOUT_ONLY_PROPS');
    expect(source).toContain('{...REDEVEN_WORKBENCH_WHEEL_LAYOUT_ONLY_PROPS}');
  });
});

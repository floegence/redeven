import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const uiRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)));

describe('Env App Flower ownership', () => {
  it('keeps one retained EnvAIPage and lets Workbench provide only a host', () => {
    const shell = fs.readFileSync(path.join(uiRoot, 'EnvAppShell.tsx'), 'utf8');
    const widgets = fs.readFileSync(path.join(uiRoot, 'workbench', 'redevenWorkbenchWidgets.tsx'), 'utf8');

    expect(shell.match(/<EnvAIPage/g)).toHaveLength(1);
    expect(shell).toContain("flowerProductPlacement() === 'workbench'");
    expect(shell).toContain('setFlowerWorkbenchHost,');
    expect(widgets).not.toContain("import('../pages/EnvAIPage')");
    expect(widgets).not.toContain('<EnvAIPage');
    expect(widgets).toContain('data-flower-workbench-host');
    expect(widgets).toContain('env.setFlowerWorkbenchHost?.(host(), engaged())');
  });
});

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { afterEach, describe, expect, it } from 'vitest';

const scriptPath = path.join(process.cwd(), 'scripts/checkWorkbenchWheelContract.mjs');
const tempRoots = [];

function createFixtureRoot(source) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'redeven-wheel-contract-'));
  tempRoots.push(root);

  const widgetsDir = path.join(root, 'ui', 'widgets');
  fs.mkdirSync(widgetsDir, { recursive: true });
  fs.writeFileSync(path.join(widgetsDir, 'FixtureWidget.tsx'), source, 'utf8');
  return root;
}

function runCheck(srcRoot) {
  return spawnSync(process.execPath, [scriptPath], {
    encoding: 'utf8',
    env: {
      ...process.env,
      REDEVEN_WORKBENCH_WHEEL_CONTRACT_SRC_ROOT: srcRoot,
    },
  });
}

describe('checkWorkbenchWheelContract', () => {
  afterEach(() => {
    for (const root of tempRoots.splice(0)) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it('rejects bounded Workbench scroll candidates without an explicit wheel contract', () => {
    const srcRoot = createFixtureRoot(`
      export function FixtureWidget() {
        return <div class="flex-1 min-h-0 overflow-auto" />;
      }
    `);

    const result = runCheck(srcRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('bounded scroll viewport candidate');
  });

  it('accepts bounded Workbench scroll candidates with local viewport props', () => {
    const srcRoot = createFixtureRoot(`
      import { REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS } from '../workbench/surface/workbenchWheelInteractive';

      export function FixtureWidget() {
        return <div {...REDEVEN_WORKBENCH_LOCAL_SCROLL_VIEWPORT_PROPS} class="flex-1 min-h-0 overflow-auto" />;
      }
    `);

    const result = runCheck(srcRoot);

    expect(result.status).toBe(0);
    expect(result.stdout).toContain('Workbench wheel contract check passed.');
  });

  it('rejects known transcript scroll regions even when overflow is CSS-owned', () => {
    const srcRoot = createFixtureRoot(`
      export function FixtureWidget() {
        return <div class="flower-chat-transcript-main" />;
      }
    `);

    const result = runCheck(srcRoot);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('known Workbench scroll viewport');
  });
});

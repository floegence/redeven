import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = path.resolve(import.meta.dirname, '../../../..');

describe('Flower composer draft host ownership', () => {
  it('requires host-owned coordinators and injects one from each product shell', () => {
    const surface = fs.readFileSync(path.join(repoRoot, 'internal/flower_ui/src/FlowerSurface.tsx'), 'utf8');
    const envShell = fs.readFileSync(path.join(repoRoot, 'internal/envapp/ui_src/src/ui/EnvAppShell.tsx'), 'utf8');
    const envPage = fs.readFileSync(path.join(repoRoot, 'internal/envapp/ui_src/src/ui/pages/EnvAIPage.tsx'), 'utf8');
    const workbench = fs.readFileSync(path.join(repoRoot, 'internal/envapp/ui_src/src/ui/workbench/redevenWorkbenchWidgets.tsx'), 'utf8');
    const desktop = fs.readFileSync(path.join(repoRoot, 'desktop/src/welcome/App.tsx'), 'utf8');

    expect(surface).toContain('draftCoordinator: FlowerComposerDraftCoordinator;');
    expect(surface).not.toContain('props.draftCoordinator ?? createFlowerComposerDraftCoordinator()');
    expect(envShell).toContain('const flowerDraftCoordinator = createFlowerComposerDraftCoordinator();');
    expect(envShell).toContain('onCleanup(() => flowerDraftCoordinator.dispose())');
    expect(envPage).toContain('draftCoordinator={props.draftCoordinator}');
    expect(workbench).toContain('draftCoordinator={env.flowerDraftCoordinator!}');
    expect(desktop).toContain('draftCoordinator={flowerDraftCoordinator}');
    expect(desktop).toContain('const flowerDraftCoordinator = createFlowerComposerDraftCoordinator();');
    expect(desktop).toContain('onCleanup(() => flowerDraftCoordinator.dispose())');
    expect(surface).not.toContain('surfaceInstanceID');
    expect(surface).not.toMatch(/draftLease|takeOver|draftUnavailable|draftUnsaved/i);
  });
});

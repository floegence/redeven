import { describe, expect, it } from 'vitest';
import { buildFlowerTurnLauncherCopy } from './flowerTurnLauncherCopy';
import type { FlowerTurnLauncherSourceSurface } from './contracts/flowerSurfaceContracts';

const sources: FlowerTurnLauncherSourceSurface[] = ['desktop_welcome_environment_card', 'file_browser', 'terminal', 'file_preview', 'monitoring', 'container_services', 'git_browser', 'editor_preview', 'tessiven'];

describe('contextual launcher copy', () => {
  it.each(sources)('projects actual references without introductory copy for %s', source_surface => {
    const intent = { id: 'copy-test', source_surface, initial_prompt: 'Keep this user request',
      context_items: [{ kind: 'file_path' as const, path: '/workspace/main.ts', is_directory: false }], notes: [] };
    const result = buildFlowerTurnLauncherCopy(intent);
    expect(Object.keys(result)).toEqual(['context_entries']);
    expect(result.context_entries).toEqual([expect.objectContaining({ label: 'main.ts', tone: 'file' })]);
    expect(intent.initial_prompt).toBe('Keep this user request');
  });
});

import { describe, expect, it, vi } from 'vitest';
import { createFlowerPageContextRegistry, flowerPageContextSnapshot } from './flowerPageContext';

describe('Activity page context snapshots', () => {
  it('reads only the actual requested page and freezes its current state', () => {
    const registry = createFlowerPageContextRegistry();
    const monitor = vi.fn(() => ({ sort: 'cpu', selected_process: { pid: 42, name: 'worker' } }));
    const files = vi.fn(() => ({ directory: '/workspace', selected_paths: ['/workspace/main.ts'] }));
    registry.register('monitor', monitor);
    const removeFiles = registry.register('files', files);
    const snapshot = flowerPageContextSnapshot({ environmentID: 'env-test', environmentName: 'Development',
      pageID: 'files', pageName: 'Files', capturedAtMs: 1, state: registry.read('files') });
    expect(monitor).not.toHaveBeenCalled();
    expect(files).toHaveBeenCalledTimes(1);
    expect(JSON.parse(snapshot.content)).toEqual({ environment: { id: 'env-test', name: 'Development' },
      page: { id: 'files', name: 'Files' }, captured_at: '1970-01-01T00:00:00.001Z',
      state: { directory: '/workspace', selected_paths: ['/workspace/main.ts'] } });
    removeFiles();
    expect(registry.read('files')).toBeUndefined();
    expect(snapshot.content).toContain('/workspace/main.ts');
  });

  it('keeps a newer mounted page reader when an older instance retires', () => {
    const registry = createFlowerPageContextRegistry();
    const removeOld = registry.register('files', () => ({ directory: '/old' }));
    registry.register('files', () => ({ directory: '/new' }));
    removeOld();
    expect(registry.read('files')).toEqual({ directory: '/new' });
  });

  it('bounds automatic metadata before draft capture without splitting Unicode', () => {
    const snapshot = flowerPageContextSnapshot({ environmentID: 'env', environmentName: 'Development', pageID: 'files',
      pageName: 'Files', capturedAtMs: 1, state: { query: '🪷'.repeat(9000) } });
    expect(Array.from(snapshot.content)).toHaveLength(6000);
    expect(snapshot.content.endsWith('…')).toBe(true);
    expect(snapshot.content).not.toMatch(/[\uD800-\uDBFF]$/u);
  });

  it('bounds long terminal screens while preserving page identity, valid JSON and the latest visible lines', () => {
    const screen = `${'quoted "path" 🪷\n'.repeat(1000)}$ latest prompt`;
    const snapshot = flowerPageContextSnapshot({ environmentID: 'env', environmentName: 'Development',
      pageID: 'terminal', pageName: 'Terminal', capturedAtMs: 1,
      state: { session: { id: 'session-1', working_directory: '/workspace' }, screen_text: screen } });
    expect(Array.from(snapshot.content).length).toBeLessThanOrEqual(6000);
    const captured = JSON.parse(snapshot.content);
    expect(captured.page.id).toBe('terminal');
    expect(captured.state.session.id).toBe('session-1');
    expect(captured.state.screen_text.startsWith('...')).toBe(true);
    expect(captured.state.screen_text.endsWith('$ latest prompt')).toBe(true);
    expect(captured.state.screen_text).not.toMatch(/^\.\.\.[\uDC00-\uDFFF]/u);
  });
});

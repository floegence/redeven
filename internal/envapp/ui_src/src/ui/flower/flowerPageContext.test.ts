import { describe, expect, it } from 'vitest';
import { flowerPageContextSnapshot } from './flowerPageContext';

describe('Activity page context snapshots', () => {
  it('bounds automatic metadata before draft capture without splitting Unicode', () => {
    const snapshot = flowerPageContextSnapshot({ environmentID: 'env', environmentName: 'Development', pageID: 'files',
      pageName: 'Files', capturedAtMs: 1, state: { query: '🪷'.repeat(9000) } });
    expect(Array.from(snapshot.content).length).toBeLessThanOrEqual(6000);
    expect(snapshot.content.endsWith('\n…')).toBe(true);
    expect(snapshot.content).not.toMatch(/[\uD800-\uDBFF]$/u);
  });

  it('bounds long terminal screens while preserving page identity and the latest visible lines', () => {
    const screen = `${'quoted "path" 🪷\n'.repeat(1000)}$ latest prompt`;
    const snapshot = flowerPageContextSnapshot({ environmentID: 'env', environmentName: 'Development',
      pageID: 'terminal', pageName: 'Terminal', capturedAtMs: 1,
      state: { session: { id: 'session-1', working_directory: '/workspace' }, screen_text: screen } });
    expect(Array.from(snapshot.content).length).toBeLessThanOrEqual(6000);
    expect(snapshot.content).toContain('Terminal (terminal)');
    expect(snapshot.content).toContain('session.id: session-1');
    expect(snapshot.content).toContain('screen_text:\n…\n');
    expect(snapshot.content.endsWith('$ latest prompt')).toBe(true);
    expect(snapshot.content).not.toMatch(/…\n[\uDC00-\uDFFF]/u);
  });
});

import { describe, expect, it } from 'vitest';
import { collectTerminalLinkTargets } from './terminalLinkProvider';

describe('terminal semantic text link detection', () => {
  it('resolves absolute and relative file references without a browser VT dependency', () => {
    expect(collectTerminalLinkTargets(
      'panic at /workspace/app/server.ts:18:4',
      { workingDirAbs: '/workspace' },
    )).toEqual([{
      rawText: '/workspace/app/server.ts:18:4',
      resolvedPath: '/workspace/app/server.ts',
      line: 18,
      column: 4,
    }]);

    expect(collectTerminalLinkTargets(
      'src/handlers/user.go:91 failed validation',
      { workingDirAbs: '/workspace/repo' },
    )).toEqual([{
      rawText: 'src/handlers/user.go:91',
      resolvedPath: '/workspace/repo/src/handlers/user.go',
      line: 91,
    }]);
  });

  it('expands home-relative paths with view metadata', () => {
    expect(collectTerminalLinkTargets(
      'open ~/.config/redeven/settings.json:7',
      { workingDirAbs: '/workspace/repo', agentHomePathAbs: '/Users/tester' },
    )).toEqual([{
      rawText: '~/.config/redeven/settings.json:7',
      resolvedPath: '/Users/tester/.config/redeven/settings.json',
      line: 7,
    }]);
  });

  it.each([
    'https://example.com/docs/index.html',
    'v1.2.3',
    'open(src/handlers/user.go)',
    'src/**/*.ts',
    'src/index.ts;rm',
    'total/count',
  ])('rejects non-path token %s', (lineText) => {
    expect(collectTerminalLinkTargets(lineText, { workingDirAbs: '/workspace/repo' })).toEqual([]);
  });
});

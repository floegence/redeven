import { describe, expect, it } from 'vitest';
import { collectTerminalLinkTargets } from './terminalLinkProvider';

describe('terminalLinkProvider', () => {
  it('resolves absolute file references with line and column information', () => {
    const targets = collectTerminalLinkTargets(
      'panic at /workspace/app/server.ts:18:4 while booting',
      { workingDirAbs: '/workspace' },
    );

    expect(targets).toEqual([
      {
        rawText: '/workspace/app/server.ts:18:4',
        resolvedPath: '/workspace/app/server.ts',
        line: 18,
        column: 4,
      },
    ]);
  });

  it('resolves relative file references against the terminal working directory', () => {
    const targets = collectTerminalLinkTargets(
      'src/handlers/user.go:91 failed validation',
      { workingDirAbs: '/workspace/repo' },
    );

    expect(targets).toEqual([
      {
        rawText: 'src/handlers/user.go:91',
        resolvedPath: '/workspace/repo/src/handlers/user.go',
        line: 91,
      },
    ]);
  });

  it('expands home-relative paths with the runtime home directory context', () => {
    const targets = collectTerminalLinkTargets(
      'open ~/.config/redeven/settings.json:7 to continue',
      { workingDirAbs: '/workspace/repo', agentHomePathAbs: '/Users/tester' },
    );

    expect(targets).toEqual([
      {
        rawText: '~/.config/redeven/settings.json:7',
        resolvedPath: '/Users/tester/.config/redeven/settings.json',
        line: 7,
      },
    ]);
  });

  it('stays conservative around URLs, semver text, and bare filenames without line numbers', () => {
    const targets = collectTerminalLinkTargets(
      'See https://example.com, upgrade to v1.2.3, or inspect README.md later.',
      { workingDirAbs: '/workspace/repo' },
    );

    expect(targets).toEqual([]);
  });
});

import { describe, expect, it, vi } from 'vitest';
import { collectTerminalLinkTargets, createTerminalFileLinkProvider } from './terminalLinkProvider';

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

  it.each([
    "c=re.sub(r'<script.*?</script>','',c,flags=re.S)",
    "c=re.sub(r'<style.*?</style>','',c,flags=re.S)",
    '2>/dev/null',
    "re.compile(r'/api/.+?/users')",
    '</script>',
    'src/**/*.ts',
    'total/count',
    'https://example.com/docs/index.html',
    'v1.2.3',
    'open(src/handlers/user.go)',
    'paths={src/index.ts,src/main.ts}',
    'src/index.ts;rm',
    'src/index.ts:line',
  ])('rejects non-path code token %s', (lineText) => {
    expect(collectTerminalLinkTargets(lineText, { workingDirAbs: '/workspace/repo' })).toEqual([]);
  });

  it.each([
    {
      lineText: '/var/log/redeven/runtime',
      expected: { rawText: '/var/log/redeven/runtime', resolvedPath: '/var/log/redeven/runtime' },
    },
    {
      lineText: '~/notes/today.md:12:3',
      expected: {
        rawText: '~/notes/today.md:12:3',
        resolvedPath: '/Users/tester/notes/today.md',
        line: 12,
        column: 3,
      },
    },
    {
      lineText: './scripts/check',
      expected: { rawText: './scripts/check', resolvedPath: '/workspace/repo/scripts/check' },
    },
    {
      lineText: '../shared/config',
      expected: { rawText: '../shared/config', resolvedPath: '/workspace/shared/config' },
    },
    {
      lineText: 'src/handlers/user.go:91',
      expected: {
        rawText: 'src/handlers/user.go:91',
        resolvedPath: '/workspace/repo/src/handlers/user.go',
        line: 91,
      },
    },
    {
      lineText: 'config/.env',
      expected: { rawText: 'config/.env', resolvedPath: '/workspace/repo/config/.env' },
    },
    {
      lineText: 'build/Makefile',
      expected: { rawText: 'build/Makefile', resolvedPath: '/workspace/repo/build/Makefile' },
    },
    {
      lineText: '"src/main.ts:8"',
      expected: { rawText: 'src/main.ts:8', resolvedPath: '/workspace/repo/src/main.ts', line: 8 },
    },
    {
      lineText: '(../shared/types.ts:4:2)',
      expected: {
        rawText: '../shared/types.ts:4:2',
        resolvedPath: '/workspace/shared/types.ts',
        line: 4,
        column: 2,
      },
    },
  ])('accepts file path $lineText', ({ lineText, expected }) => {
    expect(collectTerminalLinkTargets(lineText, {
      workingDirAbs: '/workspace/repo',
      agentHomePathAbs: '/Users/tester',
    })).toEqual([expected]);
  });

  it('decorates only the path text and activates it only with a modifier click', async () => {
    const onActivate = vi.fn();
    const core = {
      readBufferLine: () => 'error at "src/main.ts:8" now',
    } as any;
    const provider = createTerminalFileLinkProvider({
      core,
      getContext: () => ({ workingDirAbs: '/workspace/repo' }),
      onActivate,
    });

    const links = await new Promise<any[]>((resolve) => {
      provider.provideLinks(1, (value) => resolve(value ?? []));
    });

    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({
      text: 'src/main.ts:8',
      range: {
        start: { x: 11, y: 1 },
        end: { x: 23, y: 1 },
      },
    });

    const plainClick = {
      metaKey: false,
      ctrlKey: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as MouseEvent;
    links[0].activate(plainClick);
    expect(onActivate).not.toHaveBeenCalled();

    const modifierClick = {
      metaKey: true,
      ctrlKey: false,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as MouseEvent;
    links[0].activate(modifierClick);
    expect(modifierClick.preventDefault).toHaveBeenCalledOnce();
    expect(modifierClick.stopPropagation).toHaveBeenCalledOnce();
    expect(onActivate).toHaveBeenCalledWith(
      {
        rawText: 'src/main.ts:8',
        resolvedPath: '/workspace/repo/src/main.ts',
        line: 8,
      },
      modifierClick,
    );
  });

  it('returns no links when hover scanning races with terminal disposal', async () => {
    const provider = createTerminalFileLinkProvider({
      core: {
        terminal: {
          buffer: {
            active: {
              getLine: () => {
                throw new TypeError("Cannot read properties of undefined (reading 'getWasmTerm')");
              },
            },
          },
        },
      } as any,
      getContext: () => ({ workingDirAbs: '/workspace/repo' }),
      onActivate: () => undefined,
    });

    const links = await new Promise<unknown>((resolve) => {
      provider.provideLinks(1, resolve);
    });

    expect(links).toBeUndefined();
  });
});

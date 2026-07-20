import { describe, expect, it } from 'vitest';

import { TerminalShellIntegrationParser } from './terminalShellIntegration';

const encoder = new TextEncoder();

describe('TerminalShellIntegrationParser', () => {
  it('strips recognized OSC 633 command markers from display output', () => {
    const parser = new TerminalShellIntegrationParser();
    const input = encoder.encode('hello\x1b]633;B\u0007world\x1b]633;D;0\u0007done');

    const result = parser.parse(input);

    expect(decode(result.displayData)).toBe('helloworlddone');
    expect(result.events).toEqual([
      { kind: 'command-start' },
      { kind: 'command-finish', exitCode: 0 },
    ]);
  });

  it('supports OSC 133 markers terminated with ST', () => {
    const parser = new TerminalShellIntegrationParser();
    const input = encoder.encode('\x1b]133;A\x1b\\prompt\x1b]133;D;1\x1b\\');

    const result = parser.parse(input);

    expect(decode(result.displayData)).toBe('prompt');
    expect(result.events).toEqual([
      { kind: 'prompt-ready' },
      { kind: 'command-finish', exitCode: 1 },
    ]);
  });

  it('handles fragmented marker chunks without leaking control bytes', () => {
    const parser = new TerminalShellIntegrationParser();

    const first = parser.parse(encoder.encode('left\x1b]633;'));
    const second = parser.parse(encoder.encode('B\u0007right'));

    expect(decode(first.displayData)).toBe('left');
    expect(first.events).toEqual([]);
    expect(decode(second.displayData)).toBe('right');
    expect(second.events).toEqual([{ kind: 'command-start' }]);
  });

  it('parses cwd markers without leaking them to the terminal renderer', () => {
    const parser = new TerminalShellIntegrationParser();
    const input = encoder.encode('x\x1b]633;P;Cwd=/workspace\u0007y');

    const result = parser.parse(input);

    expect(decode(result.displayData)).toBe('xy');
    expect(result.events).toEqual([{ kind: 'cwd-update', workingDir: '/workspace' }]);
  });

  it('keeps unrelated OSC sequences intact for the terminal renderer', () => {
    const parser = new TerminalShellIntegrationParser();
    const input = encoder.encode('x\x1b]633;P;Editor=ghostty\u0007y');

    const result = parser.parse(input);

    expect(decode(result.displayData)).toBe('x\x1b]633;P;Editor=ghostty\u0007y');
    expect(result.events).toEqual([]);
  });

  it('parses optional explicit program activity markers without leaking them to display output', () => {
    const parser = new TerminalShellIntegrationParser();
    const input = encoder.encode('x\x1b]633;P;RedevenActivity=busy\u0007y\x1b]633;P;RedevenActivity=idle\u0007z');

    const result = parser.parse(input);

    expect(decode(result.displayData)).toBe('xyz');
    expect(result.events).toEqual([
      { kind: 'program-activity', phase: 'busy' },
      { kind: 'program-activity', phase: 'idle' },
    ]);
  });

  it('preserves upstream and Redeven activity event order within one chunk', () => {
    const parser = new TerminalShellIntegrationParser();
    const result = parser.parse(encoder.encode(
      '\x1b]633;B\u0007\x1b]633;P;RedevenActivity=busy\u0007\x1b]633;D;0\u0007',
    ));

    expect(result.displayData).toHaveLength(0);
    expect(result.events).toEqual([
      { kind: 'command-start' },
      { kind: 'program-activity', phase: 'busy' },
      { kind: 'command-finish', exitCode: 0 },
    ]);
  });

  it('preserves ordered local and upstream events when the OSC introducer is split', () => {
    const parser = new TerminalShellIntegrationParser();
    const first = parser.parse(encoder.encode('left\x1b'));
    const second = parser.parse(encoder.encode(
      ']633;P;RedevenActivity=busy\u0007\x1b]633;D\u0007right',
    ));

    expect(decode(first.displayData)).toBe('left');
    expect(first.events).toEqual([]);
    expect(decode(second.displayData)).toBe('right');
    expect(second.events).toEqual([
      { kind: 'program-activity', phase: 'busy' },
      { kind: 'command-finish', exitCode: null },
    ]);
  });

  it('accepts command-finish markers without an exit code payload', () => {
    const parser = new TerminalShellIntegrationParser();
    const input = encoder.encode('\x1b]633;D\u0007');

    const result = parser.parse(input);

    expect(result.events).toEqual([{ kind: 'command-finish', exitCode: null }]);
  });

  it('uses the upstream parser for program and command-executed markers without leaking them', () => {
    const parser = new TerminalShellIntegrationParser();
    const result = parser.parse(encoder.encode(
      'x\x1b]633;P;FloetermProgram=top\u0007\x1b]633;C\u0007y',
    ));

    expect(decode(result.displayData)).toBe('xy');
    expect(result.events).toEqual([
      { kind: 'program', displayName: 'top' },
      { kind: 'command-executed' },
    ]);
  });
});

function decode(data: Uint8Array): string {
  return new TextDecoder().decode(data);
}

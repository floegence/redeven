import { describe, expect, it } from 'vitest';

import { tokenizeFlowerShellCommand } from './shellCommandHighlight';

describe('tokenizeFlowerShellCommand', () => {
  it('preserves command text while classifying common shell tokens', () => {
    const command = 'curl -s "wttr.in/Changsha?format=%C+%t+%h+%w&lang=zh" 2>&1 || echo "$HOME"';
    const tokens = tokenizeFlowerShellCommand(command);

    expect(tokens.map((token) => token.text).join('')).toBe(command);
    expect(tokens).toContainEqual({ kind: 'command', text: 'curl' });
    expect(tokens).toContainEqual({ kind: 'flag', text: '-s' });
    expect(tokens).toContainEqual({ kind: 'string', text: '"wttr.in/Changsha?format=%C+%t+%h+%w&lang=zh"' });
    expect(tokens).toContainEqual({ kind: 'operator', text: '2>&1' });
    expect(tokens).toContainEqual({ kind: 'operator', text: '||' });
    expect(tokens).toContainEqual({ kind: 'command', text: 'echo' });
    expect(tokens).toContainEqual({ kind: 'string', text: '"$HOME"' });
  });

  it('classifies URLs, variables, and pipeline command boundaries without dropping spaces', () => {
    const command = 'TOKEN=${TOKEN:-demo} curl https://example.test/a?b=1 | grep "$TOKEN"';
    const tokens = tokenizeFlowerShellCommand(command);

    expect(tokens.map((token) => token.text).join('')).toBe(command);
    expect(tokens).toContainEqual({ kind: 'text', text: 'TOKEN=' });
    expect(tokens).toContainEqual({ kind: 'variable', text: '${TOKEN:-demo}' });
    expect(tokens).toContainEqual({ kind: 'command', text: 'curl' });
    expect(tokens).toContainEqual({ kind: 'url', text: 'https://example.test/a?b=1' });
    expect(tokens).toContainEqual({ kind: 'operator', text: '|' });
    expect(tokens).toContainEqual({ kind: 'command', text: 'grep' });
    expect(tokens).toContainEqual({ kind: 'string', text: '"$TOKEN"' });
  });
});

import { describe, expect, it } from 'vitest';

import {
  TERMINAL_AGENT_CLI_PRESENTATIONS,
  deriveTerminalAgentSessionPresentation,
} from './terminalAgentSessionPresentation';

describe('terminal agent session presentation', () => {
  it('keeps every released classifier identity paired with an audited local icon', () => {
    expect(Object.keys(TERMINAL_AGENT_CLI_PRESENTATIONS)).toEqual([
      'codex',
      'claude',
      'opencode',
      'kimi',
      'gemini',
      'qwen',
      'copilot',
      'cline',
      'roo',
      'vibe',
      'cursor',
      'junie',
      'kiro',
      'openhands',
      'trae',
      'kilo',
    ]);

    for (const presentation of Object.values(TERMINAL_AGENT_CLI_PRESENTATIONS)) {
      expect(presentation.iconPath).toMatch(/^\/agent-cli-icons\/[a-z-]+\.svg$/);
      expect(presentation.label.length).toBeGreaterThan(0);
      expect(Boolean(presentation.lightIconPath)).toBe(Boolean(presentation.darkIconPath));
    }
  });

  it('projects output activity only for a confirmed running agent CLI', () => {
    expect(deriveTerminalAgentSessionPresentation('codex', 'streaming')).toMatchObject({
      identity: 'codex',
      outputState: 'streaming',
    });
    expect(deriveTerminalAgentSessionPresentation('claude', 'settled')).toMatchObject({
      identity: 'claude',
      outputState: 'settled',
    });
    expect(deriveTerminalAgentSessionPresentation('top', 'streaming')).toEqual({
      identity: null,
      outputState: 'none',
    });
    expect(deriveTerminalAgentSessionPresentation('goose', 'streaming')).toEqual({
      identity: null,
      outputState: 'none',
    });
    expect(deriveTerminalAgentSessionPresentation('', 'settled')).toEqual({
      identity: null,
      outputState: 'none',
    });
  });

  it('does not turn unknown output metadata into a completion claim', () => {
    expect(deriveTerminalAgentSessionPresentation('opencode', 'unknown')).toMatchObject({
      identity: 'opencode',
      outputState: 'none',
    });
  });
});

import {
  classifyTerminalAgentCli,
  type TerminalAgentCliIdentity,
  type TerminalOutputActivityPhase,
} from '@floegence/floeterm-terminal-web/sessions';

export type TerminalSessionOutputState = 'none' | 'streaming' | 'settled';

export type TerminalAgentCliPresentation = Readonly<{
  label: string;
  iconPath: string;
  lightIconPath?: string;
  darkIconPath?: string;
  render: 'image' | 'mask';
}>;

export const TERMINAL_AGENT_CLI_PRESENTATIONS: Readonly<Record<TerminalAgentCliIdentity, TerminalAgentCliPresentation>> = Object.freeze({
  codex: { label: 'Codex', iconPath: '/agent-cli-icons/codex.svg', render: 'mask' },
  claude: { label: 'Claude Code', iconPath: '/agent-cli-icons/claude.svg', render: 'image' },
  opencode: { label: 'OpenCode', iconPath: '/agent-cli-icons/opencode.svg', render: 'mask' },
  kimi: { label: 'Kimi Code', iconPath: '/agent-cli-icons/kimi.svg', render: 'image' },
  gemini: { label: 'Gemini CLI', iconPath: '/agent-cli-icons/gemini.svg', render: 'image' },
  qwen: { label: 'Qwen Code', iconPath: '/agent-cli-icons/qwen.svg', render: 'mask' },
  copilot: {
    label: 'GitHub Copilot CLI',
    iconPath: '/agent-cli-icons/copilot.svg',
    lightIconPath: '/agent-cli-icons/copilot-light.svg',
    darkIconPath: '/agent-cli-icons/copilot-dark.svg',
    render: 'image',
  },
  cline: { label: 'Cline', iconPath: '/agent-cli-icons/cline.svg', render: 'mask' },
  roo: { label: 'Roo Code', iconPath: '/agent-cli-icons/roo.svg', render: 'mask' },
  vibe: { label: 'Mistral Vibe', iconPath: '/agent-cli-icons/vibe.svg', render: 'image' },
  cursor: {
    label: 'Cursor Agent',
    iconPath: '/agent-cli-icons/cursor.svg',
    lightIconPath: '/agent-cli-icons/cursor-light.svg',
    darkIconPath: '/agent-cli-icons/cursor-dark.svg',
    render: 'image',
  },
  junie: { label: 'Junie CLI', iconPath: '/agent-cli-icons/junie.svg', render: 'image' },
  kiro: { label: 'Kiro CLI', iconPath: '/agent-cli-icons/kiro.svg', render: 'image' },
  openhands: { label: 'OpenHands', iconPath: '/agent-cli-icons/openhands.svg', render: 'mask' },
  trae: { label: 'TRAE Agent', iconPath: '/agent-cli-icons/trae.svg', render: 'image' },
  kilo: {
    label: 'Kilo Code',
    iconPath: '/agent-cli-icons/kilo.svg',
    lightIconPath: '/agent-cli-icons/kilo-light.svg',
    darkIconPath: '/agent-cli-icons/kilo-dark.svg',
    render: 'image',
  },
});

export function deriveTerminalAgentSessionPresentation(
  foregroundDisplayName: unknown,
  outputPhase: TerminalOutputActivityPhase | null | undefined,
): Readonly<{
  identity: TerminalAgentCliIdentity | null;
  outputState: TerminalSessionOutputState;
}> {
  const identity = classifyTerminalAgentCli(foregroundDisplayName);
  if (!identity) return { identity: null, outputState: 'none' };
  return {
    identity,
    outputState: outputPhase === 'streaming' || outputPhase === 'settled' ? outputPhase : 'none',
  };
}

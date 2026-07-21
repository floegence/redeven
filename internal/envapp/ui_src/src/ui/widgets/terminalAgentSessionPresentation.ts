import {
  classifyTerminalAgentCli,
  type TerminalAgentCliIdentity,
  type TerminalOutputActivityPhase,
} from '@floegence/floeterm-terminal-web/sessions';
import { REDEVEN_ENV_APP_BASE_PATH } from '../../build/envAppBasePath';

export type TerminalSessionOutputState = 'none' | 'streaming' | 'settled';

export type TerminalAgentCliPresentation = Readonly<{
  label: string;
  iconPath: string;
  lightIconPath?: string;
  darkIconPath?: string;
  render: 'image' | 'mask';
}>;

const terminalAgentIconBasePath = `${REDEVEN_ENV_APP_BASE_PATH}agent-cli-icons/`;

function terminalAgentIconPath(fileName: string): string {
  return `${terminalAgentIconBasePath}${fileName}`;
}

export const TERMINAL_AGENT_CLI_PRESENTATIONS: Readonly<Record<TerminalAgentCliIdentity, TerminalAgentCliPresentation>> = Object.freeze({
  codex: { label: 'Codex', iconPath: terminalAgentIconPath('codex.svg'), render: 'mask' },
  claude: { label: 'Claude Code', iconPath: terminalAgentIconPath('claude.svg'), render: 'image' },
  opencode: { label: 'OpenCode', iconPath: terminalAgentIconPath('opencode.svg'), render: 'mask' },
  kimi: { label: 'Kimi Code', iconPath: terminalAgentIconPath('kimi.svg'), render: 'image' },
  gemini: { label: 'Gemini CLI', iconPath: terminalAgentIconPath('gemini.svg'), render: 'image' },
  qwen: { label: 'Qwen Code', iconPath: terminalAgentIconPath('qwen.svg'), render: 'mask' },
  copilot: {
    label: 'GitHub Copilot CLI',
    iconPath: terminalAgentIconPath('copilot.svg'),
    lightIconPath: terminalAgentIconPath('copilot-light.svg'),
    darkIconPath: terminalAgentIconPath('copilot-dark.svg'),
    render: 'image',
  },
  cline: { label: 'Cline', iconPath: terminalAgentIconPath('cline.svg'), render: 'mask' },
  roo: { label: 'Roo Code', iconPath: terminalAgentIconPath('roo.svg'), render: 'mask' },
  vibe: { label: 'Mistral Vibe', iconPath: terminalAgentIconPath('vibe.svg'), render: 'image' },
  cursor: {
    label: 'Cursor Agent',
    iconPath: terminalAgentIconPath('cursor.svg'),
    lightIconPath: terminalAgentIconPath('cursor-light.svg'),
    darkIconPath: terminalAgentIconPath('cursor-dark.svg'),
    render: 'image',
  },
  junie: { label: 'Junie CLI', iconPath: terminalAgentIconPath('junie.svg'), render: 'image' },
  kiro: { label: 'Kiro CLI', iconPath: terminalAgentIconPath('kiro.svg'), render: 'image' },
  openhands: { label: 'OpenHands', iconPath: terminalAgentIconPath('openhands.svg'), render: 'mask' },
  trae: { label: 'TRAE Agent', iconPath: terminalAgentIconPath('trae.svg'), render: 'image' },
  kilo: {
    label: 'Kilo Code',
    iconPath: terminalAgentIconPath('kilo.svg'),
    lightIconPath: terminalAgentIconPath('kilo-light.svg'),
    darkIconPath: terminalAgentIconPath('kilo-dark.svg'),
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

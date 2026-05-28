import type { CodexComposerControlID } from './composerControls';
import type { I18nHelpers } from '../i18n';

export type CodexSlashCommandID =
  | 'mention'
  | 'new'
  | 'clear'
  | 'cwd'
  | 'model'
  | 'effort'
  | 'approval'
  | 'sandbox';

export type CodexSlashCommandAction =
  | 'insert-mention-trigger'
  | 'start-new-thread'
  | 'clear-composer'
  | 'open-working-dir-picker';

export type CodexSlashCommandKind = 'immediate' | 'parameter';

export type CodexSlashCommandContext = Readonly<{
  hostAvailable: boolean;
  workingDirEditable: boolean;
}>;

export type CodexSlashCommandSpec = Readonly<{
  id: CodexSlashCommandID;
  command: string;
  title: string;
  description: string;
  kind: CodexSlashCommandKind;
  action?: CodexSlashCommandAction;
  parameter_target?: CodexComposerControlID;
  aliases?: readonly string[];
  requires_host?: boolean;
  requires_working_dir_editable?: boolean;
}>;

const CODEX_SLASH_COMMANDS: readonly CodexSlashCommandSpec[] = [
  {
    id: 'mention',
    command: 'mention',
    title: '/mention',
    description: 'Insert @ and open the file reference picker.',
    kind: 'immediate',
    action: 'insert-mention-trigger',
  },
  {
    id: 'new',
    command: 'new',
    title: '/new',
    description: 'Start a fresh Codex thread draft.',
    kind: 'immediate',
    action: 'start-new-thread',
    requires_host: true,
  },
  {
    id: 'clear',
    command: 'clear',
    title: '/clear',
    description: 'Clear the current composer text, attachments, and file references.',
    kind: 'immediate',
    action: 'clear-composer',
  },
  {
    id: 'cwd',
    command: 'cwd',
    title: '/cwd',
    description: 'Open the working directory picker for a new chat.',
    kind: 'immediate',
    action: 'open-working-dir-picker',
    aliases: ['workdir'],
    requires_working_dir_editable: true,
  },
  {
    id: 'model',
    command: 'model',
    title: '/model',
    description: 'Choose the model for the next Codex turn.',
    kind: 'parameter',
    parameter_target: 'model',
    requires_host: true,
  },
  {
    id: 'effort',
    command: 'effort',
    title: '/effort',
    description: 'Choose the reasoning effort for the next Codex turn.',
    kind: 'parameter',
    parameter_target: 'effort',
    requires_host: true,
  },
  {
    id: 'approval',
    command: 'approval',
    title: '/approval',
    description: 'Choose the approval policy for the next Codex turn.',
    kind: 'parameter',
    parameter_target: 'approval',
    aliases: ['permissions'],
    requires_host: true,
  },
  {
    id: 'sandbox',
    command: 'sandbox',
    title: '/sandbox',
    description: 'Choose the sandbox mode for the next Codex turn.',
    kind: 'parameter',
    parameter_target: 'sandbox',
    requires_host: true,
  },
] as const;

function commandAvailabilityMatches(
  command: CodexSlashCommandSpec,
  context: CodexSlashCommandContext,
): boolean {
  if (command.requires_host && !context.hostAvailable) return false;
  if (command.requires_working_dir_editable && !context.workingDirEditable) return false;
  return true;
}

function commandScore(command: CodexSlashCommandSpec, normalizedQuery: string): number {
  if (!normalizedQuery) return 1;
  const names = [command.command, ...(command.aliases ?? [])].map((entry) => entry.toLowerCase());
  if (names.includes(normalizedQuery)) return 400;
  if (names.some((entry) => entry.startsWith(normalizedQuery))) return 300;
  if (names.some((entry) => entry.includes(normalizedQuery))) return 200;
  if (command.description.toLowerCase().includes(normalizedQuery)) return 100;
  return -1;
}

export function codexSlashCommands(): readonly CodexSlashCommandSpec[] {
  return CODEX_SLASH_COMMANDS;
}

export function localizedCodexSlashCommandDescription(
  command: Pick<CodexSlashCommandSpec, 'id' | 'description'>,
  t: I18nHelpers['t'],
): string {
  switch (command.id) {
    case 'mention':
      return t('codex.composer.slashDescriptions.mention');
    case 'new':
      return t('codex.composer.slashDescriptions.new');
    case 'clear':
      return t('codex.composer.slashDescriptions.clear');
    case 'cwd':
      return t('codex.composer.slashDescriptions.cwd');
    case 'model':
      return t('codex.composer.slashDescriptions.model');
    case 'effort':
      return t('codex.composer.slashDescriptions.effort');
    case 'approval':
      return t('codex.composer.slashDescriptions.approval');
    case 'sandbox':
      return t('codex.composer.slashDescriptions.sandbox');
    default:
      return command.description;
  }
}

export function filterCodexSlashCommands(args: {
  query: string;
  context: CodexSlashCommandContext;
}): CodexSlashCommandSpec[] {
  const normalizedQuery = String(args.query ?? '').trim().toLowerCase();
  return CODEX_SLASH_COMMANDS
    .filter((command) => commandAvailabilityMatches(command, args.context))
    .map((command, index) => ({
      command,
      index,
      score: commandScore(command, normalizedQuery),
    }))
    .filter((entry) => entry.score >= 0)
    .sort((left, right) => {
      const scoreDelta = right.score - left.score;
      if (scoreDelta !== 0) return scoreDelta;
      return left.index - right.index;
    })
    .map((entry) => entry.command);
}

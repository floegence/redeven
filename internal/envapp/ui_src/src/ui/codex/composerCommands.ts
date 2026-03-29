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
  | 'focus-working-dir'
  | 'focus-model'
  | 'focus-effort'
  | 'focus-approval'
  | 'focus-sandbox';

export type CodexSlashCommandContext = Readonly<{
  hostAvailable: boolean;
}>;

export type CodexSlashCommandSpec = Readonly<{
  id: CodexSlashCommandID;
  command: string;
  title: string;
  description: string;
  action: CodexSlashCommandAction;
  aliases?: readonly string[];
  requires_host?: boolean;
}>;

const CODEX_SLASH_COMMANDS: readonly CodexSlashCommandSpec[] = [
  {
    id: 'mention',
    command: 'mention',
    title: '/mention',
    description: 'Insert @ and open the file reference picker.',
    action: 'insert-mention-trigger',
  },
  {
    id: 'new',
    command: 'new',
    title: '/new',
    description: 'Start a fresh Codex thread draft.',
    action: 'start-new-thread',
    requires_host: true,
  },
  {
    id: 'clear',
    command: 'clear',
    title: '/clear',
    description: 'Clear the current composer text, attachments, and file references.',
    action: 'clear-composer',
  },
  {
    id: 'cwd',
    command: 'cwd',
    title: '/cwd',
    description: 'Focus the working directory control.',
    action: 'focus-working-dir',
    aliases: ['workdir'],
  },
  {
    id: 'model',
    command: 'model',
    title: '/model',
    description: 'Focus the model selector.',
    action: 'focus-model',
    requires_host: true,
  },
  {
    id: 'effort',
    command: 'effort',
    title: '/effort',
    description: 'Focus the reasoning effort selector.',
    action: 'focus-effort',
    requires_host: true,
  },
  {
    id: 'approval',
    command: 'approval',
    title: '/approval',
    description: 'Focus the approval policy selector.',
    action: 'focus-approval',
    aliases: ['permissions'],
    requires_host: true,
  },
  {
    id: 'sandbox',
    command: 'sandbox',
    title: '/sandbox',
    description: 'Focus the sandbox selector.',
    action: 'focus-sandbox',
    requires_host: true,
  },
] as const;

function commandAvailabilityMatches(
  command: CodexSlashCommandSpec,
  context: CodexSlashCommandContext,
): boolean {
  return !command.requires_host || context.hostAvailable;
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

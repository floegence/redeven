export type FlowerSlashCommandID = 'clear' | 'plan' | 'act' | 'cwd';

export type FlowerSlashCommandAction =
  | 'clear-composer'
  | 'set-execution-mode'
  | 'open-working-dir-picker';

export type FlowerComposerExecutionMode = 'act' | 'plan';

export type FlowerSlashCommandContext = Readonly<{
  workingDirEditable: boolean;
  supportsExecutionModeSwitching: boolean;
}>;

export type FlowerSlashCommandSpec = Readonly<{
  id: FlowerSlashCommandID;
  command: string;
  title: string;
  description: string;
  action: FlowerSlashCommandAction;
  nextExecutionMode?: FlowerComposerExecutionMode;
  aliases?: readonly string[];
  requiresWorkingDirEditable?: boolean;
  requiresExecutionModeSwitching?: boolean;
}>;

const FLOWER_SLASH_COMMANDS: readonly FlowerSlashCommandSpec[] = [
  {
    id: 'clear',
    command: 'clear',
    title: '/clear',
    description: 'Clear the current Flower draft and local attachments.',
    action: 'clear-composer',
  },
  {
    id: 'plan',
    command: 'plan',
    title: '/plan',
    description: 'Switch Flower to plan mode and keep the remaining draft text.',
    action: 'set-execution-mode',
    nextExecutionMode: 'plan',
    requiresExecutionModeSwitching: true,
  },
  {
    id: 'act',
    command: 'act',
    title: '/act',
    description: 'Switch Flower to act mode and keep the remaining draft text.',
    action: 'set-execution-mode',
    nextExecutionMode: 'act',
    requiresExecutionModeSwitching: true,
  },
  {
    id: 'cwd',
    command: 'cwd',
    title: '/cwd',
    description: 'Open the working-directory picker and keep the remaining draft text.',
    action: 'open-working-dir-picker',
    aliases: ['workdir'],
    requiresWorkingDirEditable: true,
  },
] as const;

function commandAvailabilityMatches(
  command: FlowerSlashCommandSpec,
  context: FlowerSlashCommandContext,
): boolean {
  if (command.requiresWorkingDirEditable && !context.workingDirEditable) return false;
  if (command.requiresExecutionModeSwitching && !context.supportsExecutionModeSwitching) return false;
  return true;
}

function commandScore(command: FlowerSlashCommandSpec, normalizedQuery: string): number {
  if (!normalizedQuery) return 1;
  const names = [command.command, ...(command.aliases ?? [])].map((entry) => entry.toLowerCase());
  if (names.includes(normalizedQuery)) return 400;
  if (names.some((entry) => entry.startsWith(normalizedQuery))) return 300;
  if (names.some((entry) => entry.includes(normalizedQuery))) return 200;
  if (command.description.toLowerCase().includes(normalizedQuery)) return 100;
  return -1;
}

export function flowerSlashCommands(): readonly FlowerSlashCommandSpec[] {
  return FLOWER_SLASH_COMMANDS;
}

export function filterFlowerSlashCommands(args: {
  query: string;
  context: FlowerSlashCommandContext;
}): FlowerSlashCommandSpec[] {
  const normalizedQuery = String(args.query ?? '').trim().toLowerCase();
  return FLOWER_SLASH_COMMANDS
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

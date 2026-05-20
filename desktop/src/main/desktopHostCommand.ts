import fsSync from 'node:fs';
import path from 'node:path';

export type DesktopHostCommandName = 'docker' | 'podman' | 'ssh';

export type DesktopHostCommandResolutionSource =
  | 'absolute_input'
  | 'relative_input'
  | 'process_path'
  | 'desktop_default_path';

export type DesktopHostCommandResolution = Readonly<{
  command: string;
  source: DesktopHostCommandResolutionSource;
  searched_paths: readonly string[];
}>;

export class DesktopHostCommandNotFoundError extends Error {
  readonly command_name: string;
  readonly searched_paths: readonly string[];

  constructor(commandName: string, searchedPaths: readonly string[]) {
    super(desktopHostCommandNotFoundMessage(commandName));
    this.name = 'DesktopHostCommandNotFoundError';
    this.command_name = commandName;
    this.searched_paths = [...searchedPaths];
  }
}

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function unique(values: readonly string[]): readonly string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const clean = compact(value);
    if (clean === '' || seen.has(clean)) {
      continue;
    }
    seen.add(clean);
    out.push(clean);
  }
  return out;
}

function splitPathEnv(value: string | undefined): readonly string[] {
  return unique(String(value ?? '').split(path.delimiter));
}

function commandDisplayName(commandName: string): string {
  switch (compact(commandName).toLowerCase()) {
    case 'docker':
      return 'Docker CLI';
    case 'podman':
      return 'Podman CLI';
    case 'ssh':
      return 'SSH client';
    default:
      return compact(commandName) || 'Host command';
  }
}

export function desktopHostCommandNotFoundMessage(commandName: string): string {
  const clean = compact(commandName);
  switch (clean.toLowerCase()) {
    case 'docker':
      return 'Docker CLI was not found. Install Docker Desktop or make docker available to Redeven Desktop, then refresh and try again.';
    case 'podman':
      return 'Podman CLI was not found. Install Podman Desktop or make podman available to Redeven Desktop, then refresh and try again.';
    case 'ssh':
      return 'SSH client was not found. Install OpenSSH or make ssh available to Redeven Desktop, then try again.';
    default:
      return `${commandDisplayName(clean)} was not found. Install it or make it available to Redeven Desktop, then try again.`;
  }
}

export function desktopDefaultCommandSearchPaths(
  platform: NodeJS.Platform = process.platform,
): readonly string[] {
  if (platform !== 'darwin') {
    return [];
  }
  return [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/Applications/Docker.app/Contents/Resources/bin',
    '/Applications/Podman Desktop.app/Contents/Resources/bin',
  ];
}

export function desktopHostCommandSearchPaths(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  defaultSearchPaths: readonly string[] = desktopDefaultCommandSearchPaths(platform),
): readonly string[] {
  return unique([
    ...splitPathEnv(env.PATH),
    ...defaultSearchPaths,
  ]);
}

export function desktopHostCommandEnvironment(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  return {
    ...env,
    PATH: desktopHostCommandSearchPaths(env, platform).join(path.delimiter),
  };
}

function commandHasPathSeparator(commandName: string): boolean {
  return commandName.includes('/') || commandName.includes('\\');
}

function isExecutableFile(filePath: string): boolean {
  try {
    const stat = fsSync.statSync(filePath);
    if (!stat.isFile()) {
      return false;
    }
    fsSync.accessSync(filePath, fsSync.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function resolveDesktopHostCommand(
  commandName: string,
  options: Readonly<{
    env?: NodeJS.ProcessEnv;
    platform?: NodeJS.Platform;
    defaultSearchPaths?: readonly string[];
  }> = {},
): DesktopHostCommandResolution {
  const clean = compact(commandName);
  if (clean === '') {
    throw new Error('Host command name must be non-empty.');
  }

  if (path.isAbsolute(clean) || commandHasPathSeparator(clean)) {
    const searchedPath = compact(path.dirname(clean));
    if (isExecutableFile(clean)) {
      return {
        command: clean,
        source: path.isAbsolute(clean) ? 'absolute_input' : 'relative_input',
        searched_paths: searchedPath ? [searchedPath] : [],
      };
    }
    throw new DesktopHostCommandNotFoundError(path.basename(clean), searchedPath ? [searchedPath] : []);
  }

  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const processPaths = splitPathEnv(env.PATH);
  const searchPaths = desktopHostCommandSearchPaths(env, platform, options.defaultSearchPaths);
  const processPathSet = new Set(processPaths);
  for (const searchPath of searchPaths) {
    const candidate = path.join(searchPath, clean);
    if (!isExecutableFile(candidate)) {
      continue;
    }
    return {
      command: candidate,
      source: processPathSet.has(searchPath) ? 'process_path' : 'desktop_default_path',
      searched_paths: searchPaths,
    };
  }

  throw new DesktopHostCommandNotFoundError(clean, searchPaths);
}

export function isDesktopHostCommandNotFoundError(error: unknown): error is DesktopHostCommandNotFoundError {
  return error instanceof DesktopHostCommandNotFoundError
    || (
      !!error
      && typeof error === 'object'
      && (error as { name?: unknown }).name === 'DesktopHostCommandNotFoundError'
    );
}

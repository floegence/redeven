import fsSync from 'node:fs';
import path from 'node:path';

export type DesktopHostCommandName = 'docker' | 'podman' | 'ssh' | 'wsl';

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

function unique(values: readonly string[], caseInsensitive = false): readonly string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const clean = compact(value);
    const key = caseInsensitive ? clean.toLowerCase() : clean;
    if (clean === '' || seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(clean);
  }
  return out;
}

function splitPathEnv(value: string | undefined, platform: NodeJS.Platform): readonly string[] {
  return unique(
    String(value ?? '').split(platform === 'win32' ? path.win32.delimiter : path.posix.delimiter),
    platform === 'win32',
  );
}

function commandDisplayName(commandName: string): string {
  switch (compact(commandName).toLowerCase()) {
    case 'docker':
      return 'Docker CLI';
    case 'podman':
      return 'Podman CLI';
    case 'ssh':
      return 'SSH client';
    case 'wsl':
    case 'wsl.exe':
      return 'Windows Subsystem for Linux';
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
    case 'wsl':
    case 'wsl.exe':
      return 'WSL was not found. Enable Windows Subsystem for Linux, finish setting up a WSL 2 distribution, then try again.';
    default:
      return `${commandDisplayName(clean)} was not found. Install it or make it available to Redeven Desktop, then try again.`;
  }
}

export function desktopDefaultCommandSearchPaths(
  platform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env,
): readonly string[] {
  if (platform === 'win32') {
    const windowsRoot = compact(env.SystemRoot ?? env.WINDIR);
    return windowsRoot === '' ? [] : unique([
      path.win32.join(windowsRoot, 'System32'),
      path.win32.join(windowsRoot, 'Sysnative'),
    ], true);
  }
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
  defaultSearchPaths: readonly string[] = desktopDefaultCommandSearchPaths(platform, env),
): readonly string[] {
  return unique([
    ...splitPathEnv(env.PATH, platform),
    ...defaultSearchPaths,
  ], platform === 'win32');
}

export function desktopHostCommandEnvironment(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  return {
    ...env,
    PATH: desktopHostCommandSearchPaths(env, platform).join(
      platform === 'win32' ? path.win32.delimiter : path.posix.delimiter,
    ),
  };
}

function commandHasPathSeparator(commandName: string): boolean {
  return commandName.includes('/') || commandName.includes('\\');
}

function isExecutableFile(filePath: string, platform: NodeJS.Platform): boolean {
  try {
    const stat = fsSync.statSync(filePath);
    if (!stat.isFile()) {
      return false;
    }
    if (platform !== 'win32') {
      fsSync.accessSync(filePath, fsSync.constants.X_OK);
    }
    return true;
  } catch {
    return false;
  }
}

function commandCandidates(commandName: string, platform: NodeJS.Platform): readonly string[] {
  if (platform !== 'win32' || path.win32.extname(commandName) !== '') {
    return [commandName];
  }
  return [`${commandName}.exe`, `${commandName}.com`];
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

  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const pathAPI = platform === 'win32' ? path.win32 : path.posix;

  if (pathAPI.isAbsolute(clean) || commandHasPathSeparator(clean)) {
    const searchedPath = compact(pathAPI.dirname(clean));
    for (const candidate of commandCandidates(clean, platform)) {
      if (isExecutableFile(candidate, platform)) {
        return {
          command: candidate,
          source: pathAPI.isAbsolute(clean) ? 'absolute_input' : 'relative_input',
          searched_paths: searchedPath ? [searchedPath] : [],
        };
      }
    }
    throw new DesktopHostCommandNotFoundError(pathAPI.basename(clean), searchedPath ? [searchedPath] : []);
  }

  const processPaths = splitPathEnv(env.PATH, platform);
  const searchPaths = desktopHostCommandSearchPaths(env, platform, options.defaultSearchPaths);
  const processPathSet = new Set(processPaths.map((value) => platform === 'win32' ? value.toLowerCase() : value));
  for (const searchPath of searchPaths) {
    for (const commandCandidate of commandCandidates(clean, platform)) {
      const candidate = pathAPI.join(searchPath, commandCandidate);
      if (!isExecutableFile(candidate, platform)) {
        continue;
      }
      return {
        command: candidate,
        source: processPathSet.has(platform === 'win32' ? searchPath.toLowerCase() : searchPath)
          ? 'process_path'
          : 'desktop_default_path',
        searched_paths: searchPaths,
      };
    }
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

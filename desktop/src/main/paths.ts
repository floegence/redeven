import fs from 'node:fs';
import path from 'node:path';

export type ResolveBundledAgentPathArgs = Readonly<{
  isPackaged: boolean;
  resourcesPath: string;
  appPath: string;
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  existsSync?: (filePath: string) => boolean;
}>;

export function bundledAgentExecutableName(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? 'redeven.exe' : 'redeven';
}

export function resolveBundledAgentPath(args: ResolveBundledAgentPathArgs): string {
  const env = args.env ?? process.env;
  const override = String(env.REDEVEN_DESKTOP_AGENT_BINARY ?? '').trim();
  if (override) {
    return path.resolve(override);
  }

  const executableName = bundledAgentExecutableName(args.platform ?? process.platform);
  if (args.isPackaged) {
    return path.join(args.resourcesPath, 'bin', executableName);
  }

  const existsSync = args.existsSync ?? fs.existsSync;
  const candidateRoots = [
    args.appPath,
    path.resolve(args.appPath, '..'),
    process.cwd(),
  ];
  for (const root of candidateRoots) {
    const cleanRoot = String(root ?? '').trim();
    if (!cleanRoot) continue;
    const candidate = path.resolve(cleanRoot, '..', executableName);
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error('Unable to locate the bundled redeven binary. Set REDEVEN_DESKTOP_AGENT_BINARY for local development.');
}

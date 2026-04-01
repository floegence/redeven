import fs from 'node:fs';
import path from 'node:path';

export type ResolveBundledAgentPathArgs = Readonly<{
  isPackaged: boolean;
  resourcesPath: string;
  appPath: string;
  platform?: NodeJS.Platform;
  arch?: string;
  existsSync?: (filePath: string) => boolean;
}>;

export type ResolvePreloadPathArgs = Readonly<{
  appPath: string;
}>;

export function bundledAgentExecutableName(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? 'redeven.exe' : 'redeven';
}

function bundledAgentBundleDirName(platform: NodeJS.Platform = process.platform, arch: string = process.arch): string {
  let goarch = '';
  switch (arch) {
    case 'x64':
      goarch = 'amd64';
      break;
    case 'arm64':
      goarch = 'arm64';
      break;
    default:
      throw new Error(`Unsupported desktop agent architecture: ${arch}`);
  }

  switch (platform) {
    case 'darwin':
    case 'linux':
      return `${platform}-${goarch}`;
    default:
      throw new Error(`Unsupported desktop agent platform: ${platform}`);
  }
}

export function resolveBundledAgentPath(args: ResolveBundledAgentPathArgs): string {
  const executableName = bundledAgentExecutableName(args.platform ?? process.platform);
  if (args.isPackaged) {
    return path.join(args.resourcesPath, 'bin', executableName);
  }

  const existsSync = args.existsSync ?? fs.existsSync;
  const bundleDirName = bundledAgentBundleDirName(args.platform ?? process.platform, args.arch ?? process.arch);
  const candidateRoots = [
    args.appPath,
    path.resolve(args.appPath, '..'),
    process.cwd(),
  ];
  for (const root of candidateRoots) {
    const cleanRoot = String(root ?? '').trim();
    if (!cleanRoot) continue;
    const candidate = path.resolve(cleanRoot, '.bundle', bundleDirName, executableName);
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error('Unable to locate the desktop bundled redeven binary. Run `npm run start` or `npm run package` from the desktop workspace first.');
}

export function resolveSettingsPreloadPath(args: ResolvePreloadPathArgs): string {
  return path.join(args.appPath, 'dist', 'preload', 'settings.js');
}

export function resolveBrowserPreloadPath(args: ResolvePreloadPathArgs): string {
  return path.join(args.appPath, 'dist', 'preload', 'browser.js');
}

export function resolveWelcomeRendererPath(args: ResolvePreloadPathArgs): string {
  return path.join(args.appPath, 'dist', 'welcome', 'index.html');
}

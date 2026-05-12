import { spawnSync } from 'node:child_process';

export type DesktopRuntimeIdentity = Readonly<{
  runtime_version: string;
  runtime_commit: string;
  runtime_build_time: string;
}>;

function compact(value: unknown): string {
  return String(value ?? '').trim();
}

function parseVersionOutput(raw: string): DesktopRuntimeIdentity | null {
  const line = compact(raw).split(/\r?\n/).find((value) => compact(value) !== '') ?? '';
  if (line === '') {
    return null;
  }
  const match = /^redeven\s+([^\s]+)\s+\(([^)]+)\)\s+(.+)$/u.exec(line);
  if (!match) {
    return null;
  }
  return {
    runtime_version: compact(match[1]),
    runtime_commit: compact(match[2]),
    runtime_build_time: compact(match[3]),
  };
}

export function readBundledDesktopRuntimeIdentity(executablePath: string): DesktopRuntimeIdentity | null {
  const cleanExecutablePath = compact(executablePath);
  if (cleanExecutablePath === '') {
    return null;
  }
  const result = spawnSync(cleanExecutablePath, ['version'], {
    encoding: 'utf8',
    timeout: 1_500,
    windowsHide: true,
  });
  if (result.error || result.status !== 0) {
    return null;
  }
  return parseVersionOutput(`${result.stdout ?? ''}\n${result.stderr ?? ''}`);
}

import { normalizeAbsolutePath } from './askFlowerPath';

export function canOpenDirectoryPathInTerminal(path: string): boolean {
  return Boolean(normalizeAbsolutePath(path));
}

export function openDirectoryInTerminal(params: {
  path: string;
  preferredName?: string;
  openTerminalInDirectory: (workingDir: string, options?: { preferredName?: string }) => void;
  onInvalidDirectory?: () => void;
}): boolean {
  const workingDir = normalizeAbsolutePath(params.path);
  if (!workingDir) {
    params.onInvalidDirectory?.();
    return false;
  }

  params.openTerminalInDirectory(workingDir, { preferredName: params.preferredName });
  return true;
}

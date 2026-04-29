import { normalizeAbsolutePath } from './askFlowerPath';
import type { EnvWorkbenchHandoffAnchor } from '../envViewMode';

export function canOpenDirectoryPathInTerminal(path: string): boolean {
  return Boolean(normalizeAbsolutePath(path));
}

export function openDirectoryInTerminal(params: {
  path: string;
  preferredName?: string;
  workbenchAnchor?: EnvWorkbenchHandoffAnchor;
  openTerminalInDirectory: (
    workingDir: string,
    options?: {
      preferredName?: string;
      workbenchAnchor?: EnvWorkbenchHandoffAnchor;
    },
  ) => void;
  onInvalidDirectory?: () => void;
}): boolean {
  const workingDir = normalizeAbsolutePath(params.path);
  if (!workingDir) {
    params.onInvalidDirectory?.();
    return false;
  }

  const options: {
    preferredName?: string;
    workbenchAnchor?: EnvWorkbenchHandoffAnchor;
  } = {
    preferredName: params.preferredName,
  };
  if (params.workbenchAnchor) {
    options.workbenchAnchor = params.workbenchAnchor;
  }
  params.openTerminalInDirectory(workingDir, options);
  return true;
}

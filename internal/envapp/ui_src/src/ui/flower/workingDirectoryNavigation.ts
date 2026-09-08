import type {
  FlowerSurfaceAdapter,
  FlowerWorkingDirectoryActionAvailability,
  FlowerWorkingDirectoryOpenRequest,
} from '../../../../../flower_ui/src';
import type { EnvContextValue } from '../pages/EnvContext';
import { basenameFromAbsolutePath, normalizeAbsolutePath } from '../utils/askFlowerPath';

export type FlowerWorkingDirectoryNavigation = Pick<FlowerSurfaceAdapter,
  'openWorkingDirectoryInFileBrowser' | 'openWorkingDirectoryInTerminal' | 'workingDirectoryActionAvailability'>;

export function createFlowerWorkingDirectoryNavigation(options: Readonly<{
  availability: () => FlowerWorkingDirectoryActionAvailability;
  invalidDirectoryMessage: () => string;
  openFileBrowserAtPath: EnvContextValue['openFileBrowserAtPath'];
  openTerminalInDirectory: EnvContextValue['openTerminalInDirectory'];
}>): FlowerWorkingDirectoryNavigation {
  const resolvePath = (request: FlowerWorkingDirectoryOpenRequest, action: 'browse' | 'terminal') => {
    const availability = options.availability()[action];
    if (!availability.enabled) throw new Error(availability.reason || options.invalidDirectoryMessage());
    const path = normalizeAbsolutePath(request.path);
    if (!request.thread_id.trim() || !path) throw new Error(options.invalidDirectoryMessage());
    return path;
  };
  return {
    workingDirectoryActionAvailability: options.availability,
    openWorkingDirectoryInFileBrowser: async (request) => {
      const path = resolvePath(request, 'browse');
      await options.openFileBrowserAtPath(path, {
        title: basenameFromAbsolutePath(path),
        openStrategy: 'create_new',
      });
    },
    openWorkingDirectoryInTerminal: async (request) => {
      const path = resolvePath(request, 'terminal');
      options.openTerminalInDirectory(path, {
        preferredName: basenameFromAbsolutePath(path),
        openStrategy: 'create_new',
        workbenchAnchor: null,
      });
    },
  };
}

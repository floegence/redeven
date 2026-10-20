import { withFlowerReadDeadline, withFlowerRequestDeadline } from './requestDeadline';
import type {
  FlowerConversationPreferencePatch,
  FlowerConversationPreferences,
  FlowerSurfaceAdapter,
  FlowerTurnLaunchInput,
} from './contracts/flowerSurfaceContracts';

/** Resolve a one-shot root launch once, before uploads/admission. The caller
 * retains this input for unknown-admission retries; this never saves memory. */
export async function prepareFlowerNewConversationInput(
  source: Required<Pick<FlowerSurfaceAdapter, 'loadSettings' | 'getWorkingDirectoryPathContext'>>,
  input: FlowerTurnLaunchInput,
): Promise<FlowerTurnLaunchInput> {
  if (input.thread_id?.trim()) return input;
  const snapshot = await source.loadSettings();
  const preferences = snapshot.conversation_preferences;
  const modelID = input.model_id?.trim() || preferences?.model_id?.trim() || snapshot.model_directory?.current_model_id?.trim() || snapshot.model_profile?.current_model_id?.trim();
  let workingDir = input.working_dir?.trim() || preferences?.working_dir?.trim();
  if (!workingDir) {
    const context = await source.getWorkingDirectoryPathContext();
    workingDir = context.roots.find(root => root.id === context.defaultRootId)?.pathAbs || context.agentHomePathAbs;
  }
  return structuredClone({ ...input, model_id: modelID, working_dir: workingDir,
    permission_type: input.permission_type ?? snapshot.defaults.permission_type,
    reasoning_selection: input.reasoning_selection ?? preferences?.reasoning_by_model[modelID ?? ''] ?? { level: 'default' },
  });
}

/** Product preference writes share one ordered queue per authenticated adapter.
 * The server revision is still required: another browser may write concurrently.
 * Never retry a conflicting write automatically or copy effective thread values.
 */
export function createFlowerConversationPreferenceClient(transport: Readonly<{
  load: (signal?: AbortSignal) => Promise<FlowerConversationPreferences>;
  patch: (patch: FlowerConversationPreferencePatch & Readonly<{ expected_revision: number }>) => Promise<FlowerConversationPreferences>;
}>, options: Readonly<{ signal?: AbortSignal; canMutate?: () => boolean }> = {}) {
  const assertWritable = () => {
    options.signal?.throwIfAborted();
    if (options.canMutate?.() === false) throw new DOMException('Flower access is read-only.', 'NotAllowedError');
  };
  let writes: Promise<unknown> = Promise.resolve();
  return {
    load: (signal?: AbortSignal): Promise<FlowerConversationPreferences> => withFlowerReadDeadline(async readSignal => {
      await writes;
      readSignal.throwIfAborted();
      options.signal?.throwIfAborted();
      return transport.load(readSignal);
    }, 'Flower preferences read timed out.', signal && options.signal ? AbortSignal.any([signal, options.signal]) : signal ?? options.signal),
    save: (patch: FlowerConversationPreferencePatch): Promise<FlowerConversationPreferences> => {
      const captured = structuredClone(patch);
      const result = writes.then(() => withFlowerRequestDeadline(async () => {
        assertWritable();
        const current = await withFlowerReadDeadline(signal => transport.load(signal), 'Flower preferences read timed out.', options.signal);
        assertWritable();
        return transport.patch({ ...captured, expected_revision: current.revision });
      }, 'Flower preferences save timed out. Check settings before retrying.', options.signal));
      writes = result.catch(() => undefined);
      return result;
    },
  };
}

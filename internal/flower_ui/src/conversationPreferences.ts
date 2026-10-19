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
  load: () => Promise<FlowerConversationPreferences>;
  patch: (patch: FlowerConversationPreferencePatch & Readonly<{ expected_revision: number }>) => Promise<FlowerConversationPreferences>;
}>) {
  let writes: Promise<unknown> = Promise.resolve();
  return {
    load: async (): Promise<FlowerConversationPreferences> => {
      await writes;
      return transport.load();
    },
    save: (patch: FlowerConversationPreferencePatch): Promise<FlowerConversationPreferences> => {
      const captured = structuredClone(patch);
      const result = writes.then(async () => {
        const current = await transport.load();
        return transport.patch({ ...captured, expected_revision: current.revision });
      });
      writes = result.catch(() => undefined);
      return result;
    },
  };
}

import type { RuntimeFlowerRequest } from '../shared/runtimeFlowerIPC';

/** Resolve only the running incarnation; opening settings cannot boot or repair it. */
export async function resolveRunningSettingsTarget<T extends { record: { environment_id: string; startup: { started_at_unix_ms?: number } } }>(request: RuntimeFlowerRequest, running: (environmentID: string) => Promise<T | null>): Promise<T> {
  if (!request.environment_id) throw new Error('The settings environment is unavailable.');
  const target = await running(request.environment_id);
  if (!target || request.environment_id !== target.record.environment_id) throw new Error('The settings environment is unavailable.');
  const expected = request.expected_runtime_started_at_unix_ms;
  // IMPORTANT: An old editor cannot write into a replacement with the same ID.
  if (expected !== undefined && (!Number.isSafeInteger(expected) || expected <= 0 || expected !== target.record.startup.started_at_unix_ms)) throw new Error('The settings Runtime session has changed. Reopen settings.');
  return target;
}

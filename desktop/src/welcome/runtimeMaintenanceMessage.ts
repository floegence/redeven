export type RuntimeMaintenanceMessage = Readonly<
  | { kind: 'model_source_update'; subject: string }
  | { kind: 'not_running'; subject: string }
  | { kind: 'restart_required'; subject: string }
  | {
      kind: 'update_required';
      subject: string;
      action: 'Update and restart the runtime first' | 'Update the runtime first';
    }
>;

export function parseRuntimeMaintenanceMessage(message: string): RuntimeMaintenanceMessage | null {
  const modelSource = message.match(/^This (.+) needs an update before Desktop can make your local model settings available here\. Update and restart the runtime first; Open stays separate and becomes available after the runtime is ready\.$/u);
  if (modelSource) {
    return { kind: 'model_source_update', subject: modelSource[1] ?? '' };
  }

  const notRunning = message.match(/^This (.+) is not running\. Start the runtime again; Open becomes available after the runtime reports ready\.$/u);
  if (notRunning) {
    return { kind: 'not_running', subject: notRunning[1] ?? '' };
  }

  const restartRequired = message.match(/^This (.+) needs a successful restart before it can open this environment\. Restart the runtime, then open it again after it reports ready\.$/u);
  if (restartRequired) {
    return { kind: 'restart_required', subject: restartRequired[1] ?? '' };
  }

  const updateRequired = message.match(/^This (.+) needs an update before it can open this environment\. (Update and restart the runtime first|Update the runtime first); Open stays separate and becomes available after the runtime is ready\.$/u);
  if (updateRequired) {
    return {
      kind: 'update_required',
      subject: updateRequired[1] ?? '',
      action: updateRequired[2] as 'Update and restart the runtime first' | 'Update the runtime first',
    };
  }

  return null;
}

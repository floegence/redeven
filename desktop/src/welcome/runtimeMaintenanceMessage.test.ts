import { describe, expect, it } from 'vitest';

import { parseRuntimeMaintenanceMessage } from './runtimeMaintenanceMessage';

describe('parseRuntimeMaintenanceMessage', () => {
  it('parses the canonical Runtime maintenance messages', () => {
    expect(parseRuntimeMaintenanceMessage(
      'This local runtime needs an update before Desktop can make your local model settings available here. Update and restart the runtime first; Open stays separate and becomes available after the runtime is ready.',
    )).toEqual({ kind: 'model_source_update', subject: 'local runtime' });
    expect(parseRuntimeMaintenanceMessage(
      'This SSH runtime is not running. Start the runtime again; Open becomes available after the runtime reports ready.',
    )).toEqual({ kind: 'not_running', subject: 'SSH runtime' });
    expect(parseRuntimeMaintenanceMessage(
      'This local runtime needs a successful restart before it can open this environment. Restart the runtime, then open it again after it reports ready.',
    )).toEqual({ kind: 'restart_required', subject: 'local runtime' });
    expect(parseRuntimeMaintenanceMessage(
      'This local container runtime needs an update before it can open this environment. Update the runtime first; Open stays separate and becomes available after the runtime is ready.',
    )).toEqual({
      kind: 'update_required',
      subject: 'local container runtime',
      action: 'Update the runtime first',
    });
  });

  it('rejects obsolete capitalization variants and unrecognized text', () => {
    expect(parseRuntimeMaintenanceMessage(
      'This local Runtime needs a successful restart before it can open this Environment. Restart the Runtime, then open it again after it reports ready.',
    )).toBeNull();
    expect(parseRuntimeMaintenanceMessage('Restart this runtime.')).toBeNull();
  });
});

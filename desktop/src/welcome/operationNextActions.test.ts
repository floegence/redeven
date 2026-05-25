import { describe, expect, it } from 'vitest';

import type { DesktopLauncherActionProgress } from '../shared/desktopLauncherIPC';
import { visibleOperationNextActions } from './operationNextActions';

function failedProgress(
  nextActions: NonNullable<DesktopLauncherActionProgress['next_actions']>,
): DesktopLauncherActionProgress {
  return {
    action: 'open_local_environment',
    operation_key: 'local:host:local:open',
    subject_kind: 'local_environment',
    subject_id: 'local',
    environment_id: 'local',
    started_at_unix_ms: 100,
    updated_at_unix_ms: 120,
    status: 'failed',
    phase: 'failed',
    title: 'Open failed',
    detail: 'Desktop could not open the local environment.',
    next_actions: nextActions,
  };
}

describe('operationNextActions', () => {
  it('renders only supported next actions in stable order without duplicating fallbacks', () => {
    const progress = failedProgress([
      {
        kind: 'copy_diagnostics',
        operation_key: 'local:host:local:open',
        label: 'Copy diagnostics',
      },
      {
        kind: 'retry',
        operation_key: 'local:host:local:open',
        label: 'Retry',
      },
      {
        kind: 'refresh_status',
        environment_id: 'local',
        label: 'Refresh status',
      },
      {
        kind: 'dismiss',
        operation_key: 'local:host:local:open',
        label: 'Dismiss',
      },
      {
        kind: 'copy_diagnostics',
        operation_key: 'local:host:local:open',
        label: 'Copy diagnostics again',
      },
    ]);

    expect(visibleOperationNextActions(progress)).toEqual([
      expect.objectContaining({ kind: 'refresh_status', label: 'Refresh status' }),
      expect.objectContaining({ kind: 'copy_diagnostics', label: 'Copy diagnostics' }),
      expect.objectContaining({ kind: 'dismiss', label: 'Dismiss' }),
    ]);
  });
});

import { describe, expect, it } from 'vitest';

import type { DesktopLauncherActionProgress } from '../shared/desktopLauncherIPC';
import {
  groupedVisibleOperationNextActions,
  visibleOperationNextActions,
} from './operationNextActions';

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
        label: 'Copy log',
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
        kind: 'update_runtime',
        environment_id: 'local',
        label: 'Update runtime',
      },
      {
        kind: 'manage_desktop_update',
        environment_id: 'local',
        label: 'Update Redeven Desktop',
      },
      {
        kind: 'dismiss',
        operation_key: 'local:host:local:open',
        label: 'Dismiss',
      },
      {
        kind: 'copy_diagnostics',
        operation_key: 'local:host:local:open',
        label: 'Copy log again',
      },
    ]);

    expect(visibleOperationNextActions(progress)).toEqual([
      expect.objectContaining({ kind: 'refresh_status', label: 'Refresh status' }),
      expect.objectContaining({ kind: 'update_runtime', label: 'Update runtime' }),
      expect.objectContaining({ kind: 'manage_desktop_update', label: 'Update Redeven Desktop' }),
      expect.objectContaining({ kind: 'copy_diagnostics', label: 'Copy log' }),
      expect.objectContaining({ kind: 'dismiss', label: 'Dismiss' }),
    ]);
  });

  it('groups recovery and utility actions so failure popovers never place three actions in one row', () => {
    const progress = failedProgress([
      {
        kind: 'refresh_status',
        environment_id: 'local',
        label: 'Refresh status',
      },
      {
        kind: 'copy_diagnostics',
        operation_key: 'local:host:local:open',
        label: 'Copy log',
      },
      {
        kind: 'dismiss',
        operation_key: 'local:host:local:open',
        label: 'Dismiss',
      },
    ]);

    expect(groupedVisibleOperationNextActions(progress)).toEqual([
      {
        kind: 'primary',
        actions: [
          expect.objectContaining({ kind: 'refresh_status', label: 'Refresh status' }),
        ],
      },
      {
        kind: 'secondary',
        actions: [
          expect.objectContaining({ kind: 'copy_diagnostics', label: 'Copy log' }),
          expect.objectContaining({ kind: 'dismiss', label: 'Dismiss' }),
        ],
      },
    ]);
  });

  it('keeps long recovery actions full-width before utility actions', () => {
    const progress = failedProgress([
      {
        kind: 'manage_desktop_update',
        environment_id: 'local',
        label: 'Update Redeven Desktop',
      },
      {
        kind: 'refresh_status',
        environment_id: 'local',
        label: 'Refresh status',
      },
      {
        kind: 'copy_diagnostics',
        operation_key: 'local:host:local:open',
        label: 'Copy log',
      },
      {
        kind: 'dismiss',
        operation_key: 'local:host:local:open',
        label: 'Dismiss',
      },
    ]);

    expect(groupedVisibleOperationNextActions(progress)).toEqual([
      {
        kind: 'primary',
        actions: [
          expect.objectContaining({ kind: 'refresh_status', label: 'Refresh status' }),
          expect.objectContaining({ kind: 'manage_desktop_update', label: 'Update Redeven Desktop' }),
        ],
      },
      {
        kind: 'secondary',
        actions: [
          expect.objectContaining({ kind: 'copy_diagnostics', label: 'Copy log' }),
          expect.objectContaining({ kind: 'dismiss', label: 'Dismiss' }),
        ],
      },
    ]);
  });

  it('hides Desktop update next actions from Gateway progress panels', () => {
    const progress: DesktopLauncherActionProgress = {
      ...failedProgress([
        {
          kind: 'refresh_gateway_status',
          gateway_id: 'bastion',
          label: 'Refresh status',
        },
        {
          kind: 'update_gateway_runtime',
          gateway_id: 'bastion',
          label: 'Update Gateway runtime',
        },
        {
          kind: 'retry',
          operation_key: 'gateway:bastion:start',
          retry_action: {
            kind: 'refresh_gateway_status',
            gateway_id: 'bastion',
          },
          label: 'Retry',
        },
        {
          kind: 'manage_desktop_update',
          environment_id: 'gateway:bastion',
          label: 'Update Redeven Desktop',
        },
        {
          kind: 'copy_diagnostics',
          operation_key: 'gateway:bastion:start',
          label: 'Copy log',
        },
        {
          kind: 'dismiss',
          operation_key: 'gateway:bastion:start',
          label: 'Dismiss',
        },
      ]),
      action: 'start_gateway_runtime',
      operation_key: 'gateway:bastion:start',
      subject_kind: 'gateway',
      subject_id: 'bastion',
      environment_id: undefined,
    };

    expect(visibleOperationNextActions(progress)).toEqual([
      expect.objectContaining({ kind: 'retry', label: 'Retry' }),
      expect.objectContaining({ kind: 'refresh_gateway_status', label: 'Refresh status' }),
      expect.objectContaining({ kind: 'update_gateway_runtime', label: 'Update Gateway runtime' }),
      expect.objectContaining({ kind: 'copy_diagnostics', label: 'Copy log' }),
      expect.objectContaining({ kind: 'dismiss', label: 'Dismiss' }),
    ]);
    expect(visibleOperationNextActions(progress)).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'manage_desktop_update' }),
    ]));
  });
});

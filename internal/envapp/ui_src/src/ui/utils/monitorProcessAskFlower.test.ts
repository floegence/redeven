import { describe, expect, it } from 'vitest';
import {
  buildMonitorProcessFlowerTurnLauncherIntent,
  buildMonitorProcessSnapshotText,
  formatMonitorProcessBytes,
} from './monitorProcessAskFlower';

describe('monitorProcessAskFlower', () => {
  it('builds a monitoring intent with process snapshot context', () => {
    const intent = buildMonitorProcessFlowerTurnLauncherIntent({
      process: {
        pid: 512,
        name: 'node',
        cpuPercent: 63.4,
        memoryBytes: 805_306_368,
        username: 'alice',
      },
      snapshot: {
        platform: 'linux',
        timestampMs: 1_710_000_000_000,
      },
    });

    expect(intent).toMatchObject({
      source_surface: 'monitoring',
      context_items: [
        {
          kind: 'process_snapshot',
          pid: 512,
          name: 'node',
          username: 'alice',
          cpu_percent: 63.4,
          memory_bytes: 805_306_368,
          platform: 'linux',
          captured_at_ms: 1_710_000_000_000,
        },
      ],
    });
  });

  it('preserves zero CPU and memory values in monitoring context', () => {
    const intent = buildMonitorProcessFlowerTurnLauncherIntent({
      process: {
        pid: 42,
        name: 'idle-worker',
        cpuPercent: 0,
        memoryBytes: 0,
        username: 'demo',
      },
      snapshot: {
        platform: 'darwin',
        timestampMs: 1_710_000_000_000,
      },
    });

    expect(intent.context_items[0]).toMatchObject({
      kind: 'process_snapshot',
      cpu_percent: 0,
      memory_bytes: 0,
      platform: 'darwin',
      captured_at_ms: 1_710_000_000_000,
    });
  });

  it('renders a readable process snapshot summary', () => {
    const text = buildMonitorProcessSnapshotText({
      kind: 'process_snapshot',
      pid: 512,
      name: 'node',
      username: 'alice',
      cpu_percent: 63.4,
      memory_bytes: 805_306_368,
      platform: 'linux',
      captured_at_ms: 1_710_000_000_000,
    });

    expect(text).toContain('PID: 512');
    expect(text).toContain('Name: node');
    expect(text).toContain('CPU: 63.4%');
    expect(text).toContain('Memory: 768 MB');
    expect(text).toContain('Platform: linux');
  });

  it('formats bytes for process memory display', () => {
    expect(formatMonitorProcessBytes(0)).toBe('0 B');
    expect(formatMonitorProcessBytes(1024)).toBe('1 KB');
    expect(formatMonitorProcessBytes(1_048_576)).toBe('1 MB');
  });
});

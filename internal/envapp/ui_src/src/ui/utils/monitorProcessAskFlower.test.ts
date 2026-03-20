import { describe, expect, it } from 'vitest';
import {
  buildMonitorProcessAskFlowerIntent,
  buildMonitorProcessSnapshotText,
  formatMonitorProcessBytes,
} from './monitorProcessAskFlower';

describe('monitorProcessAskFlower', () => {
  it('builds a monitoring intent with process snapshot context', () => {
    const intent = buildMonitorProcessAskFlowerIntent({
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
      source: 'monitoring',
      mode: 'append',
      contextItems: [
        {
          kind: 'process_snapshot',
          pid: 512,
          name: 'node',
          username: 'alice',
          cpuPercent: 63.4,
          memoryBytes: 805_306_368,
          platform: 'linux',
          capturedAtMs: 1_710_000_000_000,
        },
      ],
    });
  });

  it('renders a readable process snapshot summary', () => {
    const text = buildMonitorProcessSnapshotText({
      kind: 'process_snapshot',
      pid: 512,
      name: 'node',
      username: 'alice',
      cpuPercent: 63.4,
      memoryBytes: 805_306_368,
      platform: 'linux',
      capturedAtMs: 1_710_000_000_000,
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

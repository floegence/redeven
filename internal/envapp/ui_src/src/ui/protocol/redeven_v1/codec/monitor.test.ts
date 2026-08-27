import { describe, expect, it } from 'vitest';

import { fromWireSysMonitorResponse, toWireSysMonitorRequest } from './monitor';

describe('System monitor codec', () => {
  it('omits the optional sort field when the caller uses the default order', () => {
    const request = toWireSysMonitorRequest({});

    expect(Object.keys(request)).toEqual([]);
  });

  it('maps whole-environment CPU and memory fields', () => {
    expect(fromWireSysMonitorResponse({
      cpu_usage: 17.5,
      cpu_cores: 8,
      memory_total_bytes: 17_179_869_184,
      memory_used_bytes: 9_663_676_416,
      network_bytes_received: 1,
      network_bytes_sent: 2,
      network_speed_received: 3,
      network_speed_sent: 4,
      platform: 'linux',
      processes: [],
      timestamp_ms: 9876,
    })).toMatchObject({
      cpuUsage: 17.5,
      cpuCores: 8,
      memoryTotalBytes: 17_179_869_184,
      memoryUsedBytes: 9_663_676_416,
      timestampMs: 9876,
    });
  });
});

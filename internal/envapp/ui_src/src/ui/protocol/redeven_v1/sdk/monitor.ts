export type SysMonitorSortBy = 'cpu' | 'memory';

export type SysMonitorProcessInfo = {
  pid: number;
  name: string;
  cpuPercent: number;
  memoryBytes: number;
  username: string;
};

export type SysMonitorSnapshot = {
  cpuUsage: number;
  cpuCores: number;
  loadAverage?: number[];

  networkBytesReceived: number;
  networkBytesSent: number;
  networkSpeedReceived: number;
  networkSpeedSent: number;

  platform: string;

  processes: SysMonitorProcessInfo[];
  timestampMs: number;
};

export type SysMonitorRequest = {
  sortBy?: SysMonitorSortBy;
};


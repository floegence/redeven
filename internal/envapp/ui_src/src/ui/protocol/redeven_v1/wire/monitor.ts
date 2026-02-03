export type wire_sys_monitor_sort_by = 'cpu' | 'memory';

export type wire_sys_monitor_req = {
  sort_by?: wire_sys_monitor_sort_by;
};

export type wire_sys_monitor_process_info = {
  pid: number;
  name: string;
  cpu_percent: number;
  memory_bytes: number;
  username: string;
};

export type wire_sys_monitor_resp = {
  cpu_usage: number;
  cpu_cores: number;
  load_average?: number[];

  network_bytes_received: number;
  network_bytes_sent: number;
  network_speed_received: number;
  network_speed_sent: number;

  platform: string;

  processes: wire_sys_monitor_process_info[];
  timestamp_ms: number;
};


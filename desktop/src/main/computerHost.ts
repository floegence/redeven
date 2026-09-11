import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';

export type ComputerHostEvent = Readonly<{ type: 'started' | 'progress' | 'frame' | 'result' | 'error'; request_id: string; target_id: string; payload?: Record<string, unknown>; error?: string }>;

/** Versioned JSONL bridge used by DesktopTarget. The native helper owns AXUIElement,
 * CGEvent and ScreenCaptureKit; Electron owns lifecycle and target binding. */
export class ComputerHost {
  private readonly process: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<string, (event: ComputerHostEvent) => void>();
  private readonly events: (event: ComputerHostEvent) => void;

  constructor(helperPath: string, events: (event: ComputerHostEvent) => void = () => {}) {
    this.events = events;
    this.process = spawn(helperPath, ['--protocol-version', '1'], { stdio: ['pipe', 'pipe', 'pipe'] });
    createInterface({ input: this.process.stdout }).on('line', (line) => {
      try {
        const event = JSON.parse(line) as ComputerHostEvent;
        this.events(event);
        this.pending.get(event.request_id)?.(event);
        if (event.type === 'result' || event.type === 'error') this.pending.delete(event.request_id);
      } catch { /* malformed helper output is surfaced by timeout/exit */ }
    });
  }

  request(target_id: string, tool_name: string, args: Record<string, unknown>): Promise<ComputerHostEvent> {
    const request_id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(request_id); reject(new Error('computer host request timed out')); }, 30_000);
      this.pending.set(request_id, (event) => { clearTimeout(timer); if (event.type === 'error') reject(new Error(event.error ?? 'computer host failed')); else resolve(event); });
      this.process.stdin.write(`${JSON.stringify({ protocol_version: 1, request_id, target_id, tool_name, args })}\n`);
    });
  }

  close(): void { this.process.kill(); }
}

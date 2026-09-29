import { randomUUID } from 'node:crypto';
import { validSessionRestartState, type SessionRestartRestore, type SessionRestartState } from '../shared/sessionRestartIPC';

export function runtimeSessionMatchesTarget(session: Readonly<{ runtime_target_key?: string }>, targetKey: string): boolean {
  return targetKey !== '' && session.runtime_target_key === targetKey;
}

/** One bounded user-state transfer; the Runtime lifecycle remains owned by its coordinator. */
export class RuntimeSessionHandoff {
  readonly ticket = randomUUID();
  private state: SessionRestartState | null = null;
  private destination = '';
  private acknowledged = false;
  private closed = false;
  private settle: ((error?: Error) => void) | undefined;

  constructor(readonly sourceGeneration: string) {}

  prepare(send: () => void, signal: AbortSignal, timeoutMs = 15_000): Promise<void> {
    if (this.closed || this.settle || this.state) return Promise.reject(new Error('Restart state transfer has already started.'));
    return new Promise<void>((resolve, reject) => {
      const abort = () => this.fail(new Error('Runtime restart was canceled before saving the workspace.'));
      const timer = setTimeout(() => this.fail(new Error('The Env App could not preserve its workspace. Keep the window open and try again.')), timeoutMs);
      this.settle = (error) => {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        this.settle = undefined;
        if (error) reject(error); else resolve();
      };
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      else { try { send(); } catch (error) { this.fail(error instanceof Error ? error : new Error(String(error))); } }
    });
  }

  submit(generation: string, ticket: string, state: unknown): boolean {
    if (this.closed || !this.settle || generation !== this.sourceGeneration || ticket !== this.ticket) return false;
    if (!validSessionRestartState(state)) { this.fail(new Error('The Env App workspace could not be transferred safely.')); return false; }
    this.state = state;
    this.settle();
    return true;
  }

  fail(error: Error): void { this.settle?.(error); }

  bind(generation: string): void {
    if (this.closed || !this.state || !generation || generation === this.sourceGeneration) throw new Error('A new Env App session is required to restore the workspace.');
    this.destination = generation;
    this.acknowledged = false;
  }

  read(generation: string): SessionRestartRestore | null {
    return !this.closed && this.state && generation === this.destination
      ? { ticket: this.ticket, state: this.state } : null;
  }

  restored(generation: string, ticket: string): boolean {
    if (!this.read(generation) || ticket !== this.ticket) return false;
    this.acknowledged = true;
    return true;
  }

  ready(generation: string): boolean { return this.destination === generation && this.acknowledged && !this.closed; }

  dispose(): void {
    this.fail(new Error('The Env App window was closed.'));
    this.closed = true;
    this.state = null;
    this.destination = '';
  }
}

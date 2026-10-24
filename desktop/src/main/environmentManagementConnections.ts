import type { RuntimePlacementBridgeLease, RuntimePlacementBridgeRecord } from './runtimePlacementBridgeRegistry';
import { RuntimeControlError } from './runtimeControlClient';

type Opening = {
  token: number;
  environmentID: string;
  controller: AbortController;
  connection?: Promise<RuntimePlacementBridgeLease | null>;
};

/** A closed renderer opening cannot reacquire a connection through a late IPC. */
export class EnvironmentManagementConnections {
  private readonly openings = new Map<number, Opening>();
  constructor(
    private readonly connect: (environmentID: string, owner: string, signal: AbortSignal, sshPassword?: string) => Promise<RuntimePlacementBridgeLease | null>,
    private readonly scope: 'settings' | 'gateway' = 'settings',
  ) {}

  private closedError(): RuntimeControlError {
    return new RuntimeControlError(this.scope === 'settings' ? 'SETTINGS_CLOSED' : 'GATEWAY_CONNECTION_CLOSED', 'This management dialog is no longer open.');
  }

  async use<T>(senderID: number, request: Readonly<{ environment_id: string; dialog_token: number }>, operation: (record: RuntimePlacementBridgeRecord | null) => Promise<T>, sshPassword?: string): Promise<T> {
    let opening = this.openings.get(senderID);
    if (opening && (request.dialog_token < opening.token || (request.dialog_token === opening.token &&
      (opening.controller.signal.aborted || request.environment_id !== opening.environmentID)))) {
      throw this.closedError();
    }
    if (!opening || opening.token !== request.dialog_token) {
      this.close(senderID);
      opening = { token: request.dialog_token, environmentID: request.environment_id, controller: new AbortController() };
      this.openings.set(senderID, opening);
    }
    const current = opening;
    if (current.connection) {
      const previous = current.connection;
      const existing = await previous;
      if (current.connection === previous && !existing?.active) current.connection = undefined;
    }
    if (current.controller.signal.aborted) throw this.closedError();
    if (!current.connection) {
      const task = this.connect(current.environmentID, `${this.scope}:${senderID}:${current.token}`, current.controller.signal, sshPassword);
      current.connection = task;
      void task.catch(() => { if (current.connection === task) current.connection = undefined; });
    }
    const lease = await current.connection;
    if (current.controller.signal.aborted) throw this.closedError();
    // Once admitted, a write retains transport until its response settles even if the dialog closes.
    const requestLease = await lease?.retain(`${this.scope}-request:${senderID}:${current.token}`);
    try { return await operation(requestLease?.record ?? null); }
    finally { await requestLease?.release(); }
  }

  close(senderID: number, token?: number): void {
    const current = this.openings.get(senderID);
    if (token !== undefined && (!current || token > current.token)) {
      this.close(senderID);
      const controller = new AbortController();
      controller.abort();
      this.openings.set(senderID, { token, environmentID: '', controller });
      return;
    }
    if (!current || (token !== undefined && current.token !== token)) return;
    current.controller.abort();
    void current.connection?.then(lease => lease?.release()).catch(() => undefined);
  }

  destroy(senderID: number): void { this.close(senderID); this.openings.delete(senderID); }
}

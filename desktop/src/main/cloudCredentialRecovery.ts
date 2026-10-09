import type { DesktopCloudRuntimeLinkTarget } from '../shared/providerRuntimeLinkTarget';
import type { RuntimeServiceCloudLinkBinding } from '../shared/runtimeService';

export type CloudCredentialRecoveryState = NonNullable<DesktopCloudRuntimeLinkTarget['credential_recovery']>;
export type CloudCredentialRecoveryOutcome = 'restored' | 'retry' | Exclude<CloudCredentialRecoveryState, 'restoring' | 'waiting' | 'waiting_for_service'>;
export type CloudCredentialRecoveryResult = Readonly<{ outcome: CloudCredentialRecoveryOutcome; error_code?: string }>;

export function providerCredentialsNeedRenewal(binding: RuntimeServiceCloudLinkBinding): boolean {
  return binding.remote_enabled && binding.state === 'linked' && binding.connection_state === 'authorization_required'
    && (binding.last_error_code === 'CONTROL_CREDENTIALS_EXPIRED' || binding.last_error_code === 'CONTROL_CREDENTIALS_EXHAUSTED')
    && Boolean(binding.local_environment_public_id) && (binding.binding_generation ?? 0) > 0;
}

// This bounds authorization exchanges only. Flowersec still owns transport retry.
export class CloudCredentialRecovery {
  private readonly attempts = new Map<string, {
    identity: string; generation: number; count: number; next: number; last: number; error?: string;
    state: CloudCredentialRecoveryState; done: boolean;
  }>();
  private readonly running = new Map<string, Promise<void>>();

  state(targetID: string, generation: number): CloudCredentialRecoveryState | undefined {
    const attempt = this.attempts.get(targetID);
    return attempt?.generation === generation && !attempt.done ? attempt.state : undefined;
  }

  details(targetID: string, generation: number): DesktopCloudRuntimeLinkTarget['credential_recovery_details'] {
    const attempt = this.attempts.get(targetID);
    if (!attempt || attempt.generation !== generation || attempt.done) return undefined;
    return { last_error_code: attempt.error, last_attempt_at_unix_ms: attempt.last,
      attempt_count: attempt.count,
      next_retry_at_unix_ms: ['waiting', 'waiting_for_service'].includes(attempt.state) ? attempt.next : undefined };
  }

  // Explicit intent is fenced by the caller before waiting for any already-sent exchange.
  async settled(targetID: string): Promise<void> { await this.running.get(targetID); }

  wake(): void {
    for (const attempt of this.attempts.values()) {
      if (!attempt.done && ['waiting', 'waiting_for_service'].includes(attempt.state)) attempt.next = 0;
    }
  }

  forget(targetID: string): void { this.attempts.delete(targetID); }

  requireSignIn(targetID: string, generation: number): void {
    this.attempts.set(targetID, { identity: 'missing-authorization', generation, count: 0, next: 0, last: 0,
      state: 'sign_in_required', done: false, error: 'authorization_missing' });
  }

  prune(targetIDs: ReadonlySet<string>): void {
    for (const id of this.attempts.keys()) if (!targetIDs.has(id)) this.attempts.delete(id);
  }

  async renew(args: {
    targetID: string; identity: string; generation: number; now: number;
    isCurrent: () => boolean;
    exchange: () => Promise<CloudCredentialRecoveryResult>;
    probe?: () => Promise<CloudCredentialRecoveryResult>;
    changed: () => void;
  }): Promise<void> {
    if (this.running.has(args.targetID) || !args.isCurrent()) return;
    let attempt = this.attempts.get(args.targetID);
    if (attempt?.identity !== args.identity) {
      attempt = { identity: args.identity, generation: args.generation, count: 0, next: 0, last: 0, state: 'waiting', done: false };
      this.attempts.set(args.targetID, attempt);
    }
    if (attempt.generation !== args.generation) {
      attempt.generation = args.generation;
      attempt.done = false;
      attempt.state = 'attention';
      attempt.error = 'CLOUD_LINK_BINDING_CHANGED';
    }
    if (attempt.done || !['waiting', 'waiting_for_service'].includes(attempt.state) || args.now < attempt.next) return;
    const current = attempt;
    const started = Date.now();
    const stillCurrent = () => this.attempts.get(args.targetID) === current && args.isCurrent();
    const run = async () => {
      try {
        if (current.state === 'waiting_for_service') {
          const result = args.probe ? await args.probe() : { outcome: 'retry' as const };
          if (!stillCurrent()) return;
          current.error = result.error_code ?? current.error;
          if (result.outcome !== 'restored') {
            current.state = result.outcome === 'retry' ? 'waiting_for_service' : result.outcome;
            current.next = args.now + (Date.now() - started) + 60_000;
            return;
          }
          current.count = 0;
        }
        current.state = 'restoring';
        current.count++;
        current.last = args.now + (Date.now() - started);
        args.changed();
        const result = await args.exchange();
        if (!stillCurrent()) return;
        current.error = result.error_code;
        current.done = result.outcome === 'restored';
        current.state = result.outcome === 'retry' ? (current.count < 3 ? 'waiting' : 'waiting_for_service')
          : result.outcome === 'restored' ? 'attention' : result.outcome;
        current.next = args.now + (Date.now() - started) + (current.count >= 3 ? 60_000 : current.count === 1 ? 30_000 : 120_000);
      } catch {
        if (stillCurrent()) { current.state = 'attention'; current.error = 'recovery_failed'; }
      } finally {
        this.running.delete(args.targetID);
        args.changed();
      }
    };
    // Register before invoking callbacks, including synchronous snapshot broadcasts.
    const task = Promise.resolve().then(run);
    this.running.set(args.targetID, task);
    await task;
  }
}

import type { DesktopProviderRuntimeLinkTarget } from '../shared/providerRuntimeLinkTarget';
import type { RuntimeServiceProviderLinkBinding } from '../shared/runtimeService';

export type ProviderCredentialRecoveryState = NonNullable<DesktopProviderRuntimeLinkTarget['credential_recovery']>;
export type ProviderCredentialRecoveryOutcome = 'restored' | 'retry' | Exclude<ProviderCredentialRecoveryState, 'restoring' | 'waiting'>;

export function providerCredentialsNeedRenewal(binding: RuntimeServiceProviderLinkBinding): boolean {
  return binding.state === 'linked' && binding.connection_state === 'authorization_required'
    && (binding.last_error_code === 'CONTROL_CREDENTIALS_EXPIRED' || binding.last_error_code === 'CONTROL_CREDENTIALS_EXHAUSTED')
    && Boolean(binding.local_environment_public_id) && (binding.binding_generation ?? 0) > 0;
}

// This bounds authorization exchanges only. Flowersec still owns transport retry.
export class ProviderCredentialRecovery {
  private readonly attempts = new Map<string, {
    identity: string; generation: number; count: number; next: number;
    state: ProviderCredentialRecoveryState; done: boolean;
  }>();
  private readonly running = new Set<string>();

  state(targetID: string, generation: number): ProviderCredentialRecoveryState | undefined {
    const attempt = this.attempts.get(targetID);
    return attempt?.generation === generation && !attempt.done ? attempt.state : undefined;
  }

  forget(targetID: string): void { this.attempts.delete(targetID); }

  prune(targetIDs: ReadonlySet<string>): void {
    for (const id of this.attempts.keys()) if (!targetIDs.has(id)) this.attempts.delete(id);
  }

  async renew(args: {
    targetID: string; identity: string; generation: number; now: number;
    isCurrent: () => boolean;
    exchange: () => Promise<ProviderCredentialRecoveryOutcome>;
    changed: () => void;
  }): Promise<void> {
    if (this.running.has(args.targetID) || !args.isCurrent()) return;
    let attempt = this.attempts.get(args.targetID);
    if (attempt?.identity !== args.identity) {
      attempt = { identity: args.identity, generation: args.generation, count: 0, next: 0, state: 'waiting', done: false };
      this.attempts.set(args.targetID, attempt);
    }
    if (attempt.generation !== args.generation) {
      attempt.generation = args.generation;
      attempt.done = false;
      attempt.state = 'attention';
    }
    if (attempt.done || attempt.state !== 'waiting' || args.now < attempt.next) return;
    this.running.add(args.targetID);
    attempt.state = 'restoring';
    attempt.count++;
    args.changed();
    try {
      const outcome = await args.exchange();
      if (this.attempts.get(args.targetID) !== attempt || !args.isCurrent()) return;
      attempt.done = outcome === 'restored';
      attempt.state = outcome === 'retry' ? (attempt.count < 3 ? 'waiting' : 'attention')
        : outcome === 'restored' ? 'attention' : outcome;
      attempt.next = args.now + (attempt.count === 1 ? 30_000 : 120_000);
    } catch {
      if (this.attempts.get(args.targetID) === attempt && args.isCurrent()) attempt.state = 'attention';
    } finally {
      this.running.delete(args.targetID);
      args.changed();
    }
  }
}

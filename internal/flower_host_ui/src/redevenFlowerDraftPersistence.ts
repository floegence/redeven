import type {
  FlowerComposerDraftLease,
  FlowerComposerDraftMode,
  FlowerComposerDraftMutationResult,
  FlowerComposerDraftPersistence,
  FlowerComposerDraftSnapshot,
  FlowerComposerDraftValue,
} from '../../flower_ui/src/composer/createFlowerComposerDraftCoordinator';

export type RedevenFlowerDraftRequest = (
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  body?: unknown,
) => Promise<unknown>;

function normalizeDraft(raw: unknown): FlowerComposerDraftSnapshot & Readonly<{ lease?: FlowerComposerDraftLease }> {
  const record = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const scopeID = String(record.scope_id ?? '').trim();
  const revision = Math.max(0, Math.floor(Number(record.revision) || 0));
  const updatedAt = Math.max(0, Math.floor(Number(record.updated_at_unix_ms) || 0));
  const valueRecord = record.value && typeof record.value === 'object' && !Array.isArray(record.value)
    ? record.value as Partial<FlowerComposerDraftValue>
    : {};
  const mode = String(valueRecord.mode ?? 'ordinary') as FlowerComposerDraftMode;
  const value: FlowerComposerDraftValue = {
    ...valueRecord,
    text: String(valueRecord.text ?? ''),
    attachments: Array.isArray(valueRecord.attachments) ? valueRecord.attachments : [],
    mode: mode === 'over_limit_editing' || mode === 'preparing_long_text_submission' || mode === 'admission_in_flight'
      ? mode
      : 'ordinary',
  };
  const leaseID = String(record.lease_id ?? '').trim();
  const holderID = String(record.lease_holder_id ?? '').trim();
  const expiresAt = Math.max(0, Math.floor(Number(record.lease_expires_at_unix_ms) || 0));
  return {
    scope_id: scopeID,
    revision,
    value,
    updated_at_unix_ms: updatedAt,
    ...(leaseID && holderID && expiresAt > 0 ? {
      lease: {
        lease_id: leaseID,
        scope_id: scopeID,
        holder_id: holderID,
        acquired_revision: revision,
        expires_at_unix_ms: expiresAt,
      },
    } : {}),
  };
}

export function createRedevenFlowerDraftPersistence(request: RedevenFlowerDraftRequest): FlowerComposerDraftPersistence {
  const pathFor = (scopeID: string) => `/_redeven_proxy/api/ai/composer-drafts/${encodeURIComponent(scopeID)}`;
  type AcquireResult = Awaited<ReturnType<FlowerComposerDraftPersistence['acquire']>>;
  const leaseResult = (raw: unknown): AcquireResult => {
    const record = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const draft = normalizeDraft(record.draft);
    const rawState = String(record.state ?? '');
    const state: AcquireResult['state'] = rawState === 'owned' || rawState === 'conflict' ? rawState : 'lost';
    return {
      state,
      snapshot: draft,
      ...(draft.lease ? { lease: draft.lease } : {}),
      ...(String(record.holder_id ?? '').trim() ? { holderID: String(record.holder_id).trim() } : {}),
    };
  };
  return {
    load: async (scopeID) => normalizeDraft(await request('GET', pathFor(scopeID))),
    acquire: async (scopeID, holderID, takeOver) => leaseResult(await request('POST', `${pathFor(scopeID)}/lease`, {
      action: takeOver ? 'take_over' : 'acquire',
      holder_id: holderID,
    })),
    renew: async (scopeID, holderID, leaseID) => {
      const result = leaseResult(await request('POST', `${pathFor(scopeID)}/lease`, {
        action: 'renew',
        holder_id: holderID,
        lease_id: leaseID,
      }));
      return {
        state: result.state === 'owned' ? 'owned' : 'lost',
        snapshot: result.snapshot,
        ...(result.lease ? { lease: result.lease } : {}),
      };
    },
    mutate: async (scopeID, holderID, leaseID, expectedRevision, value): Promise<FlowerComposerDraftMutationResult> => {
      const raw = await request('PUT', pathFor(scopeID), {
        holder_id: holderID,
        lease_id: leaseID,
        expected_revision: expectedRevision,
        value,
      });
      const record = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
      const snapshot = normalizeDraft(record.draft);
      switch (String(record.state ?? '')) {
        case 'committed': return { kind: 'committed', snapshot };
        case 'revision_conflict': return { kind: 'revision_conflict', snapshot };
        default: return { kind: 'lease_lost', snapshot };
      }
    },
    release: async (scopeID, holderID, leaseID) => {
      await request('POST', `${pathFor(scopeID)}/lease`, {
        action: 'release',
        holder_id: holderID,
        lease_id: leaseID,
      });
    },
  };
}

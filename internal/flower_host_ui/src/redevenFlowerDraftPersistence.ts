import type {
  FlowerComposerDraftLease,
  FlowerComposerDraftMode,
  FlowerComposerDraftMutationResult,
  FlowerComposerDraftPersistence,
  FlowerComposerDraftSnapshot,
  FlowerComposerDraftValue,
  FlowerComposerDraftReference,
} from '../../flower_ui/src/composer/createFlowerComposerDraftCoordinator';

export type RedevenFlowerDraftRequest = (
  method: 'GET' | 'POST' | 'PUT',
  path: string,
  body?: unknown,
) => Promise<unknown>;

const FLOWER_COMPOSER_DRAFT_REFERENCE_LIMIT = 128;

function normalizeReferences(raw: unknown): readonly FlowerComposerDraftReference[] {
  if (!Array.isArray(raw) || raw.length > FLOWER_COMPOSER_DRAFT_REFERENCE_LIMIT) throw new Error('Invalid Flower composer draft references.');
  const seenIdentities = new Set<string>();
  const seenLocalIDs = new Set<string>();
  return raw.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Invalid Flower composer draft reference.');
    const reference = item as Record<string, unknown>;
    const keys = Object.keys(reference);
    if (keys.length !== 4 || keys.some((key) => !['local_id', 'kind', 'path', 'label'].includes(key))) {
      throw new Error('Invalid Flower composer draft reference.');
    }
    const localID = typeof reference.local_id === 'string' ? reference.local_id.trim() : '';
    const kind = typeof reference.kind === 'string' ? reference.kind.trim() : '';
    const path = typeof reference.path === 'string' ? reference.path.trim() : '';
    const label = typeof reference.label === 'string' ? reference.label.trim() : '';
    if (
      !localID || localID.length > 200 || /[\r\n\0]/.test(localID)
      || (kind !== 'file' && kind !== 'directory')
      || !path || path.length > 4096 || /[\r\n\0]/.test(path)
      || !label || label.length > 512 || /[\r\n\0]/.test(label)
    ) throw new Error('Invalid Flower composer draft reference.');
    const identity = `${kind}\0${path}`;
    if (seenLocalIDs.has(localID) || seenIdentities.has(identity)) {
      throw new Error('Duplicate Flower composer draft reference.');
    }
    seenLocalIDs.add(localID);
    seenIdentities.add(identity);
    return { local_id: localID, kind, path, label };
  });
}

function normalizeDraft(raw: unknown): FlowerComposerDraftSnapshot & Readonly<{ lease?: FlowerComposerDraftLease }> {
  const record = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const scopeID = String(record.scope_id ?? '').trim();
  const revision = Math.max(0, Math.floor(Number(record.revision) || 0));
  const updatedAt = Math.max(0, Math.floor(Number(record.updated_at_unix_ms) || 0));
  const valueRecord = record.value && typeof record.value === 'object' && !Array.isArray(record.value)
    ? record.value as Partial<FlowerComposerDraftValue>
    : {};
  const mode = String(valueRecord.mode ?? 'ordinary') as FlowerComposerDraftMode;
  const references = normalizeReferences(valueRecord.references);
  const value: FlowerComposerDraftValue = {
    ...valueRecord,
    text: String(valueRecord.text ?? ''),
    attachments: Array.isArray(valueRecord.attachments) ? valueRecord.attachments : [],
    references,
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

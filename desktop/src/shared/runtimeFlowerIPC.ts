export const REQUEST_RUNTIME_FLOWER_CHANNEL = 'redeven-desktop:runtime-flower-request';

export type RuntimeFlowerRequestMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type RuntimeFlowerRequest = Readonly<{
  method: RuntimeFlowerRequestMethod;
  path: string;
  body?: unknown;
  staging_scope_id?: string;
  staging_capability?: string;
}>;

export type RuntimeFlowerError = Readonly<{
  code?: string;
  message: string;
  status?: number;
  retryAfterMs?: number;
  data?: unknown;
}>;

export type RuntimeFlowerFailureKind = 'response' | 'transport_unknown' | 'local';

export type RuntimeFlowerRequestResult = Readonly<
  | {
      ok: true;
      data: unknown;
      stagingCapability?: string;
    }
  | {
      ok: false;
      error: RuntimeFlowerError;
      failureKind: RuntimeFlowerFailureKind;
    }
>;

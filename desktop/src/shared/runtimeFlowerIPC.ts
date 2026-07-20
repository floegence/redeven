export const REQUEST_RUNTIME_FLOWER_CHANNEL = 'redeven-desktop:runtime-flower-request';

export type RuntimeFlowerRequestMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export type RuntimeFlowerRequest = Readonly<{
  method: RuntimeFlowerRequestMethod;
  path: string;
  body?: unknown;
}>;

export type RuntimeFlowerError = Readonly<{
  code?: string;
  message: string;
  status?: number;
  retryAfterMs?: number;
}>;

export type RuntimeFlowerFailureKind = 'response' | 'transport_unknown' | 'local';

export type RuntimeFlowerRequestResult = Readonly<
  | {
      ok: true;
      data: unknown;
    }
  | {
      ok: false;
      error: RuntimeFlowerError;
      failureKind: RuntimeFlowerFailureKind;
    }
>;

import type { Session as ElectronSession } from 'electron';
import type {
  ArtifactSource,
  JsonValue,
  Session,
} from '@floegence/flowersec-core';
import type { NativeCodeSpaceRoute } from './codespaceNativeGateway';

// Keep the native ESM package entrypoints intact in the CommonJS Electron main bundle.
const loadNodeSDK = new Function(
  'return import("@floegence/flowersec-core/node")',
) as () => Promise<typeof import('@floegence/flowersec-core/node')>;
const loadArtifactSource = new Function(
  'return import("@floegence/floe-webapp-boot/artifact-source")',
) as () => Promise<
  typeof import('@floegence/floe-webapp-boot/artifact-source')
>;
const CODE_APP = 'com.floegence.redeven.code';

export async function createRemoteNativeCodeSpaceRoute(
  input: Readonly<{
    webSession: ElectronSession;
    environmentOrigin: string;
    envPublicID: string;
    codeSpaceID: string;
    password?: string;
    signal: AbortSignal;
  }>,
): Promise<NativeCodeSpaceRoute> {
  const envOrigin = new URL(input.environmentOrigin);
  if (
    envOrigin.protocol !== 'https:' ||
    envOrigin.hostname.split('.').length < 4
  )
    throw new Error('codespace_environment_invalid');
  const launcher = new URL(envOrigin.origin);
  launcher.hostname = [
    `cs-${input.codeSpaceID}`,
    ...envOrigin.hostname.split('.').slice(1),
  ].join('.');
  const launcherOrigin = launcher.origin;
  const [sdk, boot] = await Promise.all([loadNodeSDK(), loadArtifactSource()]);
  const validateTarget = (value: JsonValue): void => {
    const binding = value as Record<string, unknown> | null;
    const expected = {
      v: 1,
      kind: 'codespace',
      code_space_id: input.codeSpaceID,
      env_public_id: input.envPublicID,
      floe_app: CODE_APP,
      launcher_kind: 'cs',
      launcher_id: input.codeSpaceID,
    };
    if (
      !binding ||
      Object.keys(binding).length !== Object.keys(expected).length ||
      Object.entries(expected).some(([key, value]) => binding[key] !== value)
    )
      throw new Error('codespace_binding_invalid');
  };
  const source: ArtifactSource = {
    acquire: async ({ signal }) => {
      const response = await input.webSession.fetch(
        new URL(
          `/api/srv/v1/floeproxy/environments/${encodeURIComponent(input.envPublicID)}/entry`,
          envOrigin,
        ).href,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Origin: envOrigin.origin,
          },
          credentials: 'include',
          redirect: 'error',
          signal,
          body: JSON.stringify({
            floe_app: CODE_APP,
            code_space_id: input.codeSpaceID,
            session_kind: 'codeapp',
          }),
        },
      );
      if (!response.ok)
        return {
          kind: 'failure',
          code: 'entry_ticket_denied',
          disposition: { kind: 'terminal' },
        };
      const reply = (await response.json()) as {
        success?: boolean;
        data?: { entry_ticket?: string };
      };
      const ticket =
        reply.success === true ? reply.data?.entry_ticket : undefined;
      if (!ticket)
        return {
          kind: 'failure',
          code: 'entry_ticket_invalid',
          disposition: { kind: 'terminal' },
        };
      const acquisition = boot.createIsolatedControlplaneArtifactSource({
        baseUrl: launcherOrigin,
        endpointId: input.envPublicID,
        payload: { floe_app: CODE_APP },
        entryTicket: ticket,
        fetch: (url, options) => input.webSession.fetch(String(url), options),
        isolatedContext: {
          envPublicId: input.envPublicID,
          floeApp: CODE_APP,
          codeSpaceId: input.codeSpaceID,
          appPath: '/',
          launcherKind: 'cs',
          launcherId: input.codeSpaceID,
          launcherOrigin,
          validateTargetBinding: validateTarget,
        },
        validateSpendBinding: (binding) => {
          if (
            binding.consumer !== 'isolated' ||
            binding.launcherOrigin !== launcherOrigin
          )
            throw new Error('codespace_binding_invalid');
          validateTarget(binding.targetBinding);
        },
        commitSpend: async (spend, signal) => {
          const response = await input.webSession.fetch(
            new URL('/api/srv/v1/floeproxy/artifact/spend', launcherOrigin)
              .href,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Origin: launcherOrigin,
                Authorization: `Bearer ${spend.receipt}`,
              },
              credentials: 'omit',
              redirect: 'error',
              signal,
              body: JSON.stringify({
                v: 1,
                attempt_id: spend.attemptId,
                artifact_digest_b64u: spend.artifactDigestB64u,
                projection_digest_b64u: spend.projectionDigestB64u,
                runtime_origin: spend.runtimeOrigin,
                app_origin: spend.appOrigin,
                consumer: spend.consumer,
                target_binding: spend.targetBinding,
                expires_at: spend.expiresAt,
              }),
            },
          );
          if (response.status !== 204)
            throw new Error('codespace_spend_denied');
        },
      });
      return acquisition.acquire({ signal });
    },
  };
  const controller = sdk.createConnectionController(source, {
    origin: launcherOrigin,
  });
  controller.start();
  const authorized = new WeakMap<Session, Promise<void>>();
  const authorize = (session: Session, signal: AbortSignal): Promise<void> => {
    let pending = authorized.get(session);
    if (!pending) {
      pending = (async () => {
        const stream = await session.openStream('code/auth_v1', {
          signal,
          metadata: sdk.createStreamMetadata(
            input.password ? { password: input.password } : {},
          ),
        });
        try {
          await stream.closeWrite();
          const chunks: Uint8Array[] = [];
          let size = 0;
          for (;;) {
            const chunk = await stream.read({ signal });
            if (chunk === null) break;
            size += chunk.length;
            if (size > 4096) throw new Error('codespace_auth_invalid');
            chunks.push(chunk);
          }
          const result = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
            unlocked?: boolean;
          };
          if (result.unlocked !== true)
            throw new Error('codespace_password_required');
        } finally {
          await stream.close();
        }
      })();
      authorized.set(session, pending);
    }
    return pending;
  };
  try {
    await authorize(
      await controller.waitForSession({ signal: input.signal }),
      input.signal,
    );
  } catch (error) {
    await controller.close();
    throw error;
  }
  return {
    pathPrefix: '',
    authority: '',
    headers: {},
    openConnection: async (signal, presentationOrigin) => {
      const session = await controller.waitForSession({ signal });
      await authorize(session, signal);
      return sdk.createByteStreamDuplex(
        await session.openStream('code/http_v1', {
          signal,
          metadata: sdk.createStreamMetadata({
            presentation_origin: presentationOrigin,
          }),
        }),
        signal,
      );
    },
    close: () => controller.close(),
  };
}

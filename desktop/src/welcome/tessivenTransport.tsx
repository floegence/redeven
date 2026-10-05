import { fetchServerSentEvents } from '@floegence/floe-webapp-boot';
import { createTessivenTransport } from '../../../internal/tessiven_ui/src/transport';
import { TESSIVEN_API } from '../../../internal/tessiven_ui/src/types';
import {
  runtimeFlowerStreamFetch,
  type DesktopSettingsBridge,
} from './flower/localEnvironmentFlowerSurfaceAdapter';

export function createDesktopTessivenTransport(bridge: DesktopSettingsBridge) {
  return createTessivenTransport(
    async <T,>(method: 'GET' | 'POST', path: string, body?: unknown) => {
      const result = await bridge.requestRuntimeFlower({
        method,
        path: `${TESSIVEN_API}${path}`,
        body,
      });
      if (!result.ok)
        throw Object.assign(new Error(result.error.message), {
          code: result.error.code,
          status: result.error.status,
          data: result.error.data,
        });
      return result.data as T;
    },
    (path, signal) =>
      fetchServerSentEvents(path, {
        method: 'GET',
        signal,
        fetch: runtimeFlowerStreamFetch(
          bridge,
          `tessiven-${crypto.randomUUID()}`,
        ),
      }),
  );
}

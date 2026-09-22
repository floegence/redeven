import { createEffect, on, type Accessor } from 'solid-js';
import { createDocumentAssetRecovery } from '@floegence/floe-webapp-core/app';
import { REDEVEN_ENV_APP_BASE_PATH } from '../../build/envAppBasePath';
import { fetchLocalApi } from '../services/localApi';

export function createEnvAppAssetRecovery(ready: Accessor<boolean>) {
  const recovery = createDocumentAssetRecovery({
    url: REDEVEN_ENV_APP_BASE_PATH,
    fetch: (input, init) => fetchLocalApi(String(input), init),
  });
  createEffect(on(ready, (connected) => {
    if (connected) void recovery.check();
  }));
  return recovery;
}

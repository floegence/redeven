import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { FloeProvider } from '@floegence/floe-webapp-core';
import { Button } from '@floegence/floe-webapp-core/ui';
import { RuntimeGatewaySetupDialog } from '../../src/welcome/RuntimeGatewaySetupDialog';
import { createDesktopI18n, type DesktopLocale } from '../../src/shared/i18n';
import type { DesktopEnvironmentEntry } from '../../src/shared/desktopLauncherIPC';
import '../../src/welcome/index.css';

const params = new URLSearchParams(location.search);
const i18n = createDesktopI18n(params.get('locale') as DesktopLocale || 'en-US');
const environment = (window as unknown as { gatewayEnvironment: DesktopEnvironmentEntry }).gatewayEnvironment;
const [open, setOpen] = createSignal(true);
render(() => <FloeProvider config={{ storage: { enabled: false }, theme: { defaultTheme: 'light' } }}><main class="p-4">
  <Button onClick={() => setOpen(true)}>{i18n.t('gatewayJoin.title')}</Button>
  <RuntimeGatewaySetupDialog environment={open() ? environment : undefined} i18n={i18n} refresh={async () => true}
    recover={async () => ({ ok: false })} edit={() => {}} close={() => setOpen(false)} />
</main></FloeProvider>, document.getElementById('root')!);

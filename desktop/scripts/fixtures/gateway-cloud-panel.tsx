import { render } from 'solid-js/web';
import { GatewayCloudPanel } from '../../src/welcome/GatewayCloudPanel';
import { createDesktopI18n, type DesktopLocale } from '../../src/shared/i18n';
import '../../src/welcome/index.css';

const locale = new URLSearchParams(location.search).get('locale') as DesktopLocale || 'en-US';
render(() => <main class="p-4"><GatewayCloudPanel gatewayID="gateway-acceptance" gatewayName="Acceptance Gateway" i18n={createDesktopI18n(locale)} /></main>, document.getElementById('root')!);

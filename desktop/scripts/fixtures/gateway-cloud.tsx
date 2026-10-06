import { render } from 'solid-js/web';
import { RuntimeGatewayJoinPanel } from '../../src/welcome/RuntimeGatewayJoinPanel';
import { createDesktopI18n, type DesktopLocale } from '../../src/shared/i18n';
import '../../src/welcome/index.css';

const locale = new URLSearchParams(location.search).get('locale') as DesktopLocale || 'en-US';
render(() => <main class="p-4"><RuntimeGatewayJoinPanel targetID="ssh:qualification" i18n={createDesktopI18n(locale)} /></main>, document.getElementById('root')!);

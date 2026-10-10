import { render } from 'solid-js/web';
import { Dialog } from '@floegence/floe-webapp-core/ui';
import { FloeProvider } from '@floegence/floe-webapp-core';
import { GatewayMembersPanel } from '../../src/welcome/GatewayMembersDialog';
import { RuntimeGatewayJoinPanel } from '../../src/welcome/RuntimeGatewayJoinPanel';
import type { DesktopGatewaySource } from '../../src/shared/desktopGateway';
import { createDesktopI18n, type DesktopLocale } from '../../src/shared/i18n';
import '../../src/welcome/index.css';

const params = new URLSearchParams(location.search);
const i18n = createDesktopI18n(params.get('locale') as DesktopLocale || 'en-US');
const gateway: DesktopGatewaySource = {
 gateway_id:'local-gateway',display_name:'Office Gateway',local_enabled:true,connection_kind:'local_host',management_capability:'managed_local_host',
 capabilities:['member_manage'],status:'online',trust_state:'paired',listener_running:true,listener_addresses:[':7443'],active_listener_addresses:['[::]:7443'],
 allowed_hosts:[],listener_restart_required:false,permissions:{access:true,manage_members:true,configure_cloud:true},environments:[],created_at_ms:1,updated_at_ms:1,
 member_endpoints:[{endpoint_id:'lan',address:'https://office.local:7443',scope:'lan',priority:0}],
};
render(() => <FloeProvider><main class="p-4">{params.get('view') === 'settings'
 ? <Dialog open onOpenChange={() => {}} title={i18n.t('gatewayClients.connectionSettings')} class="redeven-gateway-dialog" contentClass="redeven-gateway-dialog__content"><GatewayMembersPanel gateway={gateway} i18n={i18n} targets={[]} section="connection" refresh={async()=>{}} /></Dialog>
 : <RuntimeGatewayJoinPanel targetID="local:local" targetLabel={i18n.t('desktop.localEnvironment')} gateways={[gateway]} i18n={i18n}/>}</main></FloeProvider>,document.getElementById('root')!);

import { FloeProvider } from '@floegence/floe-webapp-core';
import { render } from 'solid-js/web';
import { FlowerThreadList } from '../../src/threads/FlowerThreadList';
import type { FlowerThreadListItem } from '../../src/contracts/flowerSurfaceContracts';
import { desktopStateStorageBridge } from '../../../../desktop/src/welcome/desktopTheme';
import '../../../../desktop/src/welcome/index.css';

const item: FlowerThreadListItem = {
  thread_id: 'persistence-test', title: 'Persistence test', title_status: 'ready', model_id: '', working_dir: '/workspace',
  pinned: false, created_at_ms: 1, updated_at_ms: 1, preview: '', status: 'idle', source_label: '', target_labels: [],
  read_status: { is_unread: false, snapshot: { activity_revision: 1 }, read_state: { last_seen_activity_revision: 1 } },
};
const root = document.getElementById('root')!;
root.className = 'flower-component-shell flower-surface';
root.style.cssText = 'height: 500px; width: 272px; display: flex;';
render(() => <FloeProvider><FlowerThreadList items={[item]} query="" preferenceScope="electron-restart"
  preferenceStorage={desktopStateStorageBridge() ?? undefined} onQueryChange={() => undefined} onSelect={() => undefined} onRefresh={() => undefined} /></FloeProvider>, root);

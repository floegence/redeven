import { batch, createSignal, For, onCleanup } from 'solid-js';
import { render } from 'solid-js/web';
import { BUILT_IN_SHELL_THEME_DEFAULTS, builtInShellThemePresets, FloeProvider, useTheme } from '@floegence/floe-webapp-core';
import { Button, Card, CardContent, CardFooter, CardHeader, CardTitle } from '@floegence/floe-webapp-core/ui';
import { createDesktopI18n } from '../../src/shared/i18n';
import { DesktopThemePicker } from '../../src/welcome/DesktopThemePicker';
import { createDesktopThemeStorageAdapter, desktopThemeBridge } from '../../src/welcome/desktopTheme';
import '../../src/welcome/index.css';

const bridge = desktopThemeBridge()!;
const i18n = createDesktopI18n('zh-CN');
const storage = createDesktopThemeStorageAdapter({ getItem: () => null, setItem: () => {}, removeItem: () => {} }, 'acceptance', 'theme', bridge);
function Surface() {
  const theme = useTheme();
  const [snapshot, setSnapshot] = createSignal(bridge.getSnapshot());
  const unsubscribe = bridge.subscribe(next => batch(() => {
    setSnapshot(next);
    theme.setShellPreset(next.shellThemes.light);
    theme.setShellPreset(next.shellThemes.dark);
    theme.setTheme(next.source);
  }));
  onCleanup(unsubscribe);
  return <>
    <header style={{ display: 'flex', 'justify-content': 'space-between', padding: '12px 28px', 'border-bottom': '1px solid var(--border)', background: 'var(--sidebar)' }}>
      <strong>Redeven Desktop</strong>
      <DesktopThemePicker openRequest={0} snapshot={snapshot()} i18n={i18n} onSourceChange={bridge.setSource} onShellThemeChange={bridge.setShellTheme} />
    </header>
    <main style={{ padding: '32px', display: 'grid', gap: '24px' }}>
      <div><h1 style={{ 'font-size': '24px', 'font-weight': 600 }}>Environments</h1><p style={{ color: 'var(--muted-foreground)' }}>Manage local, SSH, and Redeven Cloud environments.</p></div>
      <div style={{ display: 'grid', 'grid-template-columns': 'repeat(3, 1fr)', gap: '20px' }}>
        <For each={['Local Environment', 'Development', 'Production']}>
          {name => <Card class="redeven-environment-card"><CardHeader><CardTitle>{name}</CardTitle></CardHeader><CardContent><span style={{ color: 'var(--success)' }}>● Ready</span><p style={{ 'margin-top': '20px', color: 'var(--muted-foreground)' }}>Runtime service is available</p></CardContent><CardFooter><Button>Open Env App</Button></CardFooter></Card>}
        </For>
      </div>
      <label style={{ 'max-width': '400px' }}>Workspace notes<textarea data-appearance-draft aria-label="Workspace notes" style={{ display: 'block', width: '100%', 'margin-top': '8px', padding: '12px', background: 'var(--card)', border: '1px solid var(--input)', 'border-radius': '8px' }}>Unsubmitted draft</textarea></label>
    </main>
  </>;
}
render(() => <FloeProvider config={{ storage: { namespace: 'acceptance', adapter: storage }, theme: { defaultTheme: bridge.getSnapshot().source, shellPresets: builtInShellThemePresets, defaultShellPreset: BUILT_IN_SHELL_THEME_DEFAULTS, defaultSurfaceStyle: 'soft-neumorphic' } }}><Surface /></FloeProvider>, document.getElementById('root')!);

import { onMount } from 'solid-js';
import { render } from 'solid-js/web';
import { FloeProvider, useTheme, builtInShellThemePresets } from '@floegence/floe-webapp-core';
import { EnvSettingsPage } from '../../../src/ui/pages/EnvSettingsPage';
import { I18nProvider } from '../../../src/ui/i18n';
import { createRuntimeSettingsFixture } from './fixture';
import '../../../src/index.css';

const query = new URLSearchParams(location.search);
function PreviewTheme() {
  const theme = useTheme();
  onMount(() => { const preset = builtInShellThemePresets.find(item => item.name === query.get('preset')); if (preset && (preset.mode === 'dark' || preset.mode === 'light')) theme.selectShellTheme(preset.mode, preset.name); });
  return null;
}
render(() => {
  const fixture = createRuntimeSettingsFixture();
  const section = query.get('page');
  if (section) fixture.setActiveSection(section as Parameters<typeof fixture.setActiveSection>[0]);
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = String(input);
    if (!url.startsWith('/_redeven_proxy/')) return originalFetch(input, init);
    try { return new Response(JSON.stringify({ ok: true, data: await fixture.request(url, init) }), { headers: { 'content-type': 'application/json' } }); }
    catch (error) { return new Response(JSON.stringify({ ok: false, error: String(error) }), { status: 400 }); }
  };
  return <FloeProvider config={{ theme: { shellPresets: builtInShellThemePresets } }}><PreviewTheme /><I18nProvider><div style={{ height: '100dvh' }}><EnvSettingsPage context={fixture.context} /></div></I18nProvider></FloeProvider>;
}, document.getElementById('root')!);

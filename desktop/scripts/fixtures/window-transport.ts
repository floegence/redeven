import { app, BrowserWindow } from 'electron';
import { desktopPrivateBridgeRequestHeaders, resolveDesktopSessionTransport } from '../../src/main/desktopSessionTransport';

// Exercise the production private-bridge header scope in an isolated window.
const fixture = JSON.parse(process.env.REDEVEN_WINDOW_ELECTRON_FIXTURE!);
const startup = { local_ui_bridge_url: fixture.origin, local_ui_bridge_token: fixture.token };
const transport = resolveDesktopSessionTransport({
  kind: 'local_environment', session_key: 'env:window-transport-fixture',
  environment_id: 'local', label: 'Window transport acceptance', route: 'local_host',
  local_environment_kind: 'local', has_local_hosting: true, has_remote_desktop: false,
}, startup);
void app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, webPreferences: {
    sandbox: true, contextIsolation: true, nodeIntegration: false,
  } });
  window.webContents.session.webRequest.onBeforeSendHeaders((details, callback) => {
    callback({ requestHeaders: desktopPrivateBridgeRequestHeaders(transport, startup, details.url, details.requestHeaders, {
      webServiceForwardID: fixture.forward, graphicalWindow: true,
    }) });
  });
  await window.loadURL('about:blank');
}).catch(error => { console.error(error); app.exit(1); });
app.on('window-all-closed', () => app.quit());

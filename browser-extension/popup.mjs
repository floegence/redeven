import { messages } from './messages.mjs';
const locale = chrome.i18n.getUILanguage();
const copy = messages[locale] || messages[Object.keys(messages).find(key => key.split('-')[0] === locale.split('-')[0])] || messages['en-US'];
const byID = id => document.getElementById(id);
for (const [id, key] of Object.entries({ intro: 'intro', 'profile-label': 'profile', 'bridge-label': 'bridge', 'connect-button': 'connect', disconnect: 'disconnect' })) byID(id).textContent = copy[key];
function show(state) {
  byID('status').textContent = state.error ? copy.failed : state.connected ? copy.connected : copy.disconnected;
  byID('disconnect').hidden = !state.connected;
  if (state.nativeHost) byID('bridge').value = state.nativeHost;
  if (state.profileName) byID('profile').value = state.profileName;
}
byID('connect').addEventListener('submit', async event => {
  event.preventDefault(); byID('connect-button').disabled = true;
  try { show(await chrome.runtime.sendMessage({ command: 'connect', nativeHost: byID('bridge').value.trim(), profileName: byID('profile').value.trim() })); }
  finally { byID('connect-button').disabled = false; }
});
byID('disconnect').addEventListener('click', async () => show(await chrome.runtime.sendMessage({ command: 'disconnect' })));
show(await chrome.runtime.sendMessage({ command: 'status' }));

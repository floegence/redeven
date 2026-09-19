import { messages } from './messages.mjs';
const locale = chrome.i18n.getUILanguage();
const copy = messages[locale] || messages[Object.keys(messages).find(key => key.split('-')[0] === locale.split('-')[0])] || messages['en-US'];
const byID = id => document.getElementById(id);
for (const [id, key] of Object.entries({ intro: 'intro', 'profile-label': 'profile', 'connect-button': 'connect', disconnect: 'disconnect', repair: 'updateExtension' })) byID(id).textContent = copy[key];
byID('profile').setAttribute('aria-label', copy.profile);
// A Runtime-generated deep link supplies configuration, never consent. Chrome
// keeps installation approval, and this button keeps connection approval.
const supplied = location.hash.slice(1);
const validHost = value => /^dev\.floegence\.redeven\.r[a-f0-9]{16}$/u.test(value);
let nativeHost = validHost(supplied) ? supplied : '';
let busy = false;
function show(state) {
  if (!nativeHost && !supplied && validHost(state.nativeHost)) nativeHost = state.nativeHost;
  const connected = state.connected && state.nativeHost === nativeHost;
  byID('status').textContent = state.error ? (copy[state.error] || copy.failed) : connected ? copy.connected : nativeHost ? copy.disconnected : copy.openFlower;
  byID('disconnect').hidden = !state.connected;
  byID('repair').hidden = state.error !== 'extension_update_required';
  byID('connect').hidden = connected;
  byID('connect-button').disabled = busy || !nativeHost;
  if (state.profileName && !byID('profile').value) byID('profile').value = state.profileName;
}
byID('connect').addEventListener('submit', async event => {
  event.preventDefault(); if (busy || !nativeHost) return;
  busy = true; byID('connect-button').disabled = true;
  try {
    const state = await chrome.runtime.sendMessage({ command: 'connect', nativeHost, profileName: byID('profile').value.trim() || 'Chrome' });
    busy = false; show(state);
  } catch { busy = false; show({ error: true }); }
});
byID('disconnect').addEventListener('click', async () => show(await chrome.runtime.sendMessage({ command: 'disconnect' })));
byID('repair').addEventListener('click', () => void chrome.tabs.create({ url: 'chrome://extensions/' }));
chrome.runtime.onMessage.addListener((message, sender) => {
  if (sender.id === chrome.runtime.id && message.type === 'connection_changed') {
    void chrome.runtime.sendMessage({ command: 'status' }).then(show).catch(() => show({ error: true }));
  }
});
show(await chrome.runtime.sendMessage({ command: 'status' }));

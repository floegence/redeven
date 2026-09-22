// Shared application chrome; each backend remains the owner of its commands and state.
function createHostApplicationToolbar() {
  const controls = document.createElement('header');
  controls.className = 'mac-app-controls';
  controls.hidden = true;
  controls.setAttribute('data-floe-surface-divider', '');
  const toolbar = document.createElement('div');
  toolbar.className = 'mac-app-toolbar';
  toolbar.setAttribute('role', 'toolbar');
  hostApplicationAppearance.copy(toolbar, 'controls', 'aria-label');
  function toolbarButton(className, key, path) {
    const button = document.createElement('button');
    button.className = className;
    hostApplicationAppearance.copy(button, key, 'title');
    hostApplicationAppearance.copy(button, key, 'aria-label');
    button.innerHTML = `<svg viewBox="0 0 20 20" fill="none" aria-hidden="true">${path}</svg>`;
    const text = document.createElement('span');
    text.className = 'mac-app-toolbar-label';
    hostApplicationAppearance.copy(text, key);
    button.append(text);
    return button;
  }
  const close = toolbarButton('mac-app-close', 'closeWindow', '<rect x="2.5" y="3.5" width="15" height="13" rx="2"/><path d="M3 7h14m-9 3 4 4m0-4-4 4"/>');
  const quit = toolbarButton('mac-app-quit', 'quit', '<path d="M10 2v8m-4-6a7 7 0 1 0 8 0"/>');
  const menu = toolbarButton('mac-app-menu-toggle', 'menu', '<rect x="3" y="3" width="14" height="14" rx="3"/><path d="M3 7h14M7 7v10"/>');
  menu.removeAttribute('data-app-copy-title');
  menu.removeAttribute('data-app-copy-aria-label');
  menu.querySelector('span').removeAttribute('data-app-copy');
  menu.querySelector('span').textContent = document.title;
  const chevron = '<svg class="mac-app-dropdown-chevron" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m5 8 5 5 5-5"/></svg>';
  menu.insertAdjacentHTML('beforeend', chevron);
  const controlsButton = toolbarButton('mac-app-controls-toggle', 'picture', '<path d="M4 3v4m0 4v6m6-14v8m0 4v2m6-14v2m0 4v8M2 7h4m2 8h4m2-10h4"/>');
  controlsButton.insertAdjacentHTML('beforeend', chevron);
  const windowToggle = toolbarButton('mac-app-windows-toggle', 'windows', '<rect x="3" y="7" width="11" height="10" rx="2"/><path d="M7 4V3h10v10h-1"/>');
  windowToggle.querySelector('span').removeAttribute('data-app-copy');
  windowToggle.removeAttribute('data-app-copy-title');
  windowToggle.removeAttribute('data-app-copy-aria-label');
  const windowCount = document.createElement('span');
  windowCount.className = 'mac-app-window-count';
  windowCount.setAttribute('aria-hidden', 'true');
  windowToggle.append(windowCount);
  windowToggle.insertAdjacentHTML('beforeend', chevron);
  const popover = document.createElement('div');
  popover.id = 'application-controls';
  popover.className = 'mac-app-popover';
  popover.dataset.floeSurface = 'floating';
  popover.hidden = true;
  const menuPanel = document.createElement('div');
  menuPanel.className = 'mac-app-menu';
  menuPanel.hidden = true;
  menuPanel.setAttribute('role', 'menu');
  hostApplicationAppearance.copy(menuPanel, 'menu', 'aria-label');
  const windowPanel = document.createElement('section');
  windowPanel.className = 'mac-app-window-picker';
  windowPanel.hidden = true;
  hostApplicationAppearance.copy(windowPanel, 'windows', 'aria-label');
  const windowTitle = document.createElement('strong');
  hostApplicationAppearance.copy(windowTitle, 'windows');
  const windowList = document.createElement('div');
  windowList.className = 'mac-app-window-list';
  windowPanel.append(windowTitle, windowList);
  const quitPanel = document.createElement('section');
  quitPanel.className = 'mac-app-quit-confirmation';
  quitPanel.hidden = true;
  quitPanel.setAttribute('role', 'dialog');
  quitPanel.setAttribute('aria-labelledby', 'quit-title');
  quitPanel.setAttribute('aria-describedby', 'quit-description');
  const quitTitle = document.createElement('strong');
  quitTitle.id = 'quit-title';
  hostApplicationAppearance.copy(quitTitle, 'quitTitle');
  const quitDescription = document.createElement('p');
  quitDescription.id = 'quit-description';
  hostApplicationAppearance.copy(quitDescription, 'quitDescription');
  const quitActions = document.createElement('div');
  quitActions.className = 'mac-app-confirm-actions';
  const cancelQuit = document.createElement('button');
  hostApplicationAppearance.copy(cancelQuit, 'cancel');
  const confirmQuit = document.createElement('button');
  hostApplicationAppearance.copy(confirmQuit, 'quit');
  confirmQuit.className = 'mac-app-confirm-quit';
  quitActions.append(cancelQuit, confirmQuit);
  quitPanel.append(quitTitle, quitDescription, quitActions);
  const separator = document.createElement('span');
  separator.className = 'mac-app-toolbar-separator';
  separator.setAttribute('aria-hidden', 'true');
  const identitySeparator = separator.cloneNode();
  identitySeparator.classList.add('mac-app-identity-separator');
  const spacer = document.createElement('span');
  spacer.className = 'mac-app-toolbar-spacer';
  spacer.setAttribute('aria-hidden', 'true');
  toolbar.append(menu, identitySeparator, windowToggle, spacer, controlsButton, separator, close, quit);
  controls.append(toolbar, popover);
  document.body.append(controls);
  return { controls, toolbar, menu, windowToggle, windowCount, controlsButton, close, quit, popover, menuPanel, windowPanel, windowList, quitPanel, cancelQuit, confirmQuit, chevron };
}

function createHostApplicationPictureModes(picture, changed) {
  const modeButtons = new Map();
  const modes = document.createElement('div');
  modes.className = 'mac-app-picture-modes';
  modes.setAttribute('role', 'group');
  hostApplicationAppearance.copy(modes, 'picture', 'aria-label');
  for (const mode of ['auto', 'clarity', 'smooth', 'data']) {
    const button = document.createElement('button');
    button.dataset.pictureMode = mode;
    const label = document.createElement('span');
    hostApplicationAppearance.copy(label, 'picture' + mode[0].toUpperCase() + mode.slice(1));
    button.append(label);
    button.insertAdjacentHTML('beforeend', '<svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m4 10 4 4 8-8"/></svg>');
    button.setAttribute('aria-pressed', String(picture.mode === mode));
    button.onclick = () => {
      picture.mode = mode;
      for (const [value, control] of modeButtons) control.setAttribute('aria-pressed', String(value === mode));
      changed();
    };
    modeButtons.set(mode, button); modes.append(button);
  }
  modes.addEventListener('keydown', event => {
    const buttons = [...modeButtons.values()];
    const index = buttons.indexOf(document.activeElement);
    const offset = {ArrowRight:1, ArrowLeft:-1, ArrowDown:2, ArrowUp:-2}[event.key];
    const next = event.key === 'Home' ? buttons[0] : event.key === 'End' ? buttons.at(-1)
      : offset && index >= 0 ? buttons[(index + offset + buttons.length) % buttons.length] : null;
    if (next) { event.preventDefault(); next.focus(); }
  });
  return {modes, modeButtons};
}

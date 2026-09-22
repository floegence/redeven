// The document consumes published theme CSS and explicit Env App dictionaries.
// Presentation updates preserve controls, connection, selection and input focus.
const hostApplicationAppearance = (() => {
  const root = document.documentElement;
  const listeners = new Set();
  let locale = config.copy.locale || root.lang;
  function copy(element, key, attribute) {
    element.setAttribute('data-app-copy' + (attribute ? '-' + attribute : ''), key);
    if (attribute) element.setAttribute(attribute, config.copy[key] || '');
    else element.textContent = config.copy[key] || '';
    return element;
  }
  function refreshCopy() {
    for (const attribute of [null, 'title', 'aria-label']) {
      const binding = 'data-app-copy' + (attribute ? '-' + attribute : '');
      for (const element of document.querySelectorAll(`[${binding}]`)) {
        const text = config.copy[element.getAttribute(binding)] || '';
        if (attribute) element.setAttribute(attribute, text); else element.textContent = text;
      }
    }
  }
  function apply() {
    const mode = hostApplicationCatalog.themes[root.dataset.floeShellTheme];
    if (mode) { root.classList.toggle('dark', mode === 'dark'); root.classList.toggle('light', mode === 'light'); root.style.colorScheme = mode; }
    const messages = hostApplicationCatalog.locales[root.lang];
    if (messages && root.lang !== locale) {
      locale = root.lang;
      config.copy = {...config.copy, ...messages, locale,
        quitTitle: messages.quitTitle.replaceAll('{name}', document.title),
        quitDescription: messages[config.backend === 'macos' ? 'quitDescription' : 'sessionQuitDescription'],
        pictureHint: messages[config.backend === 'macos' ? 'pictureHint' : 'sessionPictureHint']};
    }
    refreshCopy();
    for (const listener of listeners) listener();
  }
  const preferred = config.copy.shellTheme;
  if (!hostApplicationCatalog.themes[root.dataset.floeShellTheme]) root.dataset.floeShellTheme = hostApplicationCatalog.themes[preferred] ? preferred
    : hostApplicationCatalog.defaults[matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'];
  root.dataset.floeSurfaceStyle = 'soft-neumorphic';
  if (!root.lang) root.lang = config.copy.locale;
  apply();
  new MutationObserver(apply).observe(root, {attributes:true, attributeFilter:['lang', 'data-floe-shell-theme']});
  return {copy, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); }, number: (value, digits = 0) => new Intl.NumberFormat(root.lang || undefined, {minimumFractionDigits:digits, maximumFractionDigits:digits}).format(value)};
})();

// JackHack Prime — injector.js
// Injects page-level script and bridges messages to popup via storage
(function () {
  const s = document.createElement('script');
  s.src = chrome.runtime.getURL('injected.js');
  s.onload = () => s.remove();
  (document.head || document.documentElement).appendChild(s);

  // Relay game data → storage
  window.addEventListener('JHP_DATA', (e) => {
    chrome.storage.local.set({ jhp_data: e.detail });
  });

  // Relay features → page
  chrome.storage.local.get('jhp_features', ({ jhp_features }) => {
    if (jhp_features) {
      window.dispatchEvent(new CustomEvent('JHP_FEATURES', { detail: jhp_features }));
    }
  });

  // Watch for feature changes from popup
  chrome.storage.onChanged.addListener((changes) => {
    if (changes.jhp_features) {
      window.dispatchEvent(new CustomEvent('JHP_FEATURES', {
        detail: changes.jhp_features.newValue
      }));
    }
  });
})();

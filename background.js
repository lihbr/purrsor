// Purrsor - Background Service Worker
// Handles extension initialization and default configuration

// Load default cursor values from default.json
async function loadDefaults() {
  const response = await fetch(chrome.runtime.getURL('default.json'));
  const defaults = await response.json();
  return defaults;
}

// Initialize extension on install
chrome.runtime.onInstalled.addListener(async (details) => {
  if (details.reason === 'install') {
    // Load defaults from JSON file
    const defaults = await loadDefaults();
    
    // Set default cursor configurations (using local storage due to sync's 8KB per-item limit)
    await chrome.storage.local.set({
      cursorDefault: defaults.default,
      cursorInteractive: defaults.interactive
    });

    // Initialize empty disabled sites list
    await chrome.storage.local.set({
      disabledSites: []
    });

    console.log('Purrsor: Extension installed with default cursors');
  }
});

// Insertions and removals run one at a time, in the order content scripts
// sent them, so a removal never overtakes the insertion it undoes.
let cssQueue = Promise.resolve();

function setCursorCss({ css, previous }, sender) {
  const target = { tabId: sender.tab.id, documentIds: [sender.documentId] };
  cssQueue = cssQueue
    .then(async () => {
      if (previous) await chrome.scripting.removeCSS({ target, css: previous, origin: 'USER' });
      if (css) await chrome.scripting.insertCSS({ target, css, origin: 'USER' });
    })
    // The document can be gone by now (navigation, closed tab). Nothing to style.
    .catch(() => {});
}

// Listen for messages from popup or content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'setCursorCss') {
    setCursorCss(message, sender);
    return false;
  }

  if (message.action === 'getDefaults') {
    loadDefaults().then(defaults => {
      sendResponse(defaults);
    });
    return true; // Keep channel open for async response
  }
  
  if (message.action === 'resetToDefaults') {
    loadDefaults().then(async (defaults) => {
      await chrome.storage.local.set({
        cursorDefault: defaults.default,
        cursorInteractive: defaults.interactive
      });
      sendResponse({ success: true });
    });
    return true;
  }
});

// Update badge when site is disabled
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && changes.disabledSites) {
    // Could update badge here if needed
  }
});

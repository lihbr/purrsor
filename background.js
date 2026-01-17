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

// Listen for messages from popup or content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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

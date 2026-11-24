// Purrsor - helpers shared by the popup and the Settings page

const $ = (id) => document.getElementById(id);

const SWITCHES = { enabledToggle: 'enabled', soundToggle: 'soundEnabled', slapToggle: 'slapEnabled', shrinkToggle: 'shrinkEnabled' };

for (const [id, key] of Object.entries(SWITCHES)) {
  $(id)?.addEventListener('change', (event) => chrome.storage.local.set({ [key]: event.target.checked }));
}

// Each setting is on unless stored as false.
async function showSwitches() {
  const stored = await chrome.storage.local.get(Object.values(SWITCHES));
  for (const [id, key] of Object.entries(SWITCHES)) {
    if ($(id)) $(id).checked = stored[key] !== false;
  }
}

async function getShortcuts() {
  const commands = await chrome.commands.getAll();
  return Object.fromEntries(commands.map((command) => [command.name, command.shortcut || '']));
}

function openManagePage() {
  chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
}

const IS_MAC = /mac/i.test(navigator.userAgentData?.platform ?? navigator.platform);
const SLAP_KEYS = IS_MAC ? { click: '⌥-click', undo: '⌥Z' } : { click: 'Alt-click', undo: 'Alt+Z' };

// Purrsor - Background Service Worker

importScripts('shared/templates.js');

// The cursor values Purrsor 1.0.0 stored on install, as SHA-256 hashes.
// Anything else was typed into its popup.
const V1_DEFAULT_CURSORS = [
  'bec956bad0b30f4c3e95b93687f7cfca45b85d62fe38ec3975d84b1c83e8e8e0',
  '7ad1404ee5648413d03aa4b1cd189704596751a1bd95e435fba7e9765f91b1ca',
];

async function sha256(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  if (reason === 'install') await useTemplate(BUILTIN);
  if (reason !== 'update') return;

  const { templateId, cursorDefault, cursorInteractive } = await chrome.storage.local.get(['templateId', 'cursorDefault', 'cursorInteractive']);
  // 1.0.0 had no templates, and its second cursor showed over clickable things.
  if (templateId === undefined && cursorDefault && cursorInteractive) {
    const hashes = await Promise.all([sha256(cursorDefault.trim()), sha256(cursorInteractive.trim())]);
    if (hashes.join() !== V1_DEFAULT_CURSORS.join()) {
      await chrome.storage.local.set({
        templateId: CUSTOM_CSS_ID,
        customCursor: { cursorDefault, cursorInteractive, cursorClick: cursorInteractive },
      });
    }
  }
  // Bongo Cat's pictures, and how cursors are drawn, can change between versions.
  await useCurrentTemplate();
});

// Insertions and removals run one at a time, in the order content scripts
// sent them, so a removal never overtakes the insertion it undoes.
let cssQueue = Promise.resolve();

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.action === 'unslap') chrome.tabs.sendMessage(sender.tab.id, message);
  if (message.action !== 'setCursorCss') return;

  const target = { tabId: sender.tab.id, documentIds: [sender.documentId] };
  cssQueue = cssQueue
    .then(async () => {
      if (message.previous) await chrome.scripting.removeCSS({ target, css: message.previous, origin: 'USER' });
      if (message.css) await chrome.scripting.insertCSS({ target, css: message.css, origin: 'USER' });
    })
    // The document can be gone by now (navigation, closed tab).
    .catch(() => {});
});

// Presses run one at a time, so two quick ones never read the same value and
// cancel out to a single flip.
const COMMAND_SETTINGS = { 'toggle-enabled': 'enabled', 'toggle-sound': 'soundEnabled' };
let toggles = Promise.resolve();

chrome.commands.onCommand.addListener((command) => {
  const key = COMMAND_SETTINGS[command];
  if (!key) return;
  toggles = toggles.then(async () => {
    const { [key]: value } = await chrome.storage.local.get(key);
    await chrome.storage.local.set({ [key]: value === false });
  });
});

// The toolbar icon is the only feedback a shortcut press gets.
async function showState() {
  const { enabled, soundEnabled } = await chrome.storage.local.get(['enabled', 'soundEnabled']);
  const off = enabled === false ? '-off' : '';
  chrome.action.setIcon({ path: { 16: `icons/icon16${off}.png`, 48: `icons/icon48${off}.png`, 128: `icons/icon128${off}.png` } });
  chrome.action.setBadgeText({ text: !off && soundEnabled === false ? 'mute' : '' });
}

chrome.action.setBadgeBackgroundColor({ color: '#1f1d1a' });
showState();

chrome.storage.onChanged.addListener((changes) => {
  if (changes.enabled || changes.soundEnabled) showState();
  if (changes.shrinkEnabled) useCurrentTemplate();
});

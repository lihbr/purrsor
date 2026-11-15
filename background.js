// Purrsor - Background Service Worker
// Handles extension initialization and default configuration

importScripts('shared/templates.js');

// Cursor values that Purrsor 1.0.0 stored on install, as SHA-256 hashes.
// Anyone still on them gets Bongo Cat's current images on update.
const V1_DEFAULT_CURSORS = [
  'bec956bad0b30f4c3e95b93687f7cfca45b85d62fe38ec3975d84b1c83e8e8e0',
  '7ad1404ee5648413d03aa4b1cd189704596751a1bd95e435fba7e9765f91b1ca',
];

async function sha256(text) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

// True when the stored cursors are ones the person typed in 1.0.0's popup.
async function hasOwnCursorCss({ cursorDefault, cursorInteractive }, builtin) {
  if (!cursorDefault || !cursorInteractive) return false;
  if (cursorDefault === builtin.cursorDefault && cursorInteractive === builtin.cursorInteractive) return false;
  const hashes = await Promise.all([sha256(cursorDefault.trim()), sha256(cursorInteractive.trim())]);
  return hashes.join() !== V1_DEFAULT_CURSORS.join();
}

async function setUp({ reason }) {
  if (reason !== 'install' && reason !== 'update') return;
  const builtin = await loadBuiltinTemplate();
  const stored = await chrome.storage.local.get(['templateId', 'cursorDefault', 'cursorInteractive', 'cursorWindup', 'disabledSites']);

  if (reason === 'install') {
    await chrome.storage.local.set({ disabledSites: [] });
    await useTemplate(builtin);
  } else if (stored.templateId === undefined && await hasOwnCursorCss(stored, builtin)) {
    // Updated from 1.0.0 with cursor CSS of their own: keep it.
    const customCursor = { cursorDefault: stored.cursorDefault, cursorInteractive: stored.cursorInteractive };
    await chrome.storage.local.set({ customCursor });
    await useTemplate({ id: CUSTOM_CSS_ID, ...customCursor });
  } else if (stored.templateId === undefined || stored.templateId === BUILTIN_ID) {
    // Bongo Cat's images can change between versions.
    await useTemplate(builtin);
  } else if (stored.cursorWindup === undefined) {
    // A template chosen before the wind-up cursor existed.
    await chrome.storage.local.set({ cursorWindup: await windupCursor(stored.cursorDefault).catch(() => '') });
  }
}

chrome.runtime.onInstalled.addListener(setUp);

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

// Option-Z takes back the last slap in a tab, whichever frame it landed in.
// Each frame keeps its own pushes; this keeps the order of the frames slapped,
// per tab, in session storage so it outlives the service worker going idle.
// Frames keep their last 20 slaps, so the list keeps as many.
const SLAP_HISTORY = 20;
let slapQueue = Promise.resolve();

function slapHistory(tabId, change) {
  const key = `slaps:${tabId}`;
  slapQueue = slapQueue
    .then(async () => {
      const { [key]: frames = [] } = await chrome.storage.session.get(key);
      await change(frames);
      await chrome.storage.session.set({ [key]: frames.slice(-SLAP_HISTORY) });
    })
    .catch(() => {});
}

function recordSlap(tabId, frameId) {
  slapHistory(tabId, (frames) => frames.push(frameId));
}

function undoSlap(tabId) {
  slapHistory(tabId, async (frames) => {
    // A frame that has reloaded since has nothing to take back; the one
    // before it might.
    while (frames.length) {
      const undone = await chrome.tabs.sendMessage(tabId, { action: 'unslap' }, { frameId: frames.pop() })
        .catch(() => false);
      if (undone) break;
    }
  });
}

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(`slaps:${tabId}`);
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.action === 'setCursorCss') setCursorCss(message, sender);
  if (message.action === 'slapped') recordSlap(sender.tab.id, sender.frameId);
  if (message.action === 'unslap') undoSlap(sender.tab.id);
});

// Each shortcut flips a setting that is on unless stored as false. Presses run
// one at a time, so two quick ones never read the same value and cancel out
// to a single flip.
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

// The toolbar icon is the only feedback a shortcut press gets: grey while
// Purrsor is off, and a "mute" badge while it is on without sound.
const ICON_SIZES = [16, 48, 128];

function showState({ enabled, soundEnabled }) {
  const off = enabled === false;
  chrome.action.setIcon({
    path: Object.fromEntries(ICON_SIZES.map((size) => [size, `icons/icon${size}${off ? '-off' : ''}.png`])),
  });
  chrome.action.setBadgeText({ text: !off && soundEnabled === false ? 'mute' : '' });
}

chrome.action.setBadgeBackgroundColor({ color: '#1f1d1a' });
chrome.storage.local.get(['enabled', 'soundEnabled']).then(showState);

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === 'local' && (changes.enabled || changes.soundEnabled)) {
    chrome.storage.local.get(['enabled', 'soundEnabled']).then(showState);
  }
});

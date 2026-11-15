// Purrsor - helpers shared by the popup and the Settings page

// Keyboard shortcuts by command name, as the browser shows them (for example
// "⌥⇧B"). A command without one maps to ''.
async function getShortcuts() {
  const commands = await chrome.commands.getAll();
  return Object.fromEntries(commands.map((command) => [command.name, command.shortcut || '']));
}

// Extensions can read their shortcuts but not set them, so changing one means
// opening the browser's own shortcuts page.
function openShortcutsPage() {
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
}

function openManagePage() {
  chrome.tabs.create({ url: `chrome://extensions/?id=${chrome.runtime.id}` });
}

// Settings that are on unless stored as false.
async function getSwitches() {
  const { enabled, soundEnabled, slapEnabled } = await chrome.storage.local.get(['enabled', 'soundEnabled', 'slapEnabled']);
  return { enabled: enabled !== false, soundEnabled: soundEnabled !== false, slapEnabled: slapEnabled !== false };
}

// The slap's keys as the keyboard labels them: Option on a Mac, Alt elsewhere.
const IS_MAC = /mac/i.test(navigator.userAgentData?.platform ?? navigator.platform);
const SLAP_KEYS = IS_MAC ? { click: '⌥-click', undo: '⌥Z' } : { click: 'Alt-click', undo: 'Alt+Z' };

// Plays a template's click sound, or the bongo, from a click in an extension page.
let pageAudio;
const pageSounds = new Map();

async function playTemplateSound(templateId) {
  pageAudio ??= new AudioContext();
  if (!pageSounds.has(templateId)) {
    pageSounds.set(templateId, (async () => {
      const data = await loadTemplateSound(templateId)
        ?? await (await fetch(chrome.runtime.getURL('sounds/bongo.mp3'))).arrayBuffer();
      return pageAudio.decodeAudioData(data);
    })());
  }
  const source = pageAudio.createBufferSource();
  source.buffer = await pageSounds.get(templateId);
  source.connect(pageAudio.destination);
  source.start();
}

function forgetTemplateSound(templateId) {
  pageSounds.delete(templateId);
}

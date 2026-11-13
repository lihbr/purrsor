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
  const { enabled, soundEnabled } = await chrome.storage.local.get(['enabled', 'soundEnabled']);
  return { enabled: enabled !== false, soundEnabled: soundEnabled !== false };
}

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

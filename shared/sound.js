// Purrsor - click sounds, shared by pages, the popup and the Settings page.

let audio;
const sounds = new Map(); // template id → Promise<AudioBuffer>

function decodeSound(dataUrl) {
  // Called from a click, whose user activation lets the context start.
  audio ??= new AudioContext();
  const bytes = Uint8Array.from(atob(dataUrl.slice(dataUrl.indexOf(',') + 1)), (c) => c.charCodeAt(0));
  return audio.decodeAudioData(bytes.buffer);
}

function playBuffer(buffer) {
  const source = audio.createBufferSource();
  source.buffer = buffer;
  source.connect(audio.destination);
  source.start();
}

async function loadSound(templateId) {
  const key = `sound:${templateId}`;
  const { [key]: own } = await chrome.storage.local.get(key);
  if (own) return decodeSound(own);
  audio ??= new AudioContext();
  // Chromium exempts the extension's own URLs from the page's CSP.
  const bongo = await fetch(chrome.runtime.getURL('sounds/bongo.mp3'));
  return audio.decodeAudioData(await bongo.arrayBuffer());
}

function playSound(templateId) {
  if (!sounds.has(templateId)) sounds.set(templateId, loadSound(templateId));
  // Loading fails when the extension was reloaded under this page.
  sounds.get(templateId).then(playBuffer, () => sounds.delete(templateId));
}

chrome.storage.onChanged.addListener((changes) => {
  for (const key of Object.keys(changes)) {
    if (key.startsWith('sound:')) sounds.delete(key.slice('sound:'.length));
  }
});

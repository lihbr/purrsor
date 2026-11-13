// Purrsor - Content Script
// Asks the service worker to insert the cursor styles into this document

// Set on <html> while the primary mouse button is held.
const PRESSED_ATTR = 'data-purrsor-pressed';

const BONGO_URL = chrome.runtime.getURL('sounds/bongo.mp3');

let enabled = false;
let insertedCss = null;
let soundEnabled = true;
let templateId;
let audioContext;
let clickSound; // Promise<AudioBuffer>, decoded on the first click

// Get current hostname
function getHostname() {
  return window.location.hostname;
}

// Ensure cursor value has !important
function ensureImportant(value) {
  if (!value) return value;
  const trimmed = value.trim();
  if (trimmed.toLowerCase().endsWith('!important')) {
    return trimmed;
  }
  return `${trimmed} !important`;
}

// Generate CSS for cursor overrides. Every element gets the cursor directly
// rather than inheriting it from body, because a site's own `cursor: pointer`
// on an element beats an inherited value.
function generateCSS(cursorDefault, cursorInteractive) {
  const defaultValue = ensureImportant(cursorDefault);
  const interactiveValue = ensureImportant(cursorInteractive);

  return `
/* Purrsor - Custom Cursor Styles */
:root, :root * {
  cursor: ${defaultValue};
}

:root[${PRESSED_ATTR}], :root[${PRESSED_ATTR}] * {
  cursor: ${interactiveValue};
}
`;
}

// The same rules for inside shadow roots, which the document's stylesheet
// doesn't reach. :host-context() sees the pressed attribute on <html>.
function generateShadowCSS(cursorDefault, cursorInteractive) {
  return `
* {
  cursor: ${ensureImportant(cursorDefault)};
}

:host-context([${PRESSED_ATTR}]) * {
  cursor: ${ensureImportant(cursorInteractive)};
}
`;
}

function press(event) {
  if (!hold(event)) return;
  if (soundEnabled) playClickSound();
}

// Shows the slap without the sound. Returns false when this press doesn't count.
function hold(event) {
  if (!enabled || event.pointerType === 'touch') return false;
  const root = document.documentElement;
  // Called on every move during a drag; leave pages' attribute observers quiet.
  if (!root.hasAttribute(PRESSED_ATTR)) root.setAttribute(PRESSED_ATTR, '');
  return true;
}

// The template's own sound, or the bongo when it has none.
async function loadClickSound() {
  const key = `sound:${templateId}`;
  const { [key]: sound } = await chrome.storage.local.get(key);
  if (sound) return Uint8Array.from(atob(sound.data), (c) => c.charCodeAt(0)).buffer;
  const response = await fetch(BONGO_URL);
  return response.arrayBuffer();
}

// The AudioContext is created inside the pointerdown handler, which carries
// user activation, so autoplay policy lets it start.
function playClickSound() {
  audioContext ??= new AudioContext();
  clickSound ??= loadClickSound().then((data) => audioContext.decodeAudioData(data));
  clickSound.then(
    (buffer) => {
      const source = audioContext.createBufferSource();
      source.buffer = buffer;
      source.connect(audioContext.destination);
      source.start();
    },
    // Fails when the extension was reloaded under this page; retry next click.
    () => { clickSound = undefined; }
  );
}

function release() {
  document.documentElement?.removeAttribute(PRESSED_ATTR);
}

// While another button is held, a left press or release fires pointermove
// with button 0 instead of pointerdown or pointerup. A press or release in
// another frame never reaches this one, so any other move takes the left
// button's state from `buttons`: held means the slap, without the sound.
function track(event) {
  if (event.button === 0) {
    if (event.buttons & 1) press(event);
    else release();
  } else if (event.buttons & 1) {
    hold(event);
  } else {
    release();
  }
}

window.addEventListener('pointerdown', (event) => {
  if (event.button === 0) press(event);
}, true);
window.addEventListener('pointermove', track, true);
window.addEventListener('pointerup', release, true);
window.addEventListener('pointercancel', release, true);
window.addEventListener('dragend', release, true);
window.addEventListener('blur', release);

// The service worker inserts the CSS with chrome.scripting.insertCSS as a
// user-origin stylesheet. User !important beats every author rule, including a
// site's own !important, and the sheet lives outside the DOM, so a page that
// rewrites <head> cannot remove it. `css` is null to remove the styles.
function setStyles(css) {
  if (css === insertedCss) return;
  const previous = insertedCss;
  insertedCss = css;
  chrome.runtime.sendMessage({ action: 'setCursorCss', css, previous });
}

// Chromium doesn't apply user stylesheets inside shadow roots, so every shadow
// root also adopts shadowSheet. chrome.dom reaches closed roots as well.
const shadowSheet = new CSSStyleSheet();
const shadowRoots = new WeakSet();
let watchingShadowRoots = false;

const shadowObserver = new MutationObserver((records) => {
  for (const record of records) {
    for (const node of record.addedNodes) {
      if (node.nodeType === Node.ELEMENT_NODE) findShadowRoots(node);
    }
  }
});

// el.shadowRoot sees open roots only. chrome.dom sees closed ones too but costs
// about 50 times more per call, so scans ask it only about custom elements,
// which host nearly every closed root. The pointerover check covers the rest.
function scannedShadowRoot(el) {
  if (el.shadowRoot) return el.shadowRoot;
  if (el.localName.includes('-') && el instanceof HTMLElement) {
    return chrome.dom.openOrClosedShadowRoot(el);
  }
  return null;
}

function findShadowRoots(node) {
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_ELEMENT);
  for (let el = walker.currentNode; el; el = walker.nextNode()) {
    if (el.nodeType === Node.ELEMENT_NODE) adoptShadowRoot(scannedShadowRoot(el));
  }
}

function adoptShadowRoot(root) {
  if (!root) return;
  // Checked every time: a component can replace its adoptedStyleSheets.
  if (!root.adoptedStyleSheets.includes(shadowSheet)) {
    root.adoptedStyleSheets = [...root.adoptedStyleSheets, shadowSheet];
  }
  if (shadowRoots.has(root)) return;
  shadowRoots.add(root);
  shadowObserver.observe(root, { childList: true, subtree: true });
  findShadowRoots(root);
}

function watchShadowRoots() {
  if (watchingShadowRoots) return;
  watchingShadowRoots = true;
  shadowObserver.observe(document, { childList: true, subtree: true });
  findShadowRoots(document);
  // A custom element defined after the parser created it attaches its shadow
  // root without a DOM mutation, so look again once parsing is done.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => findShadowRoots(document), { once: true });
  }
}

// Catches a shadow root attached later still, when the pointer first enters it.
window.addEventListener('pointerover', (event) => {
  if (!watchingShadowRoots) return;
  for (const node of event.composedPath()) {
    if (node instanceof HTMLElement) adoptShadowRoot(chrome.dom.openOrClosedShadowRoot(node));
  }
}, true);

// Check if current site is disabled
async function isSiteDisabled() {
  const hostname = getHostname();
  const result = await chrome.storage.local.get('disabledSites');
  const disabledSites = result.disabledSites || [];
  return disabledSites.includes(hostname);
}

// Load and apply cursor styles
async function applyCursors() {
  const { enabled: enabledEverywhere } = await chrome.storage.local.get('enabled');

  if (enabledEverywhere === false || await isSiteDisabled()) {
    enabled = false;
    release();
    setStyles(null);
    shadowSheet.replaceSync('');
    return;
  }

  // Get cursor configurations
  const config = await chrome.storage.local.get(['cursorDefault', 'cursorInteractive', 'soundEnabled', 'templateId']);
  soundEnabled = config.soundEnabled !== false;
  if (config.templateId !== templateId) {
    templateId = config.templateId;
    clickSound = undefined;
  }
  
  if (config.cursorDefault && config.cursorInteractive) {
    enabled = true;
    setStyles(generateCSS(config.cursorDefault, config.cursorInteractive));
    shadowSheet.replaceSync(generateShadowCSS(config.cursorDefault, config.cursorInteractive));
    watchShadowRoots();
  }
}

const SETTINGS = ['enabled', 'cursorDefault', 'cursorInteractive', 'disabledSites', 'soundEnabled', 'templateId'];

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  // The template in use got a new sound, or lost it.
  if (changes[`sound:${templateId}`]) clickSound = undefined;
  if (SETTINGS.some((key) => changes[key])) applyCursors();
});

// Initial application
applyCursors();

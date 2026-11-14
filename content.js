// Purrsor - Content Script
// Asks the service worker to insert the cursor styles into this document

// Set on <html> while the primary mouse button is held.
const PRESSED_ATTR = 'data-purrsor-pressed';
// Set on <html> while Option (Alt) is held over the page, ready to slap.
const WINDUP_ATTR = 'data-purrsor-windup';

const BONGO_URL = chrome.runtime.getURL('sounds/bongo.mp3');

let enabled = false;
let insertedCss = null;
let soundEnabled = true;
let templateId;
let audioContext;
let clickSound; // Promise<AudioBuffer>, decoded on the first click
let slapEnabled = true;

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
// The pressed rule comes last, so a click while winding up shows the slap.
function generateCSS(cursorDefault, cursorInteractive, cursorWindup) {
  const defaultValue = ensureImportant(cursorDefault);
  const interactiveValue = ensureImportant(cursorInteractive);
  const windupRule = cursorWindup ? `
:root[${WINDUP_ATTR}], :root[${WINDUP_ATTR}] * {
  cursor: ${ensureImportant(cursorWindup)};
}
` : '';

  return `
/* Purrsor - Custom Cursor Styles */
:root, :root * {
  cursor: ${defaultValue};
}
${windupRule}
:root[${PRESSED_ATTR}], :root[${PRESSED_ATTR}] * {
  cursor: ${interactiveValue};
}
`;
}

// The same rules for inside shadow roots, which the document's stylesheet
// doesn't reach. :host-context() sees the pressed attribute on <html>.
function generateShadowCSS(cursorDefault, cursorInteractive, cursorWindup) {
  const windupRule = cursorWindup ? `
:host-context([${WINDUP_ATTR}]) * {
  cursor: ${ensureImportant(cursorWindup)};
}
` : '';
  return `
* {
  cursor: ${ensureImportant(cursorDefault)};
}
${windupRule}
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
  if (event.button !== 0) return;
  // A new press starts a new click, even if the last slap's release never came.
  unmute();
  press(event);
  if (!canSlap(event)) return;
  swallow(event);
  muteClick();
  windUp(false);
  if (Slap.at(event.clientX, event.clientY)) chrome.runtime.sendMessage({ action: 'slapped' });
}, true);
window.addEventListener('pointermove', track, true);
window.addEventListener('pointerup', release, true);
window.addEventListener('pointercancel', release, true);
window.addEventListener('dragend', release, true);
window.addEventListener('blur', release);

function isEditable(target) {
  return Boolean(target?.isContentEditable) || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? '');
}

// Option-click (Alt-click) slaps, except in text fields, where editors use it
// for things like extra cursors.
function canSlap(event) {
  return enabled && slapEnabled && event.altKey && event.isTrusted
    && event.pointerType !== 'touch' && !isEditable(event.composedPath()[0]);
}

function swallow(event) {
  event.preventDefault();
  event.stopImmediatePropagation();
}

// The page sees nothing of a click that slaps: no focus, selection, drag,
// button or link, which Option-click would otherwise download. The rest of
// the click arrives right after pointerup, in the same task.
let muted = false;
let muteTimer = 0;

function muteClick() {
  muted = true;
  clearTimeout(muteTimer);
  muteTimer = setTimeout(unmute, 10000);
}

function unmute() {
  muted = false;
  clearTimeout(muteTimer);
}

for (const type of ['pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'selectstart', 'dragstart']) {
  window.addEventListener(type, (event) => {
    if (!muted) return;
    swallow(event);
    if (type === 'pointerup') {
      clearTimeout(muteTimer);
      muteTimer = setTimeout(unmute);
    }
  }, true);
}

// While Option is held over the page, the cat leans back to wind up.
let pointerHere = false;
let pointerTarget = null;

function windUp(on) {
  const root = document.documentElement;
  if (!root) return;
  if (!on || !enabled || !slapEnabled || isEditable(pointerTarget)) {
    root.removeAttribute(WINDUP_ATTR);
    return;
  }
  if (!root.hasAttribute(WINDUP_ATTR)) root.setAttribute(WINDUP_ATTR, '');
}

window.addEventListener('pointermove', (event) => {
  pointerHere = true;
  pointerTarget = event.composedPath()[0];
  windUp(event.altKey);
}, true);

window.addEventListener('pointerout', (event) => {
  if (!event.relatedTarget) pointerHere = false;
}, true);

window.addEventListener('keydown', (event) => {
  if (!event.isTrusted) return;
  if (event.key === 'Alt') windUp(pointerHere);
  // Option-Z takes back the last slap in this tab, in whichever frame it was.
  if (event.code === 'KeyZ' && event.altKey && !event.metaKey && !event.ctrlKey
    && enabled && slapEnabled && !isEditable(event.composedPath()[0])) {
    swallow(event);
    chrome.runtime.sendMessage({ action: 'unslap' });
  }
}, true);

window.addEventListener('keyup', (event) => {
  if (event.key === 'Alt') windUp(false);
}, true);

window.addEventListener('blur', () => windUp(false));

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'unslap') sendResponse(Slap.undo());
});

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
    windUp(false);
    Slap.restoreAll();
    setStyles(null);
    shadowSheet.replaceSync('');
    return;
  }

  // Get cursor configurations
  const config = await chrome.storage.local.get(['cursorDefault', 'cursorInteractive', 'cursorWindup', 'soundEnabled', 'slapEnabled', 'templateId']);
  soundEnabled = config.soundEnabled !== false;
  slapEnabled = config.slapEnabled !== false;
  if (!slapEnabled) {
    windUp(false);
    Slap.restoreAll();
  }
  if (config.templateId !== templateId) {
    templateId = config.templateId;
    clickSound = undefined;
  }
  
  if (config.cursorDefault && config.cursorInteractive) {
    enabled = true;
    const { cursorDefault, cursorInteractive, cursorWindup } = config;
    setStyles(generateCSS(cursorDefault, cursorInteractive, cursorWindup));
    shadowSheet.replaceSync(generateShadowCSS(cursorDefault, cursorInteractive, cursorWindup));
    watchShadowRoots();
  }
}

const SETTINGS = ['enabled', 'cursorDefault', 'cursorInteractive', 'cursorWindup', 'disabledSites', 'soundEnabled', 'slapEnabled', 'templateId'];

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  // The template in use got a new sound, or lost it.
  if (changes[`sound:${templateId}`]) clickSound = undefined;
  if (SETTINGS.some((key) => changes[key])) applyCursors();
});

// Initial application
applyCursors();

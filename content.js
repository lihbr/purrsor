// Purrsor - Content Script

// Set on <html> while the primary mouse button is held.
const PRESSED_ATTR = 'data-purrsor-pressed';
// Set on <html> while Option (Alt) is held over the page, ready to slap.
const WINDUP_ATTR = 'data-purrsor-windup';

const CLICKABLE = [
  'a',
  'button',
  '[role="button"]',
  '[role="link"]',
  'input[type="button"]',
  'input[type="submit"]',
  'input[type="reset"]',
  'input[type="checkbox"]',
  'input[type="radio"]',
  'input[type="file"]',
  'select',
  'textarea:not(:focus)',
  'label[for]',
  'summary',
  '[onclick]',
  '[onmousedown]',
  '[tabindex]:not([tabindex="-1"])',
  '[contenteditable="true"]:not(:focus)',
  '.btn',
  '.button',
].join(', ');

const SETTINGS = ['enabled', 'disabledSites', 'cursorDefault', 'cursorInteractive', 'cursorClick', 'cursorWindup', 'soundEnabled', 'slapEnabled', 'templateId'];

// What storage holds, or null while Purrsor is off for this page.
let settings = null;
let insertedCss = null;

function important(value) {
  const trimmed = value.trim();
  return trimmed.toLowerCase().endsWith('!important') ? trimmed : `${trimmed} !important`;
}

// A user stylesheet reaches into shadow roots, but its selectors can't look
// out of one for the attributes on <html>. A custom property inherits into
// them, and a style query matches on it. Later rules win, so a press shows
// over a link.
function cursorCss({ cursorDefault, cursorInteractive, cursorClick, cursorWindup }) {
  const rule = (selector, cursor) => (cursor ? `${selector} { cursor: ${important(cursor)}; }\n` : '');
  const when = (attr, cursor) => (cursor
    ? `:root[${attr}] { --${attr}: 1; cursor: ${important(cursor)}; }\n@container style(--${attr}: 1) { ${rule('*', cursor)}}\n`
    : '');
  return rule('*', cursorDefault)
    + rule(`:where(${CLICKABLE}), :where(${CLICKABLE}) *`, cursorInteractive)
    + when(WINDUP_ATTR, cursorWindup)
    + when(PRESSED_ATTR, cursorClick);
}

// While another button is held, a left press or release fires pointermove
// instead of pointerdown or pointerup, and one in another frame never reaches
// this one. Every event's `buttons` tells whether the left button is held.
function trackButton(event) {
  const pressed = Boolean(settings) && event.pointerType !== 'touch' && Boolean(event.buttons & 1);
  document.documentElement.toggleAttribute(PRESSED_ATTR, pressed);
  // `button` is 0 only on the event that pressed it.
  if (pressed && event.button === 0 && settings.soundEnabled !== false) playSound(settings.templateId);
}

for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'dragend']) {
  window.addEventListener(type, trackButton, true);
}
// Not capturing: that would also hear the element a click takes focus from.
window.addEventListener('blur', trackButton);

function isEditable(target) {
  return Boolean(target?.isContentEditable) || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? '');
}

function canSlap(target) {
  return Boolean(settings) && settings.slapEnabled !== false && !isEditable(target);
}

function swallow(event) {
  event.preventDefault();
  event.stopImmediatePropagation();
}

// The page sees nothing of a click that slaps: no focus, selection, drag,
// button or link, which Option-click would otherwise download.
let slapping = false;

window.addEventListener('pointerdown', (event) => {
  slapping = event.button === 0 && event.altKey && event.isTrusted
    && event.pointerType !== 'touch' && canSlap(event.composedPath()[0]);
  if (!slapping) return;
  swallow(event);
  windUp(false);
  Slap.at(event.clientX, event.clientY);
}, true);

for (const type of ['pointerup', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'selectstart', 'dragstart']) {
  window.addEventListener(type, (event) => {
    if (!slapping) return;
    swallow(event);
    // The click arrives right after pointerup, in the same task.
    if (type === 'pointerup') setTimeout(() => { slapping = false; });
  }, true);
}

for (const type of ['pointercancel', 'blur']) {
  window.addEventListener(type, () => { slapping = false; }, true);
}

let hovered = null;

function windUp(on) {
  document.documentElement.toggleAttribute(WINDUP_ATTR, on && canSlap(hovered));
}

window.addEventListener('pointermove', (event) => {
  hovered = event.composedPath()[0];
  windUp(event.altKey);
}, true);

window.addEventListener('keydown', (event) => {
  if (!event.isTrusted) return;
  windUp(event.altKey);
  if (event.code === 'KeyZ' && event.altKey && !event.metaKey && !event.ctrlKey && canSlap(event.composedPath()[0])) {
    swallow(event);
    // The slap may have landed in another frame of this tab.
    chrome.runtime.sendMessage({ action: 'unslap' });
  }
}, true);

window.addEventListener('keyup', (event) => windUp(event.altKey), true);
window.addEventListener('blur', () => windUp(false));

chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'unslap') Slap.undo();
});

async function applyCursors() {
  const stored = await chrome.storage.local.get(SETTINGS);
  const on = stored.enabled !== false && !stored.disabledSites?.includes(location.hostname) && stored.cursorDefault;
  settings = on ? stored : null;
  if (!canSlap()) {
    windUp(false);
    Slap.restoreAll();
  }

  const css = settings && cursorCss(settings);
  if (css === insertedCss) return;
  // The service worker inserts the CSS as a user-origin stylesheet. User
  // !important beats a site's own !important, and the sheet lives outside the
  // DOM, so a page that rewrites <head> cannot remove it.
  chrome.runtime.sendMessage({ action: 'setCursorCss', css, previous: insertedCss });
  insertedCss = css;
}

chrome.storage.onChanged.addListener(applyCursors);
applyCursors();

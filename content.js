// Purrsor - Content Script
// Injects custom cursor styles into web pages

const STYLE_ID = 'purrsor-cursor-styles';

// Set on <html> while the primary mouse button is held.
const PRESSED_ATTR = 'data-purrsor-pressed';

let enabled = false;

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

function press(event) {
  if (!enabled || event.button !== 0 || event.pointerType === 'touch') return;
  document.documentElement.setAttribute(PRESSED_ATTR, '');
}

function release() {
  document.documentElement?.removeAttribute(PRESSED_ATTR);
}

window.addEventListener('pointerdown', press, true);
window.addEventListener('pointerup', release, true);
window.addEventListener('pointercancel', release, true);
window.addEventListener('dragend', release, true);
window.addEventListener('blur', release);

// Inject or update styles
function injectStyles(cursorDefault, cursorInteractive) {
  let styleElement = document.getElementById(STYLE_ID);

  if (!styleElement) {
    styleElement = document.createElement('style');
    styleElement.id = STYLE_ID;
    styleElement.setAttribute('type', 'text/css');
    
    // Insert at the end of head or document for highest specificity
    const target = document.head || document.documentElement;
    if (target) {
      target.appendChild(styleElement);
    }
  }

  styleElement.textContent = generateCSS(cursorDefault, cursorInteractive);
}

// Remove injected styles
function removeStyles() {
  const styleElement = document.getElementById(STYLE_ID);
  if (styleElement) {
    styleElement.remove();
  }
}

// Check if current site is disabled
async function isSiteDisabled() {
  const hostname = getHostname();
  const result = await chrome.storage.local.get('disabledSites');
  const disabledSites = result.disabledSites || [];
  return disabledSites.includes(hostname);
}

// Load and apply cursor styles
async function applyCursors() {
  // Check if site is disabled
  const disabled = await isSiteDisabled();
  
  if (disabled) {
    enabled = false;
    release();
    removeStyles();
    return;
  }

  // Get cursor configurations
  const config = await chrome.storage.local.get(['cursorDefault', 'cursorInteractive']);
  
  if (config.cursorDefault && config.cursorInteractive) {
    enabled = true;
    injectStyles(config.cursorDefault, config.cursorInteractive);
  }
}

// Listen for storage changes
chrome.storage.onChanged.addListener((changes, areaName) => {
  // React to cursor config or disabled sites changes (all stored in local)
  if (areaName === 'local' && (changes.cursorDefault || changes.cursorInteractive || changes.disabledSites)) {
    applyCursors();
  }
});

// Initial application
applyCursors();

// Re-apply when DOM is ready (in case document_start was too early)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', applyCursors);
}

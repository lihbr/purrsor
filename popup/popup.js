// Purrsor Popup Script
// Handles UI interactions and storage management

// DOM Elements
const elements = {
  currentSite: document.getElementById('currentSite'),
  siteToggle: document.getElementById('siteToggle'),
  soundToggle: document.getElementById('soundToggle'),
  cursorDefault: document.getElementById('cursorDefault'),
  cursorInteractive: document.getElementById('cursorInteractive'),
  saveBtn: document.getElementById('saveBtn'),
  resetBtn: document.getElementById('resetBtn'),
  statusMessage: document.getElementById('statusMessage')
};

// Current tab hostname
let currentHostname = '';

// Show status message
function showStatus(message, type = 'success') {
  elements.statusMessage.textContent = message;
  elements.statusMessage.className = `status-message ${type}`;
  
  setTimeout(() => {
    elements.statusMessage.classList.add('hidden');
  }, 3000);
}

// Get current tab info
async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// Extract hostname from URL
function getHostnameFromUrl(url) {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch {
    return '';
  }
}

// Load current hostname and check if disabled
async function loadCurrentSite() {
  const tab = await getCurrentTab();
  
  if (tab && tab.url) {
    currentHostname = getHostnameFromUrl(tab.url);
    elements.currentSite.textContent = currentHostname || 'N/A';
    
    // Check if site is disabled
    const result = await chrome.storage.local.get('disabledSites');
    const disabledSites = result.disabledSites || [];
    const isEnabled = !disabledSites.includes(currentHostname);
    
    elements.siteToggle.checked = isEnabled;
  } else {
    elements.currentSite.textContent = 'N/A';
    elements.siteToggle.disabled = true;
  }
}

// Load cursor configurations
async function loadCursorConfig() {
  const config = await chrome.storage.local.get(['cursorDefault', 'cursorInteractive']);
  
  if (config.cursorDefault) {
    elements.cursorDefault.value = config.cursorDefault;
  }
  
  if (config.cursorInteractive) {
    elements.cursorInteractive.value = config.cursorInteractive;
  }
}

// Load the click sound setting (on unless turned off)
async function loadSoundSetting() {
  const { soundEnabled } = await chrome.storage.local.get('soundEnabled');
  elements.soundToggle.checked = soundEnabled !== false;
}

async function toggleSound() {
  const soundEnabled = elements.soundToggle.checked;
  await chrome.storage.local.set({ soundEnabled });
  showStatus(soundEnabled ? 'Bongo sound on' : 'Bongo sound off');
}

// Toggle site enabled/disabled
async function toggleSite() {
  if (!currentHostname) return;
  
  const result = await chrome.storage.local.get('disabledSites');
  let disabledSites = result.disabledSites || [];
  
  if (elements.siteToggle.checked) {
    // Enable site - remove from disabled list
    disabledSites = disabledSites.filter(site => site !== currentHostname);
    showStatus(`Enabled on ${currentHostname}`);
  } else {
    // Disable site - add to disabled list
    if (!disabledSites.includes(currentHostname)) {
      disabledSites.push(currentHostname);
    }
    showStatus(`Disabled on ${currentHostname}`);
  }
  
  await chrome.storage.local.set({ disabledSites });
}

// Save cursor configurations
async function saveCursorConfig() {
  const cursorDefault = elements.cursorDefault.value.trim();
  const cursorInteractive = elements.cursorInteractive.value.trim();
  
  if (!cursorDefault || !cursorInteractive) {
    showStatus('Please fill in both cursor values', 'error');
    return;
  }
  
  await chrome.storage.local.set({
    cursorDefault,
    cursorInteractive
  });
  
  showStatus('Settings saved successfully!');
}

// Reset to default values
async function resetToDefaults() {
  try {
    const response = await chrome.runtime.sendMessage({ action: 'resetToDefaults' });
    
    if (response && response.success) {
      // Reload the config to show updated values
      await loadCursorConfig();
      showStatus('Reset to defaults!');
    }
  } catch (error) {
    showStatus('Failed to reset defaults', 'error');
    console.error('Reset error:', error);
  }
}

// Event Listeners
elements.siteToggle.addEventListener('change', toggleSite);
elements.soundToggle.addEventListener('change', toggleSound);
elements.saveBtn.addEventListener('click', saveCursorConfig);
elements.resetBtn.addEventListener('click', resetToDefaults);

// Initialize popup
async function init() {
  await loadCurrentSite();
  await loadCursorConfig();
  await loadSoundSetting();
}

init();

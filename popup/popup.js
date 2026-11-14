// Purrsor - popup: the quick switches and the cursor picker. Making and
// editing cursors happens in Settings, where a file picker can stay open.

const $ = (id) => document.getElementById(id);
const popup = $('popup');
const enabledToggle = $('enabledToggle');
const siteToggle = $('siteToggle');
const soundToggle = $('soundToggle');
const slapToggle = $('slapToggle');

let hostname = '';
let shortcuts = {};
let templates = [];
let templateId = BUILTIN_ID;

function currentTemplate() {
  return templates.find((template) => template.id === templateId) || templates[0];
}

function showEnabled(enabled) {
  enabledToggle.checked = enabled;
  popup.classList.toggle('off', !enabled);
  siteToggle.disabled = !enabled || !hostname;
  soundToggle.disabled = !enabled;
  slapToggle.disabled = !enabled;
  $('status').textContent = enabled ? 'On' : 'Off everywhere';
  showStageCursor(false);
}

async function loadSite() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    const url = new URL(tab.url);
    if (url.protocol === 'http:' || url.protocol === 'https:' || url.protocol === 'file:') {
      hostname = url.hostname;
    }
  } catch {
    // No URL: a page Purrsor can't see.
  }
  if (!hostname) {
    $('currentSite').textContent = 'Not available on this page';
    return;
  }
  $('currentSite').textContent = hostname;
  const { disabledSites = [] } = await chrome.storage.local.get('disabledSites');
  siteToggle.checked = !disabledSites.includes(hostname);
}

function withKeys(text, command) {
  return shortcuts[command] ? `${text} · ${shortcuts[command]}` : text;
}

async function loadShortcuts() {
  shortcuts = await getShortcuts();
  $('soundDetail').textContent = withKeys('Plays on every click', 'toggle-sound');
  $('slapDetail').textContent = `${SLAP_KEYS.click} knocks things away · ${SLAP_KEYS.undo} undoes`;
}

// The stage wears the cursor itself, so pointing at it shows the real thing.
function showStageCursor(pressed) {
  const template = currentTemplate();
  const cursor = pressed ? template?.cursorInteractive : template?.cursorDefault;
  $('stage').style.cursor = enabledToggle.checked && cursor ? cursor : '';
}

function showStage() {
  const template = currentTemplate();
  if (!template) return;
  showStageCursor(false);
  $('stageIdle').src = template.idle;
  $('stageSlap').src = template.slap || template.idle;
  $('stage').classList.toggle('no-picture', !template.idle);
}

// Cursor CSS without a picture in it gets a label instead.
function showArt(box, src) {
  const image = box.querySelector('img');
  image.hidden = !src;
  if (src) image.src = src;
  box.classList.toggle('no-picture', !src);
}

function renderTiles() {
  const group = $('tiles');
  group.replaceChildren(...templates.map((template) => {
    const tile = $('tileTemplate').content.firstElementChild.cloneNode(true);
    const input = tile.querySelector('input');
    input.value = template.id;
    input.checked = template.id === templateId;
    input.addEventListener('change', () => pick(template));
    showArt(tile.querySelector('.tile-art'), template.idle);
    tile.querySelector('.tile-name').textContent = template.name;
    tile.title = template.name;
    return tile;
  }));
}

async function loadTemplates() {
  [templates, { templateId = BUILTIN_ID }] = await Promise.all([
    listTemplates(),
    chrome.storage.local.get('templateId'),
  ]);
  renderTiles();
  showStage();
}

async function pick(template) {
  templateId = template.id;
  showStage();
  await useTemplate(template);
}

// Press the cat: the click image while held, and the sound if it is on.
function pressStage() {
  showStageCursor(true);
  $('stageIdle').hidden = true;
  $('stageSlap').hidden = false;
  if (soundToggle.checked && enabledToggle.checked) playTemplateSound(templateId);
}

function releaseStage() {
  showStageCursor(false);
  $('stageIdle').hidden = false;
  $('stageSlap').hidden = true;
}

const stage = $('stage');
stage.addEventListener('pointerdown', (event) => {
  if (event.button === 0) pressStage();
});
stage.addEventListener('pointerup', releaseStage);
stage.addEventListener('pointerleave', releaseStage);
stage.addEventListener('keydown', (event) => {
  if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) pressStage();
});
stage.addEventListener('keyup', releaseStage);

enabledToggle.addEventListener('change', () => {
  showEnabled(enabledToggle.checked);
  chrome.storage.local.set({ enabled: enabledToggle.checked });
});

siteToggle.addEventListener('change', async () => {
  const { disabledSites = [] } = await chrome.storage.local.get('disabledSites');
  const others = disabledSites.filter((site) => site !== hostname);
  await chrome.storage.local.set({ disabledSites: siteToggle.checked ? others : [...others, hostname] });
});

soundToggle.addEventListener('change', () => {
  chrome.storage.local.set({ soundEnabled: soundToggle.checked });
});

slapToggle.addEventListener('change', () => {
  chrome.storage.local.set({ slapEnabled: slapToggle.checked });
});

function openSettings(hash = '') {
  chrome.tabs.create({ url: chrome.runtime.getURL(`options/options.html${hash}`) });
  window.close();
}

$('newCursor').addEventListener('click', () => openSettings('#new'));
$('openSettings').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});
$('manageExtension').addEventListener('click', openManagePage);

// Shortcuts and Settings can change things while the popup is open.
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  if (changes.enabled) showEnabled(changes.enabled.newValue !== false);
  if (changes.soundEnabled) soundToggle.checked = changes.soundEnabled.newValue !== false;
  if (changes.slapEnabled) slapToggle.checked = changes.slapEnabled.newValue !== false;
  if (changes.templates || changes.templateId || changes.customCursor) loadTemplates();
  for (const key of Object.keys(changes)) {
    if (key.startsWith('sound:')) forgetTemplateSound(key.slice('sound:'.length));
  }
});

async function init() {
  const [switches] = await Promise.all([getSwitches(), loadSite(), loadTemplates(), loadShortcuts()]);
  soundToggle.checked = switches.soundEnabled;
  slapToggle.checked = switches.slapEnabled;
  showEnabled(switches.enabled);
}

init();

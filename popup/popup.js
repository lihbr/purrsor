// Purrsor - popup: the quick switches and the cursor picker.

const stage = $('stage');
let hostname = '';
let template = BUILTIN;
let cursors = {};

function pressStage(pressed) {
  const enabled = $('enabledToggle').checked;
  // The stage wears the cursor itself, and it is something to click.
  stage.style.cursor = (enabled && (pressed ? cursors.cursorClick : cursors.cursorInteractive)) || '';
  $('stageIdle').hidden = pressed;
  $('stageClick').hidden = !pressed;
  if (pressed && enabled && $('soundToggle').checked) playSound(template.id);
}

stage.addEventListener('pointerdown', (event) => {
  if (event.button === 0) pressStage(true);
});
stage.addEventListener('keydown', (event) => {
  if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) pressStage(true);
});
for (const type of ['pointerup', 'pointerleave', 'keyup']) {
  stage.addEventListener(type, () => pressStage(false));
}

async function show() {
  const [templates, stored] = await Promise.all([
    listTemplates(),
    chrome.storage.local.get(['templateId', 'disabledSites', 'cursorInteractive', 'cursorClick']),
    showSwitches(),
  ]);
  cursors = stored;
  template = templates.find((other) => other.id === stored.templateId) || BUILTIN;

  const enabled = $('enabledToggle').checked;
  $('popup').classList.toggle('off', !enabled);
  $('status').textContent = enabled ? 'On' : 'Off everywhere';
  $('siteToggle').disabled = !enabled || !hostname;
  $('siteToggle').checked = !stored.disabledSites?.includes(hostname);
  $('soundToggle').disabled = !enabled;
  $('slapToggle').disabled = !enabled;
  $('shrinkToggle').disabled = !enabled;

  const idle = template.idle;
  stage.classList.toggle('no-picture', !idle);
  $('stageIdle').src = idle;
  $('stageClick').src = template.click || template.hover || idle;
  pressStage(false);

  $('tiles').replaceChildren(...templates.map((other) => {
    const tile = $('tileTemplate').content.firstElementChild.cloneNode(true);
    const input = tile.querySelector('input');
    input.checked = other.id === template.id;
    input.addEventListener('change', () => useTemplate(other));
    tile.querySelector('.tile-art').classList.toggle('no-picture', !other.idle);
    tile.querySelector('img').src = other.idle;
    tile.querySelector('.tile-name').textContent = other.name;
    tile.title = other.name;
    return tile;
  }));
}

$('siteToggle').addEventListener('change', async () => {
  const { disabledSites = [] } = await chrome.storage.local.get('disabledSites');
  const others = disabledSites.filter((site) => site !== hostname);
  await chrome.storage.local.set({ disabledSites: $('siteToggle').checked ? others : [...others, hostname] });
});

$('newCursor').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('options/options.html#new') });
  window.close();
});
$('openSettings').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
  window.close();
});
$('manageExtension').addEventListener('click', openManagePage);

// Shortcuts and Settings can change things while the popup is open.
chrome.storage.onChanged.addListener(show);

async function init() {
  const [[tab], shortcuts] = await Promise.all([chrome.tabs.query({ active: true, currentWindow: true }), getShortcuts()]);
  // No URL on pages Purrsor can't see.
  if (/^(https?|file):/.test(tab?.url)) hostname = new URL(tab.url).hostname;
  $('currentSite').textContent = hostname || 'Not available on this page';
  const soundKeys = shortcuts['toggle-sound'];
  $('soundDetail').textContent = soundKeys ? `Plays on every click · ${soundKeys}` : 'Plays on every click';
  $('slapDetail').textContent = `${SLAP_KEYS.click} knocks things away · ${SLAP_KEYS.undo} undoes`;
  await show();
}

init();

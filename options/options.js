// Purrsor - Settings page

const $ = (id) => document.getElementById(id);
const local = chrome.storage.local;

// Switches and shortcuts

async function showSwitches() {
  const { enabled, soundEnabled, slapEnabled } = await getSwitches();
  $('enabledToggle').checked = enabled;
  $('soundToggle').checked = soundEnabled;
  $('slapToggle').checked = slapEnabled;
  $('enabledDetail').textContent = enabled
    ? "On for every site you haven't turned it off for"
    : 'Off everywhere. No cursor and no sound.';
}

async function showShortcuts() {
  const shortcuts = await getShortcuts();
  for (const [id, command] of [['enabledKeys', 'toggle-enabled'], ['soundKeys', 'toggle-sound']]) {
    const keys = shortcuts[command];
    $(id).textContent = keys || 'No shortcut';
    $(id).classList.toggle('unset', !keys);
  }
}

$('enabledToggle').addEventListener('change', (event) => local.set({ enabled: event.target.checked }));
$('soundToggle').addEventListener('change', (event) => local.set({ soundEnabled: event.target.checked }));
$('slapToggle').addEventListener('change', (event) => local.set({ slapEnabled: event.target.checked }));
$('slapDetail').textContent = `${SLAP_KEYS.click} knocks the things around the cat out of the way, and ${SLAP_KEYS.undo} puts back the last slap. `
  + `While it's on, ${SLAP_KEYS.click} doesn't download links.`;
$('changeShortcuts').addEventListener('click', openShortcutsPage);
$('manageExtension').addEventListener('click', openManagePage);

// Back from the browser's shortcuts page: show the new keys.
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) showShortcuts();
});

// Cursors

let templates = [];

function soundDetail(template) {
  if (template.builtin) return 'Built in, with the bongo';
  if (template.id === CUSTOM_CSS_ID) return 'Your CSS, with the bongo';
  return template.sound ? `Plays ${template.sound.name}` : 'Plays the bongo';
}

async function showGallery() {
  const [list, { templateId = BUILTIN_ID }] = await Promise.all([listTemplates(), local.get('templateId')]);
  templates = list;
  const current = list.find((template) => template.id === templateId) || list[0];
  $('headCat').src = list[0].idle;

  const cards = list.map((template) => {
    const card = $('cardTemplate').content.firstElementChild.cloneNode(true);
    const inUse = template.id === current.id;
    card.classList.toggle('in-use', inUse);
    const image = card.querySelector('img');
    image.hidden = !template.idle;
    if (template.idle) image.src = template.idle;
    card.querySelector('.card-art').classList.toggle('no-picture', !template.idle);
    card.querySelector('.card-name').textContent = template.name;
    card.querySelector('.card-detail').textContent = soundDetail(template);

    const actions = card.querySelector('.card-actions');
    if (inUse) {
      const badge = document.createElement('span');
      badge.className = 'in-use-badge';
      badge.textContent = 'In use';
      actions.append(badge);
    } else {
      actions.append(actionButton('Use', `Use ${template.name}`, () => useTemplate(template), 'button small'));
    }
    if (template.id === CUSTOM_CSS_ID) {
      actions.append(actionButton('Edit', 'Edit cursor CSS', openCssEditor));
    } else if (!template.builtin) {
      actions.append(actionButton('Edit', `Edit ${template.name}`, () => openEditor(template)));
    }
    return card;
  });

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'card card-new';
  add.innerHTML = '<span class="card-new-plus" aria-hidden="true">+</span><span>New cursor</span>';
  add.addEventListener('click', () => openEditor());
  $('gallery').replaceChildren(...cards, add);
}

function actionButton(text, label, onClick, className = 'text-button') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = text;
  if (label !== text) button.setAttribute('aria-label', label);
  button.addEventListener('click', onClick);
  return button;
}

// Sites Purrsor is turned off on

async function showSites() {
  const { disabledSites = [] } = await local.get('disabledSites');
  $('sitesEmpty').hidden = disabledSites.length > 0;
  $('sites').replaceChildren(...disabledSites.map((site) => {
    const item = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = site;
    item.append(name, actionButton('Turn on', `Turn Purrsor on for ${site}`, async () => {
      const { disabledSites: sites = [] } = await local.get('disabledSites');
      await local.set({ disabledSites: sites.filter((other) => other !== site) });
    }, 'button small'));
    return item;
  }));
}

// Cursor CSS

async function fillCssForm() {
  const { customCursor, cursorDefault = '', cursorInteractive = '' } = await local.get(['customCursor', 'cursorDefault', 'cursorInteractive']);
  $('cssDefault').value = customCursor?.cursorDefault ?? cursorDefault;
  $('cssInteractive').value = customCursor?.cursorInteractive ?? cursorInteractive;
}

function openCssEditor() {
  const details = document.querySelector('.advanced');
  details.open = true;
  details.scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('cssDefault').focus({ preventScroll: true });
}

$('cssForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const customCursor = {
    cursorDefault: $('cssDefault').value.trim(),
    cursorInteractive: $('cssInteractive').value.trim(),
  };
  await local.set({ customCursor });
  await useTemplate({ id: CUSTOM_CSS_ID, ...customCursor });
  $('cssStatus').textContent = 'Saved. Pages use it now.';
});

// The cursor editor

const editor = $('editor');
let draft;
let tryCursors = { idle: '', slap: '' };
let previewAudio;

function openEditor(template) {
  draft = template
    ? { ...template, hotspot: { ...template.hotspot }, sound: template.sound ? 'keep' : null, soundName: template.sound?.name }
    : { name: '', idle: '', slap: '', hotspot: { x: 0.5, y: 0.5 }, size: MAX_CURSOR_SIZE, sound: null };
  $('editorTitle').textContent = template ? `Edit ${template.name}` : 'New cursor';
  $('saveTemplate').textContent = template ? 'Save changes' : 'Save and use';
  $('deleteTemplate').hidden = !template;
  resetDelete();
  $('nameInput').value = draft.name;
  editor.querySelector(`input[name="size"][value="${draft.size}"]`).checked = true;
  showError('');
  showDraft();
  editor.showModal();
  $('nameInput').focus();
}

function closeEditor() {
  editor.close();
  if (location.hash === '#new') history.replaceState(null, '', location.pathname);
}

function showError(message) {
  $('editorError').textContent = message;
}

function showUpload(id, src) {
  const image = $(id).querySelector('img');
  image.hidden = !src;
  if (src) image.src = src;
  $(id).querySelector('.upload-button span').textContent = src ? 'Replace' : 'Choose';
}

function showDraft() {
  showUpload('idleUpload', draft.idle);
  showUpload('slapUpload', draft.slap);
  $('soundName').textContent = draft.sound === null ? 'Bongo' : draft.soundName;
  $('soundRemove').hidden = draft.sound === null;
  showHotspot();
  updateTryCursors();
}

// The picture is shown up to twice its size so the point is easy to place.
async function showHotspot() {
  const image = $('hotspotImage');
  $('hotspotFrame').hidden = !draft.idle;
  $('hotspotEmpty').hidden = Boolean(draft.idle);
  $('hotspotReadout').textContent = '';
  if (!draft.idle) return;
  if (image.getAttribute('src') !== draft.idle) {
    image.src = draft.idle;
    await image.decode();
    const zoom = Math.min(2, 224 / image.naturalWidth, 156 / image.naturalHeight);
    image.style.width = `${image.naturalWidth * zoom}px`;
  }
  $('hotspotMark').style.left = `${draft.hotspot.x * 100}%`;
  $('hotspotMark').style.top = `${draft.hotspot.y * 100}%`;
  // In the pixels of the cursor at the chosen size.
  const scale = Math.min(1, draft.size / Math.max(image.naturalWidth, image.naturalHeight));
  const x = Math.round(draft.hotspot.x * image.naturalWidth * scale);
  const y = Math.round(draft.hotspot.y * image.naturalHeight * scale);
  $('hotspotReadout').textContent = `Now ${x}, ${y} px from the top left.`;
}

// The try pad wears the draft cursor. Rebuilding it takes a moment, so only
// the latest edit's result is kept.
let tryVersion = 0;
async function updateTryCursors() {
  const version = ++tryVersion;
  if (!draft.idle) {
    tryCursors = { idle: '', slap: '' };
  } else {
    const [idle, slap] = await Promise.all([
      cursorValue(draft.idle, draft.hotspot, draft.size),
      cursorValue(draft.slap || draft.idle, draft.hotspot, draft.size),
    ]);
    if (version !== tryVersion) return;
    tryCursors = { idle, slap };
  }
  $('tryPad').style.cursor = tryCursors.idle;
}

async function chooseFile(input, read, apply) {
  const [file] = input.files;
  input.value = '';
  if (!file) return;
  try {
    apply(await read(file), file);
    showError('');
    showDraft();
  } catch (error) {
    if (!(error instanceof FileProblem)) throw error;
    showError(error.message);
  }
}

$('idleFile').addEventListener('change', (event) => chooseFile(event.target, readPicture, (src, file) => {
  draft.idle = src;
  if (!$('nameInput').value.trim()) $('nameInput').value = file.name.replace(/\.[^.]+$/, '').slice(0, 40);
}));
$('slapFile').addEventListener('change', (event) => chooseFile(event.target, readPicture, (src) => {
  draft.slap = src;
}));
$('soundFile').addEventListener('change', (event) => chooseFile(event.target, readSound, (sound) => {
  draft.sound = sound;
  draft.soundName = sound.name;
}));
$('soundRemove').addEventListener('click', () => {
  draft.sound = null;
  showDraft();
});

$('sizeChoice').addEventListener('change', (event) => {
  draft.size = Number(event.target.value);
  showHotspot();
  updateTryCursors();
});

// Click point: click the picture, or nudge with the arrow keys.
const hotspot = $('hotspot');
const clamp01 = (value) => Math.min(1, Math.max(0, value));

function setHotspot(x, y) {
  draft.hotspot = { x: clamp01(x), y: clamp01(y) };
  showHotspot();
  updateTryCursors();
}

hotspot.addEventListener('pointerdown', (event) => {
  if (!draft.idle) return;
  const box = $('hotspotImage').getBoundingClientRect();
  setHotspot((event.clientX - box.left) / box.width, (event.clientY - box.top) / box.height);
});

hotspot.addEventListener('keydown', (event) => {
  const moves = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  const move = moves[event.key];
  if (!move || !draft.idle) return;
  event.preventDefault();
  const image = $('hotspotImage');
  const step = event.shiftKey ? 10 : 1;
  setHotspot(
    draft.hotspot.x + (move[0] * step) / image.naturalWidth,
    draft.hotspot.y + (move[1] * step) / image.naturalHeight,
  );
});

// Pressing in the try pad shows the click picture and plays the sound.
async function playDraftSound() {
  if (draft.sound && draft.sound !== 'keep') {
    previewAudio ??= new AudioContext();
    const data = Uint8Array.from(atob(draft.sound.data), (c) => c.charCodeAt(0)).buffer;
    const source = previewAudio.createBufferSource();
    source.buffer = await previewAudio.decodeAudioData(data);
    source.connect(previewAudio.destination);
    source.start();
  } else {
    playTemplateSound(draft.sound === 'keep' ? draft.id : BUILTIN_ID);
  }
}

const tryPad = $('tryPad');
tryPad.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || !tryCursors.idle) return;
  tryPad.style.cursor = tryCursors.slap;
  tryPad.classList.add('pressed');
  playDraftSound();
});
for (const type of ['pointerup', 'pointerleave', 'pointercancel']) {
  tryPad.addEventListener(type, () => {
    tryPad.style.cursor = tryCursors.idle;
    tryPad.classList.remove('pressed');
  });
}
$('soundPlay').addEventListener('click', playDraftSound);

// Deleting takes a second click, so a slip can't lose a cursor.
let deleteTimer;
function resetDelete() {
  clearTimeout(deleteTimer);
  $('deleteTemplate').textContent = 'Delete cursor';
  $('deleteTemplate').dataset.armed = '';
}

$('deleteTemplate').addEventListener('click', async () => {
  const button = $('deleteTemplate');
  if (!button.dataset.armed) {
    button.dataset.armed = 'yes';
    button.textContent = 'Click again to delete';
    deleteTimer = setTimeout(resetDelete, 4000);
    return;
  }
  const { templates: saved = [], templateId } = await local.get(['templates', 'templateId']);
  await local.set({ templates: saved.filter((template) => template.id !== draft.id) });
  await local.remove(`sound:${draft.id}`);
  if (templateId === draft.id) await useTemplate(await loadBuiltinTemplate());
  closeEditor();
});

$('editorClose').addEventListener('click', closeEditor);
editor.addEventListener('close', () => {
  tryPad.style.cursor = '';
});

$('editorForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const name = $('nameInput').value.trim();
  if (!draft.idle) return showError('Choose a cursor picture.');
  if (!name) {
    $('nameInput').focus();
    return showError('Give your cursor a name.');
  }

  $('saveTemplate').disabled = true;
  try {
    const id = draft.id ?? crypto.randomUUID();
    const [cursorDefault, cursorInteractive] = await Promise.all([
      cursorValue(draft.idle, draft.hotspot, draft.size),
      cursorValue(draft.slap || draft.idle, draft.hotspot, draft.size),
    ]);
    const soundName = draft.sound === null ? null : draft.soundName;
    const template = {
      id,
      name,
      idle: draft.idle,
      slap: draft.slap,
      hotspot: draft.hotspot,
      size: draft.size,
      sound: soundName ? { name: soundName } : null,
      cursorDefault,
      cursorInteractive,
    };

    const { templates: saved = [], templateId } = await local.get(['templates', 'templateId']);
    const isNew = !saved.some((other) => other.id === id);
    const writes = { templates: isNew ? [...saved, template] : saved.map((other) => (other.id === id ? template : other)) };
    if (draft.sound && draft.sound !== 'keep') writes[`sound:${id}`] = draft.sound;
    await local.set(writes);
    if (draft.sound === null) await local.remove(`sound:${id}`);
    if (isNew || templateId === id) await useTemplate(template);
    closeEditor();
  } catch (error) {
    // chrome.storage.local holds 10 MB in all.
    if (!/quota/i.test(error.message)) throw error;
    showError('There isn’t room to save this. Delete a cursor you don’t use, or choose a smaller sound.');
  } finally {
    $('saveTemplate').disabled = false;
  }
});

// Keep up with the popup, shortcuts and other Settings tabs.
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'local') return;
  if (changes.enabled || changes.soundEnabled || changes.slapEnabled) showSwitches();
  if (changes.templates || changes.templateId || changes.customCursor) showGallery();
  if (changes.disabledSites) showSites();
  for (const key of Object.keys(changes)) {
    if (key.startsWith('sound:')) forgetTemplateSound(key.slice('sound:'.length));
  }
});

async function init() {
  await Promise.all([showSwitches(), showShortcuts(), showGallery(), showSites(), fillCssForm()]);
  if (location.hash === '#new') openEditor();
}

init();

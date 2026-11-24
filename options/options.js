// Purrsor - Settings page

const local = chrome.storage.local;
const PICTURES = ['idle', 'hover', 'click'];
const CSS_FIELDS = { cssDefault: 'cursorDefault', cssInteractive: 'cursorInteractive', cssClick: 'cursorClick' };

const editor = $('editor');
const tryPad = $('tryPad');
let draft;
let tryCursors = { idle: '', click: '' };

function actionButton(text, label, onClick, className = 'text-button') {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = text;
  button.setAttribute('aria-label', label);
  button.addEventListener('click', onClick);
  return button;
}

function soundDetail(template) {
  if (template.builtin) return 'Built in, with the bongo';
  if (template.id === CUSTOM_CSS_ID) return 'Your CSS, with the bongo';
  return template.sound ? `Plays ${template.sound}` : 'Plays the bongo';
}

async function show() {
  const [templates, { templateId = BUILTIN.id, disabledSites = [] }] = await Promise.all([
    listTemplates(),
    local.get(['templateId', 'disabledSites']),
    showSwitches(),
  ]);
  $('enabledDetail').textContent = $('enabledToggle').checked
    ? "On for every site you haven't turned it off for"
    : 'Off everywhere. No cursor and no sound.';

  const cards = templates.map((template) => {
    const card = $('cardTemplate').content.firstElementChild.cloneNode(true);
    const inUse = template.id === templateId;
    card.classList.toggle('in-use', inUse);
    card.querySelector('.card-art').classList.toggle('no-picture', !template.idle);
    card.querySelector('img').src = template.idle;
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

  $('sitesEmpty').hidden = disabledSites.length > 0;
  $('sites').replaceChildren(...disabledSites.map((site) => {
    const item = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = site;
    item.append(name, actionButton('Turn on', `Turn Purrsor on for ${site}`, () => {
      local.set({ disabledSites: disabledSites.filter((other) => other !== site) });
    }, 'button small'));
    return item;
  }));
}

async function showShortcuts() {
  const shortcuts = await getShortcuts();
  for (const [id, command] of [['enabledKeys', 'toggle-enabled'], ['soundKeys', 'toggle-sound']]) {
    $(id).textContent = shortcuts[command] || 'No shortcut';
    $(id).classList.toggle('unset', !shortcuts[command]);
  }
}

$('slapDetail').textContent = `${SLAP_KEYS.click} knocks the things around the cat out of the way, and ${SLAP_KEYS.undo} puts back the last slap. `
  + `While it's on, ${SLAP_KEYS.click} doesn't download links.`;
// Extensions can read their shortcuts but not set them.
$('changeShortcuts').addEventListener('click', () => chrome.tabs.create({ url: 'chrome://extensions/shortcuts' }));
$('manageExtension').addEventListener('click', openManagePage);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) showShortcuts();
});

// Cursor CSS

function openCssEditor() {
  const details = document.querySelector('.advanced');
  details.open = true;
  details.scrollIntoView({ behavior: 'smooth', block: 'start' });
  $('cssDefault').focus({ preventScroll: true });
}

$('cssForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const customCursor = Object.fromEntries(Object.entries(CSS_FIELDS).map(([id, key]) => [key, $(id).value.trim()]));
  await local.set({ customCursor });
  await useTemplate({ id: CUSTOM_CSS_ID, ...customCursor });
  $('cssStatus').textContent = 'Saved. Pages use it now.';
});

// The cursor editor

function openEditor(template) {
  draft = template
    ? { ...template }
    : { name: '', idle: '', hover: '', click: '', hotspot: { x: 0.5, y: 0.5 }, size: MAX_CURSOR_SIZE, sound: null };
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

function showDraft() {
  for (const picture of PICTURES) {
    const upload = $(`${picture}Upload`);
    upload.querySelector('img').hidden = !draft[picture];
    upload.querySelector('img').src = draft[picture] || '';
    upload.querySelector('.upload-button span').textContent = draft[picture] ? 'Replace' : 'Choose';
  }
  $('soundName').textContent = draft.sound ?? 'Bongo';
  $('soundRemove').hidden = !draft.sound;
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
  const scale = Math.min(1, draft.size / Math.max(image.naturalWidth, image.naturalHeight));
  const x = Math.round(draft.hotspot.x * image.naturalWidth * scale);
  const y = Math.round(draft.hotspot.y * image.naturalHeight * scale);
  $('hotspotReadout').textContent = `Now ${x}, ${y} px from the top left.`;
}

// Drawing takes a moment, so only the latest edit's result is kept.
let tryVersion = 0;
async function updateTryCursors() {
  const version = ++tryVersion;
  const draw = (picture) => (picture ? cursorValue(picture, draft, true) : '');
  const [idle, click] = await Promise.all([draw(draft.idle), draw(draft.click || draft.hover || draft.idle)]);
  if (version !== tryVersion) return;
  tryCursors = { idle, click };
  tryPad.style.cursor = idle;
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

for (const picture of PICTURES) {
  $(`${picture}File`).addEventListener('change', (event) => chooseFile(event.target, readPicture, (src, file) => {
    draft[picture] = src;
    if (picture === 'idle' && !$('nameInput').value.trim()) $('nameInput').value = file.name.replace(/\.[^.]+$/, '').slice(0, 40);
  }));
}
$('soundFile').addEventListener('change', (event) => chooseFile(event.target, readSound, (sound, file) => {
  draft.newSound = sound;
  draft.sound = file.name;
}));
$('soundRemove').addEventListener('click', () => {
  draft.newSound = undefined;
  draft.sound = null;
  showDraft();
});

$('sizeChoice').addEventListener('change', (event) => {
  draft.size = Number(event.target.value);
  showDraft();
});

function setHotspot(x, y) {
  const clamp = (value) => Math.min(1, Math.max(0, value));
  draft.hotspot = { x: clamp(x), y: clamp(y) };
  showDraft();
}

$('hotspot').addEventListener('pointerdown', (event) => {
  if (!draft.idle) return;
  const box = $('hotspotImage').getBoundingClientRect();
  setHotspot((event.clientX - box.left) / box.width, (event.clientY - box.top) / box.height);
});

$('hotspot').addEventListener('keydown', (event) => {
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

function playDraftSound() {
  if (draft.newSound) decodeSound(draft.newSound).then(playBuffer);
  else playSound(draft.sound ? draft.id : BUILTIN.id);
}

tryPad.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || !tryCursors.idle) return;
  tryPad.style.cursor = tryCursors.click;
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
  const { templates = [], templateId } = await local.get(['templates', 'templateId']);
  await local.set({ templates: templates.filter((template) => template.id !== draft.id) });
  await local.remove(`sound:${draft.id}`);
  if (templateId === draft.id) await useTemplate(BUILTIN);
  closeEditor();
});

$('editorClose').addEventListener('click', closeEditor);

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
    const { newSound, ...rest } = draft;
    const template = { ...rest, name, id: draft.id ?? crypto.randomUUID() };
    const { templates = [], templateId } = await local.get(['templates', 'templateId']);
    const isNew = !templates.some((other) => other.id === template.id);
    const writes = { templates: isNew ? [...templates, template] : templates.map((other) => (other.id === template.id ? template : other)) };
    if (newSound) writes[`sound:${template.id}`] = newSound;
    await local.set(writes);
    if (!template.sound) await local.remove(`sound:${template.id}`);
    if (isNew || templateId === template.id) await useTemplate(template);
    closeEditor();
  } catch (error) {
    // chrome.storage.local holds 10 MB in all.
    if (!/quota/i.test(error.message)) throw error;
    showError('There isn’t room to save this. Delete a cursor you don’t use, or choose a smaller sound.');
  } finally {
    $('saveTemplate').disabled = false;
  }
});

// The popup, shortcuts and other Settings tabs can change things.
chrome.storage.onChanged.addListener(show);

async function init() {
  const stored = await local.get(['customCursor', ...Object.values(CSS_FIELDS)]);
  for (const [id, key] of Object.entries(CSS_FIELDS)) $(id).value = (stored.customCursor ?? stored)[key] ?? '';
  await Promise.all([show(), showShortcuts()]);
  if (location.hash === '#new') openEditor();
}

init();

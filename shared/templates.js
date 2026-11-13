// Purrsor - cursor templates, shared by the service worker, the popup and the
// Settings page.
//
// A template is an idle image, a click image, a click point and, optionally,
// a sound. Bongo Cat is built in: its cursors come from default.json and its
// sound from sounds/bongo.mp3. Templates people make are stored in
// chrome.storage.local:
//
//   templates      [{ id, name, idle, slap, hotspot: { x, y }, size,
//                     sound, cursorDefault, cursorInteractive }]
//                  idle and slap are PNG data URLs no larger than 112px.
//                  hotspot is a fraction of the image, so it survives resizing.
//                  sound is true when sound:<id> holds the template's sound.
//   sound:<id>     { type, data } with the audio file as base64. Kept apart
//                  so pages read it only when someone clicks.
//   customCursor   { cursorDefault, cursorInteractive }: cursor CSS typed in
//                  Settings > Advanced.
//   templateId     The template in use: BUILTIN_ID, CUSTOM_CSS_ID or a
//                  template's id.
//
// The template in use is copied into cursorDefault and cursorInteractive,
// which are all a page reads to draw the cursor.

const BUILTIN_ID = 'bongo-cat';
const CUSTOM_CSS_ID = 'css';

async function loadBuiltinTemplate() {
  const response = await fetch(chrome.runtime.getURL('default.json'));
  const defaults = await response.json();
  return {
    id: BUILTIN_ID,
    name: 'Bongo Cat',
    builtin: true,
    idle: firstImage(defaults.default),
    slap: firstImage(defaults.interactive),
    cursorDefault: defaults.default,
    cursorInteractive: defaults.interactive,
  };
}

// The first url() in a cursor value, for showing it as a picture.
function firstImage(cursor) {
  return /url\(\s*(['"]?)(.*?)\1\s*\)/.exec(cursor || '')?.[2] || '';
}

// Bongo Cat first, then the templates people made, then custom CSS if any.
async function listTemplates() {
  const [builtin, { templates = [], customCursor }] = await Promise.all([
    loadBuiltinTemplate(),
    chrome.storage.local.get(['templates', 'customCursor']),
  ]);
  const list = [builtin, ...templates];
  if (customCursor) {
    list.push({
      id: CUSTOM_CSS_ID,
      name: 'Custom CSS',
      idle: firstImage(customCursor.cursorDefault),
      slap: firstImage(customCursor.cursorInteractive),
      ...customCursor,
    });
  }
  return list;
}

function useTemplate(template) {
  return chrome.storage.local.set({
    templateId: template.id,
    cursorDefault: template.cursorDefault,
    cursorInteractive: template.cursorInteractive,
  });
}

// The template's own sound as an ArrayBuffer, or null when it uses the bongo.
async function loadTemplateSound(templateId) {
  const key = `sound:${templateId}`;
  const { [key]: sound } = await chrome.storage.local.get(key);
  if (!sound) return null;
  return Uint8Array.from(atob(sound.data), (c) => c.charCodeAt(0)).buffer;
}

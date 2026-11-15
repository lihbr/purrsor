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
// with the wind-up drawn from its idle picture in cursorWindup. Those three
// are all a page reads to draw the cursor.

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

async function useTemplate(template) {
  await chrome.storage.local.set({
    templateId: template.id,
    cursorDefault: template.cursorDefault,
    cursorInteractive: template.cursorInteractive,
    cursorWindup: await windupCursor(template.cursorDefault).catch(() => ''),
  });
}

// The wind-up cursor, shown while Option (Alt) is held: the idle picture
// leaning back on its left end, so the paw end lifts. Only pictures inside
// the cursor value (data: URLs) can be redrawn; for anything else it's ''.
const WINDUP_DEGREES = -10;
const WINDUP_MAX_SIZE = 124; // Chromium drops cursor images over 128px

async function windupCursor(cursorValue) {
  const parts = [...cursorValue.matchAll(/url\((['"]?)(data:image\/[^'")]+)\1\)\s+([\d.]+)\s+([\d.]+)/g)];
  if (!parts.length) return '';
  const leaned = await Promise.all(parts.map(([, , src, x, y]) => leanBack(src, Number(x), Number(y))));
  return `${leaned.join(', ')}, auto`;
}

async function leanBack(src, x, y) {
  const bytes = Uint8Array.from(atob(src.slice(src.indexOf(',') + 1)), (c) => c.charCodeAt(0));
  const image = await createImageBitmap(new Blob([bytes]));
  const { width, height } = image;
  const radians = (WINDUP_DEGREES * Math.PI) / 180;
  // Drawn with room on every side, turned about the bottom-left corner,
  // which stays where it was.
  const pad = Math.max(width, height);
  const big = new OffscreenCanvas(width + 2 * pad, height + 2 * pad);
  const draw = big.getContext('2d');
  draw.translate(pad, pad + height);
  draw.rotate(radians);
  draw.drawImage(image, 0, -height);
  // Cropped to the picture, and shrunk if leaning made it too big.
  const { data } = draw.getImageData(0, 0, big.width, big.height);
  let left = big.width, top = big.height, right = 0, bottom = 0;
  for (let i = 3; i < data.length; i += 4) {
    if (!data[i]) continue;
    const px = (i >> 2) % big.width;
    const py = Math.floor((i >> 2) / big.width);
    left = Math.min(left, px); right = Math.max(right, px + 1);
    top = Math.min(top, py); bottom = Math.max(bottom, py + 1);
  }
  if (right <= left) return `url('${src}') ${x} ${y}`;
  const scale = Math.min(1, WINDUP_MAX_SIZE / Math.max(right - left, bottom - top));
  const canvas = new OffscreenCanvas(Math.round((right - left) * scale), Math.round((bottom - top) * scale));
  canvas.getContext('2d').drawImage(big, left, top, right - left, bottom - top, 0, 0, canvas.width, canvas.height);
  const png = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
  let binary = '';
  for (let i = 0; i < png.length; i += 0x8000) binary += String.fromCharCode(...png.subarray(i, i + 0x8000));
  const url = `data:image/png;base64,${btoa(binary)}`;
  // The click lands where it did before, which is where the paw comes down.
  const hotX = Math.min(canvas.width - 1, Math.max(0, Math.round((pad + x - left) * scale)));
  const hotY = Math.min(canvas.height - 1, Math.max(0, Math.round((pad + y - top) * scale)));
  return `url('${url}') ${hotX} ${hotY}`;
}


// The template's own sound as an ArrayBuffer, or null when it uses the bongo.
async function loadTemplateSound(templateId) {
  const key = `sound:${templateId}`;
  const { [key]: sound } = await chrome.storage.local.get(key);
  if (!sound) return null;
  return Uint8Array.from(atob(sound.data), (c) => c.charCodeAt(0)).buffer;
}

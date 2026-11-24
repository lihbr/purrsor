// Purrsor - cursor templates, shared by the service worker, the popup and the
// Settings page.

const BUILTIN = {
  id: 'bongo-cat',
  name: 'Bongo Cat',
  builtin: true,
  idle: chrome.runtime.getURL('cursors/idle.png'),
  hover: chrome.runtime.getURL('cursors/hover.png'),
  click: chrome.runtime.getURL('cursors/click.png'),
  hotspot: { x: 72 / 112, y: 51 / 70 },
  size: 112,
};
const CUSTOM_CSS_ID = 'css';

// Chromium ignores cursor images over 128px.
const MAX_CURSOR_SIZE = 112;
const MAX_LEANED_SIZE = 124;
const LEAN = (10 * Math.PI) / 180;

function firstImage(cursor) {
  return /url\(\s*(['"]?)(.*?)\1\s*\)/.exec(cursor || '')?.[2] || '';
}

async function listTemplates() {
  const { templates = [], customCursor } = await chrome.storage.local.get(['templates', 'customCursor']);
  const list = [BUILTIN, ...templates];
  if (customCursor) {
    list.push({
      id: CUSTOM_CSS_ID,
      name: 'Custom CSS',
      idle: firstImage(customCursor.cursorDefault),
      click: firstImage(customCursor.cursorClick),
      ...customCursor,
    });
  }
  return list;
}

function toDataUrl(blob) {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.readAsDataURL(blob);
  });
}

// A CSS cursor value for one picture. Chromium drops a cursor image that
// doesn't fit inside the window, so with `shrink` a half-size copy follows the
// full-size one for near the edges. `lean` tips the picture back about its
// bottom-left corner, and the click point stays where the paw comes down.
async function cursorValue(src, { hotspot, size }, shrink, lean) {
  const image = await createImageBitmap(await (await fetch(src)).blob());
  const angle = lean ? LEAN : 0;
  const left = image.height * Math.sin(angle);
  const width = image.width * Math.cos(angle) + left;
  const height = image.width * Math.sin(angle) + image.height * Math.cos(angle);
  const fit = Math.min(1, size / Math.max(image.width, image.height), MAX_LEANED_SIZE / Math.max(width, height));
  const parts = [];
  for (const scale of shrink ? [fit, fit / 2] : [fit]) {
    const canvas = new OffscreenCanvas(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)));
    const context = canvas.getContext('2d');
    context.imageSmoothingQuality = 'high';
    context.scale(scale, scale);
    context.translate(left, height);
    context.rotate(-angle);
    context.drawImage(image, 0, -image.height);
    const x = Math.min(canvas.width - 1, Math.round((left + hotspot.x * image.width) * scale));
    const y = Math.min(canvas.height - 1, Math.round((height - image.height + hotspot.y * image.height) * scale));
    parts.push(`url('${await toDataUrl(await canvas.convertToBlob())}') ${x} ${y}`);
  }
  return [...parts, 'auto'].join(', ');
}

// Draws a template into the cursor values pages read.
async function useTemplate(template) {
  let { cursorDefault, cursorInteractive, cursorClick } = template;
  let cursorWindup = '';
  if (template.id !== CUSTOM_CSS_ID) {
    const { shrinkEnabled } = await chrome.storage.local.get('shrinkEnabled');
    const draw = (picture, lean) => cursorValue(picture, template, shrinkEnabled !== false, lean);
    const hover = template.hover || template.idle;
    [cursorDefault, cursorInteractive, cursorClick, cursorWindup] = await Promise.all([
      draw(template.idle),
      draw(hover),
      draw(template.click || hover),
      draw(template.idle, true),
    ]);
  }
  await chrome.storage.local.set({ templateId: template.id, cursorDefault, cursorInteractive, cursorClick, cursorWindup });
}

async function useCurrentTemplate() {
  const [templates, { templateId }] = await Promise.all([listTemplates(), chrome.storage.local.get('templateId')]);
  await useTemplate(templates.find((template) => template.id === templateId) ?? BUILTIN);
}

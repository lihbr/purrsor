const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const { createServer } = require('node:http');
const path = require('node:path');
const { after, before, test } = require('node:test');
const { chromium } = require('playwright');

const extension = path.join(__dirname, '..');
const server = createServer((request, response) => {
  readFile(path.join(__dirname, request.url)).then(
    (body) => response.setHeader('Content-Type', 'text/html').end(body),
    () => response.writeHead(404).end(),
  );
});

before(() => new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)));
after(() => server.close());

const PICTURES = {
  cursorDefault: 'paws up',
  cursorInteractive: 'one paw down',
  cursorClick: 'both paws down',
  cursorWindup: 'leaning back',
};

// Settings reach pages a moment after they change.
async function eventually(check) {
  for (let tries = 0; tries < 30 && !await check(); tries++) await new Promise((resolve) => setTimeout(resolve, 100));
}

// A fresh browser with Purrsor installed, its Settings page and a web page.
async function open(t) {
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    reducedMotion: 'no-preference',
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  t.after(() => context.close());
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const origin = `chrome-extension://${new URL(worker.url()).host}`;
  const settings = await context.newPage();
  await settings.goto(`${origin}/options/options.html`);
  await settings.getByText('In use').waitFor();
  const page = await context.newPage();
  await page.goto(`http://127.0.0.1:${server.address().port}/page.html`);

  // Asserts what the pointer shows over an element: one of the cat's pictures
  // by name, or a CSS cursor when it isn't the cat. `inside` names a global
  // holding an element Playwright can't reach, in a closed shadow root. `still`
  // leaves the mouse where it is.
  const assertPointer = async (target, expected, { inside, still } = {}) => {
    let seen;
    if (!still) await target.hover();
    await eventually(async () => {
      const cursor = await target.evaluate((node, name) => getComputedStyle(name ? window[name] : node).cursor, inside);
      const stored = await settings.evaluate(() => chrome.storage.local.get());
      const key = Object.keys(PICTURES).find((name) => stored[name]?.replaceAll("'", '"') === cursor);
      seen = key ? PICTURES[key] : cursor;
      return seen === expected;
    });
    assert.equal(seen, expected);
  };
  return { context, origin, settings, page, assertPointer };
}

test('the cat puts one paw down over clickable things and both while the button is held', async (t) => {
  const { page, assertPointer } = await open(t);
  const frameLink = page.frameLocator('#frame').locator('a');

  await assertPointer(page.locator('#text'), 'paws up');
  await assertPointer(page.locator('#chip'), 'paws up');
  await assertPointer(page.locator('#link'), 'one paw down');
  await assertPointer(page.locator('#button'), 'one paw down');
  await assertPointer(page.locator('open-widget button'), 'one paw down');
  await assertPointer(page.locator('closed-widget'), 'one paw down', { inside: 'closedButton' });
  await assertPointer(frameLink, 'one paw down');

  await page.mouse.down();
  await assertPointer(page.locator('closed-widget'), 'both paws down', { inside: 'closedButton' });
  await assertPointer(frameLink, 'both paws down');
  await page.mouse.up();
  await assertPointer(frameLink, 'one paw down');

  await page.locator('#button').focus();
  await assertPointer(page.locator('#text'), 'paws up');
  await page.mouse.down();
  await assertPointer(page.locator('#text'), 'both paws down', { still: true });
});

test('a click plays a sound unless Sound is off', async (t) => {
  const { context, settings, page } = await open(t);
  const devtools = await context.newCDPSession(page);
  let sounds = 0;
  devtools.on('WebAudio.audioNodeCreated', ({ node }) => {
    if (node.nodeType === 'AudioBufferSource') sounds++;
  });
  await devtools.send('WebAudio.enable');

  await page.locator('#text').click();
  await eventually(() => sounds === 1);
  assert.equal(sounds, 1);

  await settings.getByLabel('Sound').uncheck();
  await page.waitForTimeout(300);
  await page.locator('#text').click();
  await page.waitForTimeout(300);
  assert.equal(sounds, 1);
});

test('turning Purrsor off in the popup gives pages their own cursor back', async (t) => {
  const { context, origin, page, assertPointer } = await open(t);
  const popup = await context.newPage();
  await popup.goto(`${origin}/popup/popup.html`);

  await popup.getByLabel('Purrsor').uncheck();
  await popup.getByText('Off everywhere').waitFor();
  await assertPointer(page.locator('#link'), 'pointer');

  await popup.getByLabel('Purrsor').check();
  await assertPointer(page.locator('#link'), 'one paw down');
});

test('the cursor only carries a smaller copy while Shrink near edges is on', async (t) => {
  const { context, origin, settings, page, assertPointer } = await open(t);
  const popup = await context.newPage();
  await popup.goto(`${origin}/popup/popup.html`);
  const copies = () => page.locator('#text').evaluate((node) => getComputedStyle(node).cursor.split('url(').length - 1);

  await assertPointer(page.locator('#text'), 'paws up');
  assert.equal(await copies(), 2);

  await popup.getByLabel('Shrink near edges').uncheck();
  await eventually(async () => await copies() === 1);
  assert.equal(await copies(), 1);
  await assertPointer(page.locator('#text'), 'paws up');

  await settings.getByLabel('Shrink near edges').check();
  await eventually(async () => await copies() === 2);
  assert.equal(await copies(), 2);
});

test('a cursor made from pictures in Settings shows on pages', async (t) => {
  const { settings, page, assertPointer } = await open(t);
  const cursor = () => page.locator('#text').evaluate((node) => getComputedStyle(node).cursor);
  await assertPointer(page.locator('#text'), 'paws up');
  const bongo = await cursor();

  await settings.getByRole('button', { name: 'New cursor' }).click();
  await settings.getByLabel('Name').fill('Icon');
  await settings.locator('#idleFile').setInputFiles(path.join(extension, 'icons/icon48.png'));
  await settings.locator('#hoverFile').setInputFiles(path.join(extension, 'icons/icon16.png'));
  await settings.getByRole('button', { name: 'Save and use' }).click();
  await settings.locator('.card.in-use', { hasText: 'Icon' }).waitFor();

  await eventually(async () => await cursor() !== bongo);
  assert.notEqual(await cursor(), bongo);
  await assertPointer(page.locator('#text'), 'paws up');
  await assertPointer(page.locator('#link'), 'one paw down');
});

test('Option-click slaps things away without following the link, and Option-Z puts them back', async (t) => {
  const { page, assertPointer } = await open(t);
  const link = page.locator('#link');
  const home = await link.boundingBox();
  let downloads = 0;
  page.on('download', () => downloads++);

  await page.keyboard.down('Alt');
  await assertPointer(link, 'leaning back');
  await page.mouse.down();
  await page.mouse.up();
  await page.keyboard.up('Alt');
  await page.waitForTimeout(2000);

  const slapped = await link.boundingBox();
  assert.ok(Math.hypot(slapped.x - home.x, slapped.y - home.y) > 10, 'the link moved');
  assert.match(page.url(), /page\.html$/);
  assert.equal(downloads, 0);

  await page.keyboard.press('Alt+KeyZ');
  await page.waitForTimeout(800);
  const back = await link.boundingBox();
  assert.ok(Math.hypot(back.x - home.x, back.y - home.y) < 1, 'the link is back');
});

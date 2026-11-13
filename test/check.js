// Reports the cursor Purrsor leaves on every [data-case] element in this
// document, including inside the shadow roots the fixture creates. Loaded by
// every fixture page. Call purrsorCheck() from DevTools, or press "Run checks".

// Purrsor's styles are a user-origin sheet, invisible to the page, so the
// idle and slap values are read off <html> with the pressed attribute off and on.
function purrsorSignatures() {
  const root = document.documentElement;
  const wasPressed = root.hasAttribute('data-purrsor-pressed');
  root.removeAttribute('data-purrsor-pressed');
  const idle = getComputedStyle(root).cursor;
  root.setAttribute('data-purrsor-pressed', '');
  const slap = getComputedStyle(root).cursor;
  if (!wasPressed) root.removeAttribute('data-purrsor-pressed');
  return idle.includes('url(') ? { idle, slap } : null;
}

function purrsorClassify(cursor, sigs) {
  if (!sigs) return 'no purrsor style';
  if (cursor === sigs.idle) return 'idle';
  if (cursor === sigs.slap) return 'slap';
  return cursor;
}

function purrsorCheck() {
  const sigs = purrsorSignatures();
  const roots = [document, ...(window.fixtureShadowRoots || [])];
  const rows = [];
  for (const root of roots) {
    for (const el of root.querySelectorAll('[data-case]')) {
      const cursor = getComputedStyle(el).cursor;
      rows.push({
        case: el.dataset.case,
        expect: el.dataset.expect || 'idle',
        got: purrsorClassify(cursor, sigs),
      });
    }
  }
  for (const row of rows) row.pass = row.got === row.expect;
  return { frame: location.href, styleInjected: !!sigs, rows };
}

// Frames answer the parent's request with their own report.
window.addEventListener('message', (event) => {
  if (event.data === 'purrsor-check') {
    event.source.postMessage({ purrsorReport: purrsorCheck() }, '*');
  }
});

# Test fixture

`calendar.html` stands in for Google Calendar's layout: a 64px header, a sidebar of clickable divs, and a grid of jsaction-style cells that set their own `cursor: pointer`. Around it are the cases a page-wide cursor has to survive:

- a site rule that is itself `!important`
- open and closed shadow roots
- same-origin, cross-origin, short and `srcdoc` iframes
- a modal dialog and a popover
- a button that rewrites `document.head`, the way some single-page apps do

`short.html` has a one-line body, so most of its viewport is `<html>` outside `<body>`.

## Run it

Serve the folder on two ports. The second port makes the cross-origin iframe.

```sh
python3 -m http.server 8731 --bind 127.0.0.1 -d test &
python3 -m http.server 8732 --bind 127.0.0.1 -d test &
```

Load the extension unpacked, open http://127.0.0.1:8731/calendar.html, and press "Run checks". Rows that don't match the expected cursor are highlighted. From DevTools or CDP, `await purrsorReport()` returns the same data, one report per frame.

Each `[data-case]` element is expected to show the idle cat while the mouse button is up. `check.js` reads the idle and slap values off `<html>`, so the checks work whichever way the styles are injected.

The checks read computed styles only. Whether the browser actually draws the cat near the viewport edge, where Chromium falls back to the next image in the cursor list, can only be seen on screen.

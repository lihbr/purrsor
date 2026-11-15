// Purrsor - the slap. An Option-click (Alt-click) sends a shockwave out from
// the pointer: two spinning stars, a punch ring, ripples that roll across the
// window, and focus lines. Each ripple kicks what it passes. Nothing is
// removed: Option-Z eases the last slap's pushes back, and a reload restores
// the page. Loaded before content.js, which decides when to slap.
//
// Choosing what a slap moves (findTargets) is separate from the hit itself
// (quake), so either can change on its own.

const Slap = (() => {
  // Tuned by hand in a side-by-side picker.
  const RADIUS = 520; // CSS px the shockwave reaches
  const MAX_TARGETS = 48;
  const PUSH = 110; // the first kick's push at the centre, in px
  const SPIN = 10; // degrees
  const RIPPLES = 4;
  const RING_OPACITY = 0.1;
  const SHAKE = 8; // px
  const FLASH = 0.85; // opacity of the negative around the pointer
  const FOCUS_LINES = 0.4; // opacity

  const TRAVEL = 900; // ms for a ripple to reach its full size
  const GAP = 90; // ms between ripples, and between the kicks they give
  const KICKS = 3;
  // Each kick overshoots its push and spin, then settles. Later kicks are
  // smaller and spin the other way. Stacked, the three never pass 1.21x their
  // settled push or 1.29x the first kick's spin, so these bound them too.
  const OVERSHOOT = 1.25;
  const SPIN_OVERSHOOT = 1.3;
  const KICK_SHARE = 0.55;
  const SPIN_SHARE = -0.6;
  const EDGE = 24; // px a push stays clear of the page's right and bottom

  const INK = '#1f1d1a';
  const PAD = '#f2a7b6';
  const PAPER = '#f8f5ef';
  const EASE_OUT = 'cubic-bezier(0.19, 1, 0.22, 1)';
  const EASE_OUT_QUAD = 'cubic-bezier(0.25, 0.46, 0.45, 0.94)';
  const EASE_IN_OUT = 'cubic-bezier(0.645, 0.045, 0.355, 1)';

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const random = (low, high) => low + Math.random() * (high - low);

  // Transforms don't move inline boxes, except these.
  const ATOMIC_INLINE = new Set(['img', 'svg', 'video', 'canvas', 'iframe', 'embed', 'object', 'input', 'select', 'textarea', 'button']);
  const CONTROLS = 'a[href], button, input, select, textarea, summary, [role="button"]';

  // An eight-point burst, as a clip-path.
  const STAR = `polygon(${Array.from({ length: 16 }, (_, i) => {
    const angle = (i / 16) * 2 * Math.PI - Math.PI / 2;
    const radius = i % 2 ? 22 : 50;
    return `${(50 + radius * Math.cos(angle)).toFixed(1)}% ${(50 + radius * Math.sin(angle)).toFixed(1)}%`;
  }).join(', ')})`;

  // Parts stay hidden outside their animations, which bring the opacity.
  const SLAP_CSS = `
  .fx, .negative, .focus { position: absolute; inset: 0; }
  .focus { width: 100%; height: 100%; }
  .hit { position: absolute; left: 0; top: 0; }
  .star, .ring, .line, .negative, .focus { opacity: 0; }
  .star { position: absolute; background: ${PAD}; clip-path: ${STAR}; }
  .star.ink { background: ${INK}; }
  .ring { position: absolute; box-sizing: border-box; border: 3px solid ${INK}; border-radius: 50%; }
  .ring.punch { border-width: 10px; }
  .ring.ripple { border-width: 4px; }
  .ring.ripple.pad { border: 7px solid ${PAD}; }
  .line {
    position: absolute; width: 72px; height: 4px; margin-top: -2px;
    background: ${INK}; border-radius: 2px; box-shadow: 0 0 0 1.5px ${PAPER};
    transform-origin: 0 50%;
  }
  .negative { backdrop-filter: invert(1) grayscale(1) contrast(1.5); }
  `;

  let overlay; // { host, fx }

  // Each slap's pushes, newest last, so Option-Z can take back one slap at a
  // time. Slaps past the limit fold into one held offset per element.
  const UNDO_LIMIT = 20;
  const slaps = []; // [[{ element, animations, x, y, angle }]]
  const holds = new Map(); // Element → { animations, x, y, angle }

  // The effects draw in a closed shadow root over the page, where the page's
  // styles can't reach and pointer events pass through.
  function getOverlay() {
    if (overlay?.host.isConnected) return overlay;
    const host = document.createElement('purrsor-slap');
    host.style.cssText = 'all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none; contain: strict;';
    const root = host.attachShadow({ mode: 'closed' });
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(SLAP_CSS);
    root.adoptedStyleSheets = [sheet];
    const fx = document.createElement('div');
    fx.className = 'fx';
    root.append(fx);
    document.documentElement.append(host);
    overlay = { host, fx };
    return overlay;
  }

  function addPart(parent, className, size) {
    const part = document.createElement('div');
    part.className = className;
    if (size) Object.assign(part.style, { width: `${size}px`, height: `${size}px`, margin: `${-size / 2}px 0 0 ${-size / 2}px` });
    parent.append(part);
    return part;
  }

  // Rings that grow from the pointer, each its own size, delay and length.
  function rings(hit, count, { kind, size, delay, duration, easing, from, holdUntil }) {
    const animations = [];
    for (let i = 0; i < count; i++) {
      const ring = addPart(hit, `ring ${kind(i)}`, size(i));
      const timing = { duration: duration(i), delay: delay(i) };
      animations.push(
        ring.animate([{ transform: `scale(${from})` }, { transform: 'scale(1)' }], { ...timing, easing }),
        ring.animate([{ opacity: RING_OPACITY }, { opacity: RING_OPACITY, offset: holdUntil }, { opacity: 0 }], { ...timing, easing: 'ease' }),
      );
    }
    return animations;
  }

  // A negative of the page around the pointer, cut off rather than faded.
  function flash(fx, x, y) {
    const negative = addPart(fx, 'negative');
    fx.prepend(negative);
    negative.style.maskImage = `radial-gradient(circle 220px at ${x}px ${y}px, #000 35%, transparent)`;
    const animation = negative.animate([{ opacity: FLASH }, { opacity: FLASH, offset: 0.17 }, { opacity: 0, offset: 0.18 }, { opacity: 0 }], { duration: 240 });
    animation.finished.then(() => negative.remove(), () => negative.remove());
  }

  // Ink wedges converging on the pointer, like a manga impact panel.
  function focusLines(fx, x, y) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'focus');
    const far = Math.hypot(innerWidth, innerHeight);
    const point = (radius, angle) => `${(x + radius * Math.cos(angle)).toFixed(1)},${(y + radius * Math.sin(angle)).toFixed(1)}`;
    let d = '';
    for (let i = 0; i < 64; i++) {
      const angle = (i / 64) * 2 * Math.PI + random(-0.03, 0.03);
      const inner = random(110, 200);
      const width = random(0.008, 0.02);
      d += `M${point(far, angle - width)}L${point(inner, angle)}L${point(far, angle + width)}Z`;
    }
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', INK);
    svg.append(path);
    svg.style.transformOrigin = `${x}px ${y}px`;
    fx.append(svg);
    const animation = svg.animate([
      { opacity: FOCUS_LINES, transform: 'scale(1)' },
      { opacity: FOCUS_LINES, offset: 0.3 },
      { opacity: 0, transform: 'scale(1.06)' },
    ], { duration: 300, easing: EASE_OUT });
    animation.finished.then(() => svg.remove(), () => svg.remove());
  }

  // The flash and focus lines fire at most twice a second, under the
  // photosensitive flash limit.
  let lastFlash = 0;

  // Two spinning stars (ink behind, pad pink in front), a punch ring, the
  // ripples and speed lines.
  function impact(fx, hit, x, y) {
    const now = performance.now();
    if (now - lastFlash > 500) {
      lastFlash = now;
      flash(fx, x, y);
      focusLines(fx, x, y);
    }
    const back = addPart(hit, 'star ink', 150);
    const front = addPart(hit, 'star', 110);
    const animations = [
      back.animate([{ transform: 'scale(0.5) rotate(-10deg)', opacity: 1 }, { opacity: 1, offset: 0.4 }, { transform: 'scale(1.5) rotate(14deg)', opacity: 0 }], { duration: 280, easing: EASE_OUT }),
      front.animate([{ transform: 'scale(0.5) rotate(0deg)', opacity: 1 }, { opacity: 1, offset: 0.4 }, { transform: 'scale(1.4) rotate(30deg)', opacity: 0 }], { duration: 260, easing: EASE_OUT }),
      ...rings(hit, 1, { kind: () => 'punch', size: () => 600, delay: () => 30, duration: () => 380, easing: EASE_OUT, from: 0.1, holdUntil: 0.45 }),
      ...rings(hit, RIPPLES, {
        kind: (i) => (i % 2 ? 'ripple' : 'ripple pad'),
        size: (i) => 2 * RADIUS * (1 + 0.12 * i),
        delay: (i) => 60 + GAP * i,
        duration: () => TRAVEL,
        easing: EASE_OUT_QUAD,
        from: 0.05,
        holdUntil: 0.5,
      }),
    ];
    for (let i = 0; i < 16; i++) {
      const line = addPart(hit, 'line');
      const angle = (i / 16) * 360 + random(-10, 10);
      const reach = 420 * random(0.55, 0.8);
      animations.push(line.animate([
        { transform: `rotate(${angle}deg) translateX(20px) scaleX(0.3)`, opacity: 1 },
        { opacity: 1, offset: 0.5 },
        { transform: `rotate(${angle}deg) translateX(${reach}px) scaleX(1)`, opacity: 0 },
      ], { duration: random(300, 380), delay: random(0, 40), easing: EASE_OUT }));
    }
    return animations;
  }

  // Reduced motion keeps the meaning without the movement: a burst and one
  // ring that fade in place, and nothing gets pushed.
  function calmBurst(hit) {
    const star = addPart(hit, 'star', 76);
    const ring = addPart(hit, 'ring', 2 * RADIUS * 0.3);
    const fade = (peak) => [{ opacity: 0 }, { opacity: peak, offset: 0.25 }, { opacity: 0 }];
    return [star.animate(fade(1), { duration: 360, easing: 'ease' }), ring.animate(fade(RING_OPACITY), { duration: 480, easing: 'ease' })];
  }

  // A box that holds other boxes is a wrapper: the point fell in its padding
  // or between its children, and moving it would carry them all as one.
  // Positioned and tiny children (badges, screen-reader text) don't count.
  function holdsBoxes(element) {
    for (const child of element.children) {
      const { display, position } = getComputedStyle(child);
      if (display === 'contents') {
        if (holdsBoxes(child)) return true;
        continue;
      }
      if (display === 'none' || display.startsWith('inline') || position === 'absolute' || position === 'fixed') continue;
      const { width, height } = child.getBoundingClientRect();
      if (width >= 4 && height >= 4) return true;
    }
    return false;
  }

  // The nearest box a transform can move: out of inline text to its block,
  // and out of SVG shapes to their <svg>. Null for anything page-sized and
  // for wrappers.
  function movable(element) {
    while (element && element !== document.body && element !== document.documentElement) {
      if (element instanceof SVGElement && element.ownerSVGElement) {
        element = element.ownerSVGElement;
        continue;
      }
      const { display } = getComputedStyle(element);
      if (display !== 'contents' && (display !== 'inline' || ATOMIC_INLINE.has(element.localName))) break;
      element = element.parentElement;
    }
    if (!element || element === document.body || element === document.documentElement) return null;
    if (element === overlay?.host) return null;
    const { width, height } = element.getBoundingClientRect();
    if (width < 4 || height < 4) return null;
    if (width > innerWidth || height > innerHeight * 0.5) return null;
    if (width * height > innerWidth * innerHeight * 0.25) return null;
    if (!element.matches(CONTROLS) && holdsBoxes(element)) return null;
    return element;
  }

  // Hit-tests rings of points around the click and keeps what's on top at each.
  function findTargets(x, y) {
    const seen = new Map(); // what each hit element resolves to, this slap
    const found = new Set();
    const consider = (px, py) => {
      const under = document.elementFromPoint(px, py);
      if (!seen.has(under)) seen.set(under, movable(under));
      const element = seen.get(under);
      if (element) found.add(element);
    };
    consider(x, y);
    const step = Math.max(42, RADIUS / 6);
    for (let r = step; r < RADIUS; r += step) {
      const count = Math.min(48, Math.round((2 * Math.PI * r) / step));
      const turn = Math.random() * Math.PI;
      for (let i = 0; i < count; i++) {
        const angle = turn + (i / count) * 2 * Math.PI;
        consider(x + r * Math.cos(angle), y + r * Math.sin(angle));
      }
    }
    const elements = [...found];
    const targets = [];
    for (const element of elements) {
      // Moving a box and something inside it would move the inner one twice.
      if (elements.some((other) => other !== element && element.contains(other))) continue;
      const rect = element.getBoundingClientRect();
      const nearX = Math.min(Math.max(x, rect.left), rect.right);
      const nearY = Math.min(Math.max(y, rect.top), rect.bottom);
      const distance = Math.hypot(nearX - x, nearY - y);
      if (distance > RADIUS) continue;
      const dx = rect.left + rect.width / 2 - x;
      const dy = rect.top + rect.height / 2 - y;
      targets.push({
        element,
        rect,
        distance,
        strength: 1 - distance / RADIUS,
        // Big things are heavy: a paragraph shifts and tilts, a button flies.
        light: Math.min(1, 160 / Math.max(rect.width, rect.height)),
        direction: (dx || dy ? Math.atan2(dy, dx) : Math.random() * 2 * Math.PI) + (Math.random() - 0.5) * 0.5,
        sign: Math.random() < 0.5 ? -1 : 1,
      });
    }
    return targets.sort((a, b) => a.distance - b.distance).slice(0, MAX_TARGETS);
  }

  // Pushes add to whatever transform the page gives the element, and to earlier
  // pushes, through the separate translate and rotate properties.
  function offset({ x, y, angle }) {
    return { translate: `${x}px ${y}px`, rotate: `${angle}deg` };
  }

  // Our running animations, so an element is only measured at rest.
  const ours = new WeakSet();

  function total(element) {
    const sum = { x: 0, y: 0, angle: 0 };
    const add = (push) => {
      sum.x += push.x;
      sum.y += push.y;
      sum.angle += push.angle;
    };
    if (holds.has(element)) add(holds.get(element));
    for (const slap of slaps) {
      for (const push of slap) if (push.element === element) add(push);
    }
    return sum;
  }

  // Where each element was last seen at rest, in page coordinates, with the
  // pushes it had then. A rect measured mid-flight would let quick slaps add
  // up past the page's edge.
  const homes = new WeakMap();

  function resting(element, rect) {
    const now = total(element);
    let home = homes.get(element);
    const moving = element.getAnimations().some((animation) => ours.has(animation) && animation.playState === 'running');
    if (!home || !moving) {
      home = { right: rect.right + scrollX, bottom: rect.bottom + scrollY, ...now };
      homes.set(element, home);
    }
    return { right: home.right + now.x - home.x, bottom: home.bottom + now.y - home.y, angle: now.angle, homeAngle: home.angle };
  }

  // How much of a slap's push and spin an element can take without widening
  // or lengthening the page: a box pushed past the scrollable area grows it.
  // Leaving by the top or left is fine, since those don't scroll.
  function keepInside(element, rect, push, firstSpin) {
    const page = document.scrollingElement || document.documentElement;
    const rest = resting(element, rect);
    const roomRight = page.scrollWidth - rest.right - EDGE;
    const roomBelow = page.scrollHeight - rest.bottom - EDGE;
    // The extra width and height a new angle adds to the box's outline.
    const width = element.offsetWidth ?? rect.width;
    const height = element.offsetHeight ?? rect.height;
    const outline = (degrees) => {
      const radians = (degrees * Math.PI) / 180;
      const cos = Math.abs(Math.cos(radians));
      const sin = Math.abs(Math.sin(radians));
      return [width * cos + height * sin, width * sin + height * cos];
    };
    const [w0, h0] = outline(rest.homeAngle);
    const [w1, h1] = outline(rest.angle + firstSpin * SPIN_OVERSHOOT);
    let [growX, growY] = [(w1 - w0) / 2, (h1 - h0) / 2];
    const spin = growX <= roomRight && growY <= roomBelow;
    if (!spin) [growX, growY] = [0, 0];
    const share = (wanted, room) => (wanted > 0 ? Math.min(1, Math.max(0, room) / (wanted * OVERSHOOT)) : 1);
    return { x: share(push.x, roomRight - growX), y: share(push.y, roomBelow - growY), spin: spin ? 1 : 0, roomRight: page.scrollWidth - rest.right };
  }

  // Shakes the effects and what the slap hit, not the page itself: a
  // transform on <html> or any wrapper pulls fixed headers out of place.
  const SHAKE_STEPS = [1, -0.8, 0.6, -0.45, 0.3, -0.18, 0.08, 0];
  function shake(element, amount) {
    if (amount <= 0) return;
    const frames = SHAKE_STEPS.map((step, i) => ({ translate: `${(step * amount).toFixed(1)}px ${((i % 2 ? 0.4 : -0.3) * step * amount).toFixed(1)}px` }));
    ours.add(element.animate(frames, { duration: 460, composite: 'add' }));
  }

  function hold(element, push) {
    const animation = element.animate([offset(push), offset(push)], { duration: 1, fill: 'forwards', composite: 'add' });
    animation.finish();
    animation.persist();
    return animation;
  }

  function stop(push) {
    for (const animation of push.animations) animation.cancel();
    push.animations = [];
  }

  // Each ripple kicks what it passes: three kicks per element, each smaller
  // than the last, starting as the wave gets there. Once they settle, one
  // held offset takes their place.
  function quake(fx, x, y) {
    const targets = findTargets(x, y);
    const plans = targets.map((target) => {
      const { element, rect, strength, light, direction, sign } = target;
      const force = PUSH * (0.4 + 0.6 * strength) * (0.6 + 0.4 * light);
      const firstSpin = sign * SPIN * (0.3 + 0.7 * strength) * light;
      const shares = Array.from({ length: KICKS }, (_, k) => KICK_SHARE ** k);
      const sum = shares.reduce((a, b) => a + b);
      const push = { x: Math.cos(direction) * force * sum, y: Math.sin(direction) * force * sum };
      return { target, force, firstSpin, shares, fit: keepInside(element, rect, push, firstSpin) };
    });
    shake(fx, SHAKE);
    for (const { target, fit } of plans) shake(target.element, Math.min(SHAKE, fit.roomRight - 1));
    return plans.map(({ target, force, firstSpin, shares, fit }) => {
      const { element, distance, direction } = target;
      const push = { element, animations: [], x: 0, y: 0, angle: 0 };
      shares.forEach((share, k) => {
        const kick = {
          x: Math.cos(direction) * force * share * fit.x,
          y: Math.sin(direction) * force * share * fit.y,
          angle: firstSpin * SPIN_SHARE ** k * fit.spin,
        };
        const animation = element.animate([
          { ...offset({ x: 0, y: 0, angle: 0 }), easing: EASE_OUT },
          { ...offset({ x: kick.x * OVERSHOOT, y: kick.y * OVERSHOOT, angle: kick.angle * SPIN_OVERSHOOT }), offset: 0.4, easing: EASE_IN_OUT },
          offset(kick),
        ], { duration: 380, delay: TRAVEL * 0.6 * (distance / RADIUS) + GAP * k, fill: 'forwards', composite: 'add' });
        // Filled animations on the same property would otherwise replace each other.
        animation.persist();
        ours.add(animation);
        push.animations.push(animation);
        push.x += kick.x;
        push.y += kick.y;
        push.angle += kick.angle;
      });
      const kicks = push.animations;
      Promise.all(kicks.map((animation) => animation.finished)).then(() => {
        if (push.animations !== kicks) return;
        push.animations = [hold(element, push)];
        for (const animation of kicks) animation.cancel();
      }, () => {});
      return push;
    });
  }

  // Past the undo limit, the oldest slap's pushes stay for good.
  function foldOldest() {
    for (const push of slaps.shift()) {
      const held = holds.get(push.element);
      const sum = { x: push.x + (held?.x ?? 0), y: push.y + (held?.y ?? 0), angle: push.angle + (held?.angle ?? 0) };
      if (held) stop(held);
      stop(push);
      holds.set(push.element, { animations: [hold(push.element, sum)], ...sum });
    }
  }

  // Returns whether the slap moved anything, which Option-Z could take back.
  function at(x, y) {
    const { fx } = getOverlay();
    const hit = addPart(fx, 'hit');
    hit.style.left = `${x}px`;
    hit.style.top = `${y}px`;
    const calm = reducedMotion.matches;
    const animations = calm ? calmBurst(hit) : impact(fx, hit, x, y);
    Promise.allSettled(animations.map((animation) => animation.finished)).then(() => hit.remove());
    if (calm) return false;
    const pushes = quake(fx, x, y);
    if (!pushes.length) return false;
    slaps.push(pushes);
    if (slaps.length > UNDO_LIMIT) foldOldest();
    return true;
  }

  function takeBack(push) {
    stop(push);
    const { element } = push;
    if (!element.isConnected || reducedMotion.matches) return;
    ours.add(element.animate([offset(push), offset({ x: 0, y: 0, angle: 0 })], {
      duration: 320,
      delay: Math.random() * 60,
      easing: EASE_IN_OUT,
      composite: 'add',
      fill: 'backwards',
    }));
  }

  // Eases the last slap's pushes back. Returns false when there was none.
  function undo() {
    const last = slaps.pop();
    last?.forEach(takeBack);
    return Boolean(last);
  }

  function restoreAll() {
    for (const slap of slaps.splice(0)) slap.forEach(takeBack);
    for (const [element, held] of holds) takeBack({ element, ...held });
    holds.clear();
  }

  return { at, undo, restoreAll };
})();

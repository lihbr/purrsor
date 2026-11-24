// Purrsor - the slap. An Option-click (Alt-click) sends a shockwave out from
// the pointer, and each ripple kicks what it passes. Nothing is removed:
// Option-Z eases the last slap's pushes back, and a reload restores the page.
// Loaded before content.js, which decides when to slap.

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

  const NONE = { x: 0, y: 0, angle: 0 };
  // Each slap's pushes, newest last, so Option-Z can take back one at a time.
  const UNDO_LIMIT = 20;
  const slaps = []; // [[{ element, x, y, angle, kicks }]]
  // How far slaps have pushed each element in all, how much of that has
  // settled, and the one animation that holds the settled part.
  const moved = new Map(); // Element → { x, y, angle, settled, held }

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

  function flash(fx, x, y) {
    const negative = addPart(fx, 'negative');
    fx.prepend(negative);
    negative.style.maskImage = `radial-gradient(circle 220px at ${x}px ${y}px, #000 35%, transparent)`;
    const animation = negative.animate([{ opacity: FLASH }, { opacity: FLASH, offset: 0.17 }, { opacity: 0, offset: 0.18 }, { opacity: 0 }], { duration: 240 });
    animation.finished.then(() => negative.remove(), () => negative.remove());
  }

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

  function plus(a, b, sign = 1) {
    return { x: a.x + sign * b.x, y: a.y + sign * b.y, angle: a.angle + sign * b.angle };
  }

  function hold(element, state) {
    state.held?.cancel();
    state.held = element.animate([offset(state.settled), offset(state.settled)], { duration: 1, fill: 'forwards', composite: 'add' });
    state.held.finish();
    state.held.persist();
  }

  function easeBack(element, push) {
    if (!element.isConnected || reducedMotion.matches) return;
    element.animate([offset(push), offset(NONE)], {
      duration: 320,
      delay: Math.random() * 60,
      easing: EASE_IN_OUT,
      composite: 'add',
      fill: 'backwards',
    });
  }

  // How much of a slap's push and spin an element can take without widening
  // or lengthening the page: a box pushed past the scrollable area grows it.
  // Leaving by the top or left is fine, since those don't scroll.
  function keepInside(element, rect, state, push, firstSpin) {
    const page = document.scrollingElement || document.documentElement;
    // The computed translate holds the pushes so far, even mid-flight, and a
    // spin leaves the centre in place, so this is where the box comes to rest.
    const [flownX = 0, flownY = 0] = getComputedStyle(element).translate.split(' ').map((length) => parseFloat(length) || 0);
    const roomRight = page.scrollWidth - (rect.left + rect.width / 2 + scrollX - flownX + state.x);
    const roomBelow = page.scrollHeight - (rect.top + rect.height / 2 + scrollY - flownY + state.y);
    const width = element.offsetWidth ?? rect.width;
    const height = element.offsetHeight ?? rect.height;
    const half = (degrees) => {
      const radians = (degrees * Math.PI) / 180;
      const cos = Math.abs(Math.cos(radians));
      const sin = Math.abs(Math.sin(radians));
      return [(width * cos + height * sin) / 2, (width * sin + height * cos) / 2];
    };
    const [restingWidth, restingHeight] = half(state.angle);
    let [halfWidth, halfHeight] = half(state.angle + firstSpin * SPIN_OVERSHOOT);
    const spin = halfWidth <= roomRight - EDGE && halfHeight <= roomBelow - EDGE;
    if (!spin) [halfWidth, halfHeight] = [restingWidth, restingHeight];
    const share = (wanted, room) => (wanted > 0 ? Math.min(1, Math.max(0, room) / (wanted * OVERSHOOT)) : 1);
    return {
      x: share(push.x, roomRight - EDGE - halfWidth),
      y: share(push.y, roomBelow - EDGE - halfHeight),
      spin: spin ? 1 : 0,
      shake: Math.min(SHAKE, roomRight - restingWidth - 1),
    };
  }

  // Shakes the effects and what the slap hit, not the page itself: a
  // transform on <html> or any wrapper pulls fixed headers out of place.
  const SHAKE_STEPS = [1, -0.8, 0.6, -0.45, 0.3, -0.18, 0.08, 0];
  function shake(element, amount) {
    if (amount <= 0) return;
    const frames = SHAKE_STEPS.map((step, i) => ({ translate: `${(step * amount).toFixed(1)}px ${((i % 2 ? 0.4 : -0.3) * step * amount).toFixed(1)}px` }));
    element.animate(frames, { duration: 460, composite: 'add' });
  }

  function quake(fx, x, y) {
    // Everything is measured before anything moves.
    const plans = findTargets(x, y).map((target) => {
      const { element, rect, strength, light, direction, sign } = target;
      if (!moved.has(element)) moved.set(element, { ...NONE, settled: NONE });
      const state = moved.get(element);
      const force = PUSH * (0.4 + 0.6 * strength) * (0.6 + 0.4 * light);
      const firstSpin = sign * SPIN * (0.3 + 0.7 * strength) * light;
      const shares = Array.from({ length: KICKS }, (_, k) => KICK_SHARE ** k);
      const sum = shares.reduce((a, b) => a + b);
      const push = { x: Math.cos(direction) * force * sum, y: Math.sin(direction) * force * sum };
      return { target, state, force, firstSpin, shares, fit: keepInside(element, rect, state, push, firstSpin) };
    });
    shake(fx, SHAKE);
    for (const { target, fit } of plans) shake(target.element, fit.shake);
    return plans.map(({ target, state, force, firstSpin, shares, fit }) => {
      const { element, distance, direction } = target;
      const push = { element, ...NONE };
      push.kicks = shares.map((share, k) => {
        const kick = {
          x: Math.cos(direction) * force * share * fit.x,
          y: Math.sin(direction) * force * share * fit.y,
          angle: firstSpin * SPIN_SHARE ** k * fit.spin,
        };
        Object.assign(push, plus(push, kick));
        const animation = element.animate([
          { ...offset(NONE), easing: EASE_OUT },
          { ...offset({ x: kick.x * OVERSHOOT, y: kick.y * OVERSHOOT, angle: kick.angle * SPIN_OVERSHOOT }), offset: 0.4, easing: EASE_IN_OUT },
          offset(kick),
        ], { duration: 380, delay: TRAVEL * 0.6 * (distance / RADIUS) + GAP * k, fill: 'forwards', composite: 'add' });
        // Filled animations on the same property would otherwise replace each other.
        animation.persist();
        return animation;
      });
      Object.assign(state, plus(state, push));
      // Once the kicks settle, the element's one held offset takes their place.
      Promise.all(push.kicks.map((kick) => kick.finished)).then(() => {
        state.settled = plus(state.settled, push);
        hold(element, state);
        for (const kick of push.kicks) kick.cancel();
        push.kicks = [];
      }, () => {});
      return push;
    });
  }

  function at(x, y) {
    const { fx } = getOverlay();
    const hit = addPart(fx, 'hit');
    hit.style.left = `${x}px`;
    hit.style.top = `${y}px`;
    const calm = reducedMotion.matches;
    const animations = calm ? calmBurst(hit) : impact(fx, hit, x, y);
    Promise.allSettled(animations.map((animation) => animation.finished)).then(() => hit.remove());
    if (calm) return;
    const pushes = quake(fx, x, y);
    if (pushes.length) slaps.push(pushes);
    // The oldest slap's pushes then stay until everything is restored.
    if (slaps.length > UNDO_LIMIT) slaps.shift();
  }

  function takeBack(push) {
    const { element } = push;
    const state = moved.get(element);
    Object.assign(state, plus(state, push, -1));
    if (push.kicks.length) {
      for (const kick of push.kicks) kick.cancel();
    } else {
      state.settled = plus(state.settled, push, -1);
      hold(element, state);
    }
    easeBack(element, push);
  }

  function undo() {
    slaps.pop()?.forEach(takeBack);
  }

  function restoreAll() {
    for (const push of slaps.splice(0).flat()) {
      for (const kick of push.kicks) kick.cancel();
    }
    for (const [element, state] of moved) {
      state.held?.cancel();
      easeBack(element, state.settled);
    }
    moved.clear();
  }

  return { at, undo, restoreAll };
})();

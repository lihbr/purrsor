// Purrsor - the slap. An Option-click (Alt-click) sends rings out from the
// pointer and knocks the things around it out of the way. Nothing is
// removed: Option-Z eases the last slap's pushes back, and a reload restores
// the page. Loaded before content.js, which decides when to slap.
//
// Choosing what a slap moves (findTargets) is separate from the hit itself
// (knockBack), so either can change on its own.

const Slap = (() => {
  const SLAP_RADIUS = 240; // CSS px the push reaches
  const SLAP_MAX_TARGETS = 24;
  const INK = '#1f1d1a';
  const PAD = '#f2a7b6';
  const PAPER = '#f8f5ef';
  const EASE_OUT = 'cubic-bezier(0.19, 1, 0.22, 1)';
  const EASE_IN_OUT = 'cubic-bezier(0.645, 0.045, 0.355, 1)';

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

  // Transforms don't move inline boxes, except these.
  const ATOMIC_INLINE = new Set(['img', 'svg', 'video', 'canvas', 'iframe', 'embed', 'object', 'input', 'select', 'textarea']);

  // An eight-point burst, as a clip-path.
  const STAR = `polygon(${Array.from({ length: 16 }, (_, i) => {
    const angle = (i / 16) * 2 * Math.PI - Math.PI / 2;
    const radius = i % 2 ? 22 : 50;
    return `${(50 + radius * Math.cos(angle)).toFixed(1)}% ${(50 + radius * Math.sin(angle)).toFixed(1)}%`;
  }).join(', ')})`;

  // Parts stay hidden outside their animations, which bring the opacity.
  const SLAP_CSS = `
  .hit { position: absolute; left: 0; top: 0; }
  .star, .ring, .line { opacity: 0; }
  .star {
    position: absolute; width: 76px; height: 76px; margin: -38px 0 0 -38px;
    background: ${PAD}; clip-path: ${STAR};
  }
  .ring {
    position: absolute; box-sizing: border-box;
    width: ${SLAP_RADIUS * 2}px; height: ${SLAP_RADIUS * 2}px; margin: -${SLAP_RADIUS}px 0 0 -${SLAP_RADIUS}px;
    border: 3px solid ${INK}; border-radius: 50%;
  }
  .ring.pad { border: 8px solid ${PAD}; }
  .ring.thin { border-width: 1.5px; }
  .line {
    position: absolute; width: 52px; height: 4px; margin-top: -2px;
    background: ${INK}; border-radius: 2px; box-shadow: 0 0 0 1.5px ${PAPER};
    transform-origin: 0 50%;
  }
  `;

  const RINGS = [
    { kind: 'ring', scale: 1, delay: 0, duration: 560 },
    { kind: 'ring pad', scale: 0.82, delay: 50, duration: 620 },
    { kind: 'ring thin', scale: 1.12, delay: 110, duration: 700 },
  ];

  let overlay; // { host, root }

  // Each slap's pushes, newest last, so Option-Z can take back one slap at a
  // time. Slaps past the limit fold into one held offset per element.
  const UNDO_LIMIT = 20;
  const slaps = []; // [[{ element, animation, x, y, angle }]]
  const holds = new Map(); // Element → { animation, x, y, angle }

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
    document.documentElement.append(host);
    overlay = { host, root };
    return overlay;
  }

  function addPart(parent, className) {
    const part = document.createElement('div');
    part.className = className;
    parent.append(part);
    return part;
  }

  // Anime impact: a burst, rings, and speed lines, all from the click point.
  function burst(hit) {
    const animations = [];
    const star = addPart(hit, 'star');
    animations.push(
      star.animate([{ transform: 'scale(0.6) rotate(0deg)' }, { transform: 'scale(1.3) rotate(24deg)' }], { duration: 260, easing: EASE_OUT }),
      star.animate([{ opacity: 1 }, { opacity: 1, offset: 0.3 }, { opacity: 0 }], { duration: 260, easing: 'ease' }),
    );
    for (const { kind, scale, delay, duration } of RINGS) {
      const ring = addPart(hit, kind);
      animations.push(
        ring.animate([{ transform: 'scale(0.1)' }, { transform: `scale(${scale})` }], { duration, delay, easing: EASE_OUT }),
        ring.animate([{ opacity: 1 }, { opacity: 1, offset: 0.35 }, { opacity: 0 }], { duration, delay, easing: 'ease' }),
      );
    }
    const lines = 12;
    for (let i = 0; i < lines; i++) {
      const line = addPart(hit, 'line');
      const angle = (i / lines) * 360 + (Math.random() - 0.5) * 20;
      const reach = SLAP_RADIUS * (0.55 + Math.random() * 0.25);
      animations.push(line.animate([
        { transform: `rotate(${angle}deg) translateX(20px) scaleX(0.3)`, opacity: 1 },
        { opacity: 1, offset: 0.5 },
        { transform: `rotate(${angle}deg) translateX(${reach}px) scaleX(1)`, opacity: 0 },
      ], { duration: 300 + Math.random() * 80, delay: Math.random() * 40, easing: EASE_OUT }));
    }
    return animations;
  }

  // Reduced motion keeps the meaning without the movement: a burst and one
  // ring that fade in place, and nothing gets pushed.
  function calmBurst(hit) {
    const star = addPart(hit, 'star');
    const ring = addPart(hit, 'ring');
    ring.style.transform = 'scale(0.3)';
    const fade = [{ opacity: 0 }, { opacity: 1, offset: 0.25 }, { opacity: 0 }];
    return [star.animate(fade, { duration: 360, easing: 'ease' }), ring.animate(fade, { duration: 480, easing: 'ease' })];
  }

  // The nearest box a transform can move: out of inline text to its block,
  // and out of SVG shapes to their <svg>. Null for anything page-sized.
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
    return element;
  }

  // Hit-tests rings of points around the click and keeps what's on top at each.
  function findTargets(x, y) {
    const found = new Set();
    const consider = (px, py) => {
      const element = movable(document.elementFromPoint(px, py));
      if (element) found.add(element);
    };
    consider(x, y);
    for (let r = 42; r < SLAP_RADIUS; r += 42) {
      const count = Math.round((2 * Math.PI * r) / 42);
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
      if (distance > SLAP_RADIUS) continue;
      targets.push({ element, rect, dx: rect.left + rect.width / 2 - x, dy: rect.top + rect.height / 2 - y, distance });
    }
    return targets.sort((a, b) => a.distance - b.distance).slice(0, SLAP_MAX_TARGETS);
  }

  // Pushes add to whatever transform the page gives the element, and to earlier
  // pushes, through the separate translate and rotate properties.
  function offset({ x, y, angle }) {
    return { translate: `${x}px ${y}px`, rotate: `${angle}deg` };
  }

  // How far a push overshoots before it settles.
  const OVERSHOOT = 1.12;
  const SPIN_OVERSHOOT = 1.2;

  function totalAngle(element) {
    let sum = holds.get(element)?.angle ?? 0;
    for (const slap of slaps) {
      for (const push of slap) if (push.element === element) sum += push.angle;
    }
    return sum;
  }

  // Cuts a push short where it would widen or lengthen the page: a box pushed
  // past the scrollable area grows it, and a scrollbar appearing shifts the
  // layout. Leaving by the top or left is fine, since those don't scroll.
  function keepInside(element, rect, push) {
    const page = document.scrollingElement || document.documentElement;
    const roomRight = page.scrollWidth - scrollX - rect.right - 1;
    const roomBelow = page.scrollHeight - scrollY - rect.bottom - 1;
    // The extra width and height a new angle adds to the box's outline.
    const width = element.offsetWidth ?? rect.width;
    const height = element.offsetHeight ?? rect.height;
    const outline = (degrees) => {
      const radians = (degrees * Math.PI) / 180;
      const cos = Math.abs(Math.cos(radians));
      const sin = Math.abs(Math.sin(radians));
      return [width * cos + height * sin, width * sin + height * cos];
    };
    const before = totalAngle(element);
    const grow = (angle) => {
      const [w0, h0] = outline(before);
      const [w1, h1] = outline(before + angle * SPIN_OVERSHOOT);
      return [(w1 - w0) / 2, (h1 - h0) / 2];
    };
    let { angle } = push;
    let [growX, growY] = grow(angle);
    if (growX > roomRight || growY > roomBelow) {
      angle = 0;
      [growX, growY] = [0, 0];
    }
    return {
      x: Math.min(push.x, Math.max(0, roomRight - growX) / OVERSHOOT),
      y: Math.min(push.y, Math.max(0, roomBelow - growY) / OVERSHOOT),
      angle,
    };
  }

  function shove(element, x, y, angle, delay) {
    const animation = element.animate([
      { ...offset({ x: 0, y: 0, angle: 0 }), easing: EASE_OUT },
      { ...offset({ x: x * OVERSHOOT, y: y * OVERSHOOT, angle: angle * SPIN_OVERSHOOT }), offset: 0.45, easing: EASE_IN_OUT },
      offset({ x, y, angle }),
    ], { duration: 480, delay, fill: 'forwards', composite: 'add' });
    // Filled animations on the same property would otherwise replace each other.
    animation.persist();
    return { element, animation, x, y, angle };
  }

  // Pushes each target away from the click, harder the closer it is.
  function knockBack(targets, x, y) {
    return targets.map(({ element, rect, dx, dy, distance }) => {
      const strength = 1 - distance / SLAP_RADIUS;
      // Big things are heavy: a paragraph shifts and tilts, a button flies.
      const light = Math.min(1, 160 / Math.max(rect.width, rect.height));
      const force = (24 + 72 * strength ** 1.3) * (0.55 + 0.45 * light);
      const direction = (dx || dy ? Math.atan2(dy, dx) : Math.random() * 2 * Math.PI) + (Math.random() - 0.5) * 0.5;
      const spin = (Math.random() < 0.5 ? -1 : 1) * (3 + 10 * strength) * light;
      const push = keepInside(element, rect, { x: Math.cos(direction) * force, y: Math.sin(direction) * force, angle: spin });
      // Starts as the outer ring gets there.
      const delay = 260 * (distance / SLAP_RADIUS) ** 1.6;
      return shove(element, push.x, push.y, push.angle, delay);
    });
  }

  // Past the undo limit, the oldest slap's pushes stay for good.
  function foldOldest() {
    for (const push of slaps.shift()) {
      const held = holds.get(push.element);
      const total = { x: push.x + (held?.x ?? 0), y: push.y + (held?.y ?? 0), angle: push.angle + (held?.angle ?? 0) };
      held?.animation.cancel();
      push.animation.cancel();
      const animation = push.element.animate([offset(total), offset(total)], { duration: 1, fill: 'forwards', composite: 'add' });
      animation.finish();
      animation.persist();
      holds.set(push.element, { animation, ...total });
    }
  }

  // Returns whether the slap moved anything, which Option-Z could take back.
  function at(x, y) {
    const { root } = getOverlay();
    const hit = addPart(root, 'hit');
    hit.style.left = `${x}px`;
    hit.style.top = `${y}px`;
    const calm = reducedMotion.matches;
    const animations = calm ? calmBurst(hit) : burst(hit);
    Promise.allSettled(animations.map((animation) => animation.finished)).then(() => hit.remove());
    if (calm) return false;
    const pushes = knockBack(findTargets(x, y), x, y);
    if (!pushes.length) return false;
    slaps.push(pushes);
    if (slaps.length > UNDO_LIMIT) foldOldest();
    return true;
  }

  function takeBack({ element, animation, ...push }) {
    animation.cancel();
    if (!element.isConnected || reducedMotion.matches) return;
    element.animate([offset(push), offset({ x: 0, y: 0, angle: 0 })], {
      duration: 320,
      delay: Math.random() * 60,
      easing: EASE_IN_OUT,
      composite: 'add',
      fill: 'backwards',
    });
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
